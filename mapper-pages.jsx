const MappersPage = ({ onBack }) => {
  const all = window.useEntities('mappers');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');
  const canEditInterfaces = hasPermission('EDIT_INTERFACES');

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...all]
      .filter(m => !needle || (m.name + ' ' + (m.text || '')).toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [all, q]);
  const pager = usePagination(filtered);

  const TEMPLATE = `# New mapper
name      = Untitled Mapper
direction = inbound
format    = csv
header    = true
delimiter = ,

# Map source columns to LIS entity fields:
patient.mrn        = MRN
patient.lastName   = LastName
patient.firstName  = FirstName

order.orderNumber  = OrderID
order.testIds      = split(TestCodes, ";")
order.priority     = map(Priority, S=stat, R=routine)
`;

  const startNew = () => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    setEditingId(null);
    setDraft({ id: 'mapper_' + Date.now().toString(36), name: 'Untitled Mapper', text: TEMPLATE, active: true, builtin: false });
  };
  const startEdit = (m) => { if (!hasPermission('EDIT_INTERFACES')) return; setEditingId(m.id); setDraft({ ...m }); };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    if (!draft || !draft.text) return;
    const parsed = window.mappers.parse(draft.text);
    const name = (parsed.meta && parsed.meta.name) || draft.name || 'Untitled';
    if (editingId) {
      const existing = all.find(m => m.id === editingId);
      if (existing) await window.db.put('mappers', { ...existing, ...draft, name, updatedAt: Date.now() });
    } else {
      await window.db.put('mappers', { ...draft, name, createdAt: Date.now(), updatedAt: Date.now() });
    }
    cancel();
  };
  const remove = async (m) => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    if (m.builtin) {
      await safetyNotice({
        tone: 'warning',
        title: 'Mapper delete blocked',
        message: 'Built-in mappers cannot be deleted. Deactivate the mapper instead.',
        facts: [safetyFact('mapper', m.name), safetyFact('id', m.id)],
      });
      return;
    }
    const ask = await safetyConfirm({
      id: 'admin.mapper.delete',
      tone: 'danger',
      title: 'Delete mapper',
      message: 'This removes the mapper script from import/export configuration.',
      facts: [
        safetyFact('mapper id', m.id),
        safetyFact('name', m.name),
        safetyFact('active', m.active !== false ? 'yes' : 'no'),
      ],
      entityType: 'mapper',
      entityId: m.id,
      confirmLabel: 'Delete mapper',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_INTERFACES')) return;
    const fresh = await window.db.get('mappers', m.id);
    if (!fresh) return;
    await window.db.delete('mappers', m.id);
    if (editingId === m.id) cancel();
  };

  const toggleActive = async (m) => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    const nextActive = m.active === false;
    const ask = await confirmConfigChange({
      id: nextActive ? 'admin.mapper.activate' : 'admin.mapper.deactivate',
      title: nextActive ? 'Activate mapper' : 'Deactivate mapper',
      message: 'This changes whether the mapper can be used for interface intake.',
      facts: [
        safetyFact('mapper id', m.id),
        safetyFact('name', m.name),
        safetyFact('format', m.format || '-'),
        safetyFact('next state', nextActive ? 'active' : 'inactive'),
      ],
      entityType: 'mapper',
      entityId: m.id,
      confirmLabel: nextActive ? 'Activate mapper' : 'Deactivate mapper',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_INTERFACES')) return;
    const fresh = await window.db.get('mappers', m.id);
    if (!fresh) return;
    await window.db.put('mappers', { ...fresh, active: nextActive });
  };

  // Live-parse the editor draft to surface validation
  const draftParsed = useMemoOS(() => {
    if (!draft || !draft.text) return null;
    return window.mappers.parse(draft.text);
  }, [draft && draft.text]);

  return (
    <Page label="Mappers">
      <PageHeader title="Mappers" sub="Lattice Mapper Language (LML) scripts: bridge partner formats (CSV, JSON, dialect HL7) into the LIS pipeline. Plain text, easy to edit."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}
            disabled={!canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Create new mapper', 'edit interfaces')}><IconPlus size={13}/> New mapper</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '320px 1fr' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search…" style={{ height: 28 }}
              value={q} onChange={e => setQ(e.target.value)}/>
          </div>
          {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">No mappers</div>
                <div className="empty-sub">Click "New mapper" to start.</div>
              </div>
            ) : pager.slice.map(m => {
              const meta = window.mappers.parse(m.text || '').meta;
              const isSel = editingId === m.id;
              return (
                <button key={m.id} type="button" onClick={() => startEdit(m)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 12px', border: 0,
                    background: isSel ? 'var(--sage-50)' : 'transparent',
                    borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
                    opacity: m.active === false ? 0.5 : 1,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="dot" data-tone={m.active === false ? 'idle' : 'ok'}/>
                    <span style={{ fontSize: 12.5, color: 'var(--ink-900)', fontWeight: 500 }}>{m.name}</span>
                    {m.builtin && <span style={{ fontSize: 10, color: 'var(--ink-400)' }}>(built-in)</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 2, paddingLeft: 14 }}>
                    {(meta && meta.format) || '—'} · {(meta && meta.direction) || '—'}
                  </div>
                </button>
              );
            })}
          </div>
          {filtered.length > 0 && <TablePagination {...pager}/>}
        </div>

        {draft ? (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{editingId ? 'Edit mapper' : 'New mapper'}</span>
              {draftParsed && draftParsed.errors && draftParsed.errors.length > 0 && (
                <span className="pill" data-tone="rust">{draftParsed.errors.length} error(s)</span>
              )}
              {draftParsed && draftParsed.errors && draftParsed.errors.length === 0 && (
                <span className="pill" data-tone="sage">{(draftParsed.mappings || []).length} mappings</span>
              )}
              <div style={{ flex: 1 }}/>
              {editingId && !draft.builtin && (
                <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(draft)}
                  disabled={!canEditInterfaces}
                  title={permissionTitle(canEditInterfaces, 'Delete mapper', 'edit interfaces')}>Delete</button>
              )}
              {editingId && (
                <button className="btn" data-size="xs" onClick={() => toggleActive(draft)}
                  disabled={!canEditInterfaces}
                  title={permissionTitle(canEditInterfaces, draft.active === false ? 'Activate mapper' : 'Deactivate mapper', 'edit interfaces')}>
                  {draft.active === false ? 'Activate' : 'Deactivate'}
                </button>
              )}
              <button className="btn" data-variant="ghost" data-size="xs" onClick={cancel}>Cancel</button>
              <button className="btn" data-variant="primary" data-size="xs" onClick={save}
                disabled={!canEditInterfaces}
                title={permissionTitle(canEditInterfaces, 'Save mapper', 'edit interfaces')}>Save</button>
            </div>
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', overflow: 'hidden' }}>
              <textarea
                value={draft.text}
                onChange={e => setDraft({ ...draft, text: e.target.value })}
                spellCheck={false}
                style={{
                  width: '100%', height: '100%',
                  padding: 14, border: 'none', outline: 'none', resize: 'none',
                  fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6,
                  background: '#fff', color: 'var(--ink-900)',
                }}/>
              <div style={{ padding: 14, borderLeft: '1px solid var(--line)', overflowY: 'auto', background: 'var(--ivory-50)' }}>
                <div className="section-title" style={{ marginBottom: 6 }}>Cheatsheet</div>
                <div style={{ fontSize: 11, color: 'var(--ink-700)', lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Header keys:</strong>
                    <div className="mono" style={{ marginTop: 4 }}>name = …<br/>direction = inbound | outbound<br/>format = csv | json | hl7<br/>header = true | false<br/>delimiter = ,</div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Functions:</strong>
                    <div className="mono" style={{ marginTop: 4, fontSize: 10.5 }}>
                      date(s, fmt)<br/>
                      formatDate(ts, fmt)<br/>
                      now(fmt?)<br/>
                      map(field, k=v, k=v)<br/>
                      split(field, sep)<br/>
                      join(arr, sep)<br/>
                      concat(a, b, c)<br/>
                      trim/upper/lower(field)<br/>
                      default(field, fb)<br/>
                      slice(field, n, m)<br/>
                      int(field) / float(field)<br/>
                      if(cond, t, e)
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <strong>Notes:</strong>
                    <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-500)' }}>
                      In <span className="mono">map()</span>, <span className="mono">k=v</span> values are literal strings — bare words don't look up columns.
                    </div>
                  </div>
                  <div>
                    <strong>Targets (inbound):</strong>
                    <div className="mono" style={{ marginTop: 4, fontSize: 10.5 }}>
                      patient.mrn / lastName / firstName / dob / sex<br/>
                      order.orderNumber / priority / testIds / facility / providerId / notes
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {draftParsed && draftParsed.errors && draftParsed.errors.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', padding: 8, background: 'var(--rust-soft)', maxHeight: 100, overflowY: 'auto' }}>
                {draftParsed.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--err-700)', fontFamily: 'var(--font-mono)' }}>{e}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div className="empty" style={{ padding: '40px 24px' }}>
              <div className="empty-title">Select a mapper to edit</div>
              <div className="empty-sub">Or click "New mapper" to start fresh. Built-in samples (Generic CSV / JSON Orders) live at the top of the list — duplicate one to bootstrap a partner-specific mapper.</div>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
};

// ===== QC (Westgard) =====
//
// Levey-Jennings: z-score (y) vs run order (x). Bands at ±1/2/3 SD, mean at 0.
// Points colored by status (sage = in_control, amber = warn, rust = out_of_control).
// Pure SVG, no canvas — keeps it crisp at any DPI and lets us style with the
// same CSS variables as the rest of the app.
