const SPECIMEN_TYPE_OPTIONS = ['', 'serum', 'plasma', 'whole_blood', 'urine', 'csf', 'swab', 'tissue', 'other'];
// 2x1 @ 203 dpi default. Barcode at top, then patient line, then identifiers and order.
// Mirrors the inline default in labels.js so a fresh template prints within ^LL203
// instead of running 7+ dots past the configured length and wrapping to a second label.
const DEFAULT_ZPL_BODY = '^XA\n^MMT\n^PW406\n^LL203\n^LH0,0\n^FO12,8\n^BY2,2.5,50\n^BCN,50,Y,N,N\n^FD{accession}^FS\n^FO12,75^A0N,22,22^FD{patient_line}^FS\n^FO12,103^A0N,18,18^FDMRN {mrn}  DOB {dob}  {sex}  {age}y^FS\n^FO12,125^A0N,18,18^FD{type}  ·  {container}^FS\n^FO12,147^A0N,18,18^FDTESTS: {tests}^FS\n^FO12,170^A0N,16,16^FDORD {order_number}^FS\n^XZ';

const LabelsPage = ({ onBack }) => {
  const all = window.useEntities('label_templates');
  const specimens = window.useEntities('specimens');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');
  const [preview, setPreview] = useStateOS(null);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...all]
      .filter(t => !needle || [t.code, t.name, t.specimenType, t.testCode].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [all, q]);

  const startNew = () => {
    setEditingId(null);
    setDraft({ code: '', name: '', specimenType: '', testCode: '', width: 2.0, height: 1.0, dpi: 203, zpl: DEFAULT_ZPL_BODY, printerEndpoint: '', notes: '', active: true });
  };
  const startEdit = (t) => {
    setEditingId(t.id);
    setDraft({
      code: t.code || '', name: t.name || '',
      specimenType: t.specimenType || '', testCode: t.testCode || '',
      width: t.width || 2.0, height: t.height || 1.0, dpi: t.dpi || 203,
      zpl: t.zpl || DEFAULT_ZPL_BODY,
      printerEndpoint: t.printerEndpoint || '',
      notes: t.notes || '', active: t.active !== false,
    });
  };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
    if (!draft || !draft.code || !draft.name) return;
    const init = { ...draft, width: Number(draft.width), height: Number(draft.height), dpi: Number(draft.dpi) };
    if (window.labels && typeof window.labels.lintZpl === 'function') {
      const lint = window.labels.lintZpl(init.zpl || '');
      if (!lint.ok) {
        await safetyNotice({ tone: 'danger', title: 'Label template blocked', message: lint.errors.slice(0, 4).join('; ') });
        return;
      }
    }
    const ask = await confirmConfigChange({
      id: editingId ? 'admin.label.save' : 'admin.label.create',
      title: editingId ? 'Save label template' : 'Create label template',
      message: 'This changes specimen label output and future printer commands.',
      facts: [
        safetyFact('code', init.code),
        safetyFact('name', init.name),
        safetyFact('specimen type', init.specimenType || 'default'),
        safetyFact('test code', init.testCode || 'any'),
        safetyFact('active', init.active ? 'yes' : 'no'),
      ],
      entityType: 'label_template',
      entityId: editingId || init.code,
      confirmLabel: editingId ? 'Save template' : 'Create template',
    });
    if (!ask.confirmed) return;
    if (editingId) {
      const existing = await window.db.get('label_templates', editingId);
      if (existing) await window.db.put('label_templates', { ...existing, ...init });
    } else {
      const t = window.schema.newLabelTemplate(init);
      await window.db.put('label_templates', t);
    }
    cancel();
  };
  const remove = async (t) => {
    const ask = await safetyConfirm({
      id: 'admin.label_template.delete',
      tone: 'danger',
      title: 'Delete label template',
      message: 'This removes the ZPL label template from printing configuration.',
      facts: [
        safetyFact('template id', t.id),
        safetyFact('code', t.code),
        safetyFact('name', t.name),
        safetyFact('scope', [t.specimenType, t.testCode].filter(Boolean).join(' / ') || 'default'),
      ],
      entityType: 'label_template',
      entityId: t.id,
      confirmLabel: 'Delete template',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('label_templates', t.id);
    if (!fresh) return;
    await window.db.delete('label_templates', t.id);
    if (editingId === t.id) cancel();
  };

  const toggleActive = async (t) => {
    const nextActive = t.active === false;
    const ask = await confirmConfigChange({
      id: nextActive ? 'admin.label.activate' : 'admin.label.deactivate',
      title: nextActive ? 'Activate label template' : 'Deactivate label template',
      message: 'This changes which label template can be used for specimen labels.',
      facts: [
        safetyFact('template id', t.id),
        safetyFact('code', t.code),
        safetyFact('name', t.name),
        safetyFact('specimen type', t.specimenType || 'default'),
        safetyFact('next state', nextActive ? 'active' : 'inactive'),
      ],
      entityType: 'label_template',
      entityId: t.id,
      confirmLabel: nextActive ? 'Activate template' : 'Deactivate template',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('label_templates', t.id);
    if (!fresh) return;
    await window.db.put('label_templates', { ...fresh, active: nextActive });
  };

  // Render a ZPL preview by substituting fields from the first specimen.
  // Falls back to canned fixture data when no specimens exist yet.
  const showPreview = (template) => {
    const sample = specimens[0];
    let model = {
      patient_line: 'DOE, JANE',
      mrn: 'M100001', dob: '1985-04-12', sex: 'F', age: '40',
      type: 'serum', container: 'sst',
      tests: 'GLU, BUN, CR',
      order_number: 'L20260507A001',
      accession: '20260507-0001',
    };
    if (sample && window.labels && typeof window.labels.build === 'function') {
      // Use the production builder to populate model fields realistically.
      try {
        const built = window.labels.build(sample.id);
        if (built && built.render) model = { ...model, ...built.render };
      } catch (e) { /* fall through to canned model */ }
    }
    const filled = (template.zpl || DEFAULT_ZPL_BODY).replace(/\{([a-z_]+)\}/g, (m, k) => model[k] != null ? String(model[k]) : '');
    setPreview({ template, filled, model });
  };

  return (
    <Page label="Labels & Printing">
      <PageHeader title="Labels & Printing" sub="ZPL II templates per specimen type. Printer config + preview against live specimens."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}><IconPlus size={13}/> New template</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 460px' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search by code, name, scope…" style={{ height: 28, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {all.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">{all.length === 0 ? 'No label templates yet' : 'No templates match'}</div>
                <div className="empty-sub">{all.length === 0 ? 'Templates target a specimen type or test class. Most-specific match wins at print time.' : 'Adjust the search.'}</div>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Code</th><th>Name</th>
                    <th>Specimen type</th><th>Test scope</th>
                    <th style={{ width: 90 }}>Size</th>
                    <th>Printer</th>
                    <th style={{ width: 130 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id} style={{ opacity: t.active === false ? 0.5 : 1, background: editingId === t.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(t)} style={{ cursor: 'pointer' }} title={t.active === false ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
                        <span className="dot" data-tone={t.active === false ? 'idle' : 'ok'}/>
                      </td>
                      <td><span className="mono">{t.code}</span></td>
                      <td>{t.name}</td>
                      <td><span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{t.specimenType || <em style={{ color: 'var(--ink-300)' }}>any</em>}</span></td>
                      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{t.testCode || <em style={{ color: 'var(--ink-300)' }}>any</em>}</span></td>
                      <td className="mono tnum" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{t.width}×{t.height}″</td>
                      <td><span className="mono" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{t.printerEndpoint || '—'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-size="xs" onClick={() => showPreview(t)}>Preview</button>
                          <button className="btn" data-size="xs" onClick={() => startEdit(t)}>Edit</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(t)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {draft && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{editingId ? 'Edit template' : 'New template'}</span>
              <div style={{ flex: 1 }}/>
              <button className="btn" data-size="xs" data-variant="ghost" onClick={cancel}>Cancel</button>
            </div>
            <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
              <CatalogField label="Code" mono required>
                <input className="input mono" autoFocus value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })}/>
              </CatalogField>
              <CatalogField label="Name" required>
                <input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/>
              </CatalogField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Specimen type (scope)">
                  <select className="input" value={draft.specimenType} onChange={e => setDraft({ ...draft, specimenType: e.target.value })}>
                    {SPECIMEN_TYPE_OPTIONS.map(t => <option key={t || '*'} value={t}>{t || '— any —'}</option>)}
                  </select>
                </CatalogField>
                <CatalogField label="Test code (optional scope)">
                  <input className="input mono" value={draft.testCode} onChange={e => setDraft({ ...draft, testCode: e.target.value.toUpperCase() })} placeholder="empty = all tests"/>
                </CatalogField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <CatalogField label="Width (in)">
                  <input className="input mono tnum" type="number" step="0.1" value={draft.width} onChange={e => setDraft({ ...draft, width: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Height (in)">
                  <input className="input mono tnum" type="number" step="0.1" value={draft.height} onChange={e => setDraft({ ...draft, height: e.target.value })}/>
                </CatalogField>
                <CatalogField label="DPI">
                  <input className="input mono tnum" type="number" value={draft.dpi} onChange={e => setDraft({ ...draft, dpi: e.target.value })}/>
                </CatalogField>
              </div>
              <CatalogField label="Printer endpoint (optional)">
                <input className="input mono" value={draft.printerEndpoint} onChange={e => setDraft({ ...draft, printerEndpoint: e.target.value })} placeholder="tcp://zebra-bench:9100"/>
              </CatalogField>
              <CatalogField label="ZPL II template">
                <textarea className="input mono" rows={10} value={draft.zpl}
                  onChange={e => setDraft({ ...draft, zpl: e.target.value })}
                  style={{ height: 'auto', padding: 8, resize: 'vertical', fontSize: 11.5 }}/>
              </CatalogField>
              <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: -6, marginBottom: 10 }}>
                Placeholders: <span className="mono">{'{patient_line} {mrn} {dob} {sex} {age} {type} {container} {tests} {order_number} {accession}'}</span>
              </div>
              <CatalogField label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                  <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>
                  Available for printing
                </label>
              </CatalogField>
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button className="btn" data-size="sm" onClick={cancel}>Cancel</button>
              <button className="btn" data-variant="primary" data-size="sm" onClick={save} disabled={!draft.code || !draft.name}>
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div onClick={() => setPreview(null)} className="backdrop-in"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.45)',
            display: 'grid', placeItems: 'center', zIndex: 1500,
          }}>
          <div onClick={e => e.stopPropagation()} className="scale-in"
            style={{
              background: 'var(--ivory-50)', border: '1px solid var(--line)',
              borderRadius: 8, width: 720, maxWidth: '90vw', maxHeight: '85vh',
              boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 500 }}>Label preview · {preview.template.code}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{preview.template.width}×{preview.template.height}″ @ {preview.template.dpi} dpi</span>
              <div style={{ flex: 1 }}/>
              <button className="btn" data-size="xs" onClick={() => navigator.clipboard.writeText(preview.filled)}>Copy ZPL</button>
              <button className="btn" data-size="xs" onClick={() => setPreview(null)}>Close</button>
            </div>
            <div style={{ padding: 16, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Field model</div>
                <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 5, padding: 10, fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                  {Object.entries(preview.model).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex' }}>
                      <span style={{ color: 'var(--ink-400)', minWidth: 110 }}>{k}</span>
                      <span>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Resolved ZPL</div>
                <pre style={{
                  background: '#fff', border: '1px solid var(--line)', borderRadius: 5, padding: 10,
                  fontSize: 10.5, fontFamily: 'var(--font-mono)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  margin: 0, maxHeight: 360, overflow: 'auto',
                }}>{preview.filled}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
};

// ===== Mappers (LML script library) =====
