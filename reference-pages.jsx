const TestCatalogPage = ({ onBack }) => {
  const tests = window.useEntities('tests');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');
  const canEditTestCatalog = hasPermission('EDIT_TEST_CATALOG');

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...tests]
      .filter(t => !needle || [t.code, t.name, t.shortName, t.loinc].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [tests, q]);

  const pager = usePagination(filtered);

  const startNew = () => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    setEditingId(null);
    setDraft({ code: '', name: '', shortName: '', loinc: '', units: '', refRangeLow: '', refRangeHigh: '', turnaroundMinutes: '', referenceRanges: [], criticalEscalationT1Sec: '', criticalEscalationT2Sec: '', lotExpirationAmberDays: '', deltaCheckPercent: '', deltaCheckAbsolute: '', active: true });
  };
  const startEdit = (t) => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    setEditingId(t.id);
    setDraft({
      code: t.code || '', name: t.name || '', shortName: t.shortName || '',
      loinc: t.loinc || '', units: t.units || '',
      refRangeLow: t.refRangeLow == null ? '' : t.refRangeLow,
      refRangeHigh: t.refRangeHigh == null ? '' : t.refRangeHigh,
      turnaroundMinutes: t.turnaroundMinutes == null ? '' : t.turnaroundMinutes,
      referenceRanges: Array.isArray(t.referenceRanges) ? t.referenceRanges.map(r => ({ ...r })) : [],
      criticalEscalationT1Sec: t.criticalEscalationT1Sec == null ? '' : t.criticalEscalationT1Sec,
      criticalEscalationT2Sec: t.criticalEscalationT2Sec == null ? '' : t.criticalEscalationT2Sec,
      lotExpirationAmberDays: t.lotExpirationAmberDays == null ? '' : t.lotExpirationAmberDays,
      deltaCheckPercent: t.deltaCheckPercent == null ? '' : t.deltaCheckPercent,
      deltaCheckAbsolute: t.deltaCheckAbsolute == null ? '' : t.deltaCheckAbsolute,
      active: t.active !== false,
    });
  };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    if (!draft || !draft.code || !draft.name) return;
    // Empty input → null (use global default). Whitespace-only is also null.
    const parseSec = (raw) => {
      if (raw == null) return null;
      const s = String(raw).trim();
      if (s === '') return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    const init = {
      ...draft,
      refRangeLow:  draft.refRangeLow  === '' ? null : Number(draft.refRangeLow),
      refRangeHigh: draft.refRangeHigh === '' ? null : Number(draft.refRangeHigh),
      turnaroundMinutes: draft.turnaroundMinutes === '' ? null : Number(draft.turnaroundMinutes),
      criticalEscalationT1Sec: parseSec(draft.criticalEscalationT1Sec),
      criticalEscalationT2Sec: parseSec(draft.criticalEscalationT2Sec),
      lotExpirationAmberDays: parseSec(draft.lotExpirationAmberDays),
      deltaCheckPercent:  parseSec(draft.deltaCheckPercent),
      deltaCheckAbsolute: parseSec(draft.deltaCheckAbsolute),
      referenceRanges: (draft.referenceRanges || []).map(r => window.schema.newReferenceRange(r)),
    };
    if (editingId) {
      const existing = tests.find(t => t.id === editingId);
      if (existing) await window.db.put('tests', { ...existing, ...init });
    } else {
      const t = window.schema.newTest(init);
      await window.db.put('tests', t);
    }
    cancel();
  };

  // Reference Range row helpers — operate on the in-memory draft only; persisted on Save.
  const rrAdd = () => {
    setDraft({
      ...draft,
      referenceRanges: [...(draft.referenceRanges || []), {
        id: 'rr_' + Date.now().toString(36),
        low: '', high: '', units: '',
        sex: 'any', ageMinYears: '', ageMaxYears: '',
        method: '', notes: '',
      }],
    });
  };
  const rrUpdate = (idx, patch) => {
    const next = [...(draft.referenceRanges || [])];
    next[idx] = { ...next[idx], ...patch };
    setDraft({ ...draft, referenceRanges: next });
  };
  const rrRemove = (idx) => {
    const next = [...(draft.referenceRanges || [])];
    next.splice(idx, 1);
    setDraft({ ...draft, referenceRanges: next });
  };
  const remove = async (t) => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    const ask = await safetyConfirm({
      id: 'admin.test.delete',
      tone: 'danger',
      title: 'Delete test',
      message: 'This removes the test definition from future ordering and configuration screens.',
      facts: [
        safetyFact('test id', t.id),
        safetyFact('code', t.code),
        safetyFact('name', t.name),
        safetyFact('loinc', t.loinc),
      ],
      entityType: 'test',
      entityId: t.id,
      confirmLabel: 'Delete test',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    const fresh = await window.db.get('tests', t.id);
    if (!fresh) return;
    await window.db.delete('tests', t.id);
    if (editingId === t.id) cancel();
  };

  const toggleActive = async (t) => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    const nextActive = t.active === false;
    const ask = await confirmConfigChange({
      id: nextActive ? 'admin.test.activate' : 'admin.test.deactivate',
      title: nextActive ? 'Activate test' : 'Deactivate test',
      message: 'This changes whether the test can be used for ordering and interface intake.',
      facts: [
        safetyFact('test id', t.id),
        safetyFact('code', t.code),
        safetyFact('name', t.name),
        safetyFact('next state', nextActive ? 'active' : 'inactive'),
      ],
      entityType: 'test',
      entityId: t.id,
      confirmLabel: nextActive ? 'Activate test' : 'Deactivate test',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    const fresh = await window.db.get('tests', t.id);
    if (!fresh) return;
    await window.db.put('tests', { ...fresh, active: nextActive });
  };

  return (
    <Page label="Test Catalog">
      <PageHeader title="Test Catalog" sub="Manage test definitions: codes, LOINC, units, default reference ranges."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}
            disabled={!canEditTestCatalog}
            title={permissionTitle(canEditTestCatalog, 'Create new test', 'edit the test catalog')}><IconPlus size={13}/> New test</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 360px' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search by code, name, LOINC…" style={{ height: 28, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {tests.length}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">{tests.length === 0 ? 'No tests yet' : 'No tests match'}</div>
                <div className="empty-sub">{tests.length === 0 ? 'Create your first test or add one inline from a New Order.' : 'Adjust the search.'}</div>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Code</th><th>Name</th><th>LOINC</th><th>Units</th><th>Ref range</th><th>TAT</th>
                    <th style={{ width: 100 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map(t => (
                    <tr key={t.id} style={{ opacity: t.active === false ? 0.5 : 1, background: editingId === t.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(t)}
                        style={{ cursor: canEditTestCatalog ? 'pointer' : 'not-allowed' }}
                        title={permissionTitle(canEditTestCatalog, t.active === false ? 'Inactive - click to activate' : 'Active - click to deactivate', 'edit the test catalog')}>
                        <span className="dot" data-tone={t.active === false ? 'idle' : 'ok'}/>
                      </td>
                      <td><span className="mono">{t.code}</span></td>
                      <td>{t.name}{t.shortName && <span style={{ marginLeft: 6, color: 'var(--ink-400)', fontSize: 11.5 }}>({t.shortName})</span>}</td>
                      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{t.loinc || '—'}</span></td>
                      <td>{t.units || '—'}</td>
                      <td className="mono tnum" style={{ color: 'var(--ink-500)' }}>
                        {t.refRangeLow != null && t.refRangeHigh != null ? `${t.refRangeLow}–${t.refRangeHigh}` : '—'}
                      </td>
                      <td className="mono tnum" style={{ color: 'var(--ink-500)' }}>
                        {Number.isFinite(Number(t.turnaroundMinutes)) && Number(t.turnaroundMinutes) > 0 ? `${t.turnaroundMinutes}m` : '—'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-size="xs" onClick={() => startEdit(t)}
                            disabled={!canEditTestCatalog}
                            title={permissionTitle(canEditTestCatalog, 'Edit test', 'edit the test catalog')}>Edit</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(t)}
                            disabled={!canEditTestCatalog}
                            title={permissionTitle(canEditTestCatalog, 'Delete test', 'edit the test catalog')}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filtered.length > 0 && <TablePagination {...pager}/>}
          </div>
        </div>

        {draft && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{editingId ? 'Edit test' : 'New test'}</span>
              <div style={{ flex: 1 }}/>
              <button className="btn" data-size="xs" data-variant="ghost" onClick={cancel}>Cancel</button>
            </div>
            <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
              <CatalogField label="Code" mono required>
                <input className="input mono" autoFocus value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })}/>
              </CatalogField>
              <CatalogField label="Name" required>
                <input className="input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/>
              </CatalogField>
              <CatalogField label="Short name">
                <input className="input" value={draft.shortName} onChange={e => setDraft({ ...draft, shortName: e.target.value })} placeholder="Optional display name"/>
              </CatalogField>
              <CatalogField label="LOINC code">
                <input className="input mono" value={draft.loinc} onChange={e => setDraft({ ...draft, loinc: e.target.value })} placeholder="e.g., 2345-7"/>
              </CatalogField>
              <CatalogField label="Units">
                <input className="input mono" value={draft.units} onChange={e => setDraft({ ...draft, units: e.target.value })} placeholder="UCUM (mg/dL, mmol/L, …)"/>
              </CatalogField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Default low">
                  <input className="input mono tnum" value={draft.refRangeLow} onChange={e => setDraft({ ...draft, refRangeLow: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Default high">
                  <input className="input mono tnum" value={draft.refRangeHigh} onChange={e => setDraft({ ...draft, refRangeHigh: e.target.value })}/>
                </CatalogField>
              </div>
              <CatalogField label="TAT target (min)">
                <input className="input mono tnum" value={draft.turnaroundMinutes}
                  onChange={e => setDraft({ ...draft, turnaroundMinutes: e.target.value })}
                  placeholder="Overrides priority target"/>
              </CatalogField>

              <div style={{ marginTop: 6, marginBottom: 10, padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                  <span className="section-title" style={{ fontSize: 9.5 }}>Demographic ranges</span>
                  <span style={{ flex: 1 }}/>
                  <button className="btn" data-size="xs" onClick={rrAdd}><IconPlus size={11}/> Add range</button>
                </div>
                {(!draft.referenceRanges || draft.referenceRanges.length === 0) ? (
                  <div style={{ fontSize: 11, color: 'var(--ink-400)', padding: '4px 0' }}>
                    No demographic-specific ranges. Results fall back to the default range above.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {draft.referenceRanges.map((rr, idx) => (
                      <RefRangeRow key={rr.id || idx}
                        rr={rr}
                        onChange={patch => rrUpdate(idx, patch)}
                        onRemove={() => rrRemove(idx)}
                        testUnits={draft.units}/>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-400)' }}>
                  Resolution: most-specific match wins (sex + age + method + effective). If none match, default range is used.
                </div>
              </div>

              <div style={{ marginTop: 6, marginBottom: 10, padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Critical-result escalation</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <CatalogField label="T1 supervisor (sec)">
                    <input className="input mono tnum" placeholder="default 45"
                      value={draft.criticalEscalationT1Sec}
                      onChange={e => setDraft({ ...draft, criticalEscalationT1Sec: e.target.value })}/>
                  </CatalogField>
                  <CatalogField label="T2 director (sec)">
                    <input className="input mono tnum" placeholder="default 90"
                      value={draft.criticalEscalationT2Sec}
                      onChange={e => setDraft({ ...draft, criticalEscalationT2Sec: e.target.value })}/>
                  </CatalogField>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                  Per-test override for unacknowledged critical results. Empty = use global default. T2 must be greater than T1; otherwise both fall back to defaults.
                </div>
              </div>

              <div style={{ marginTop: 6, marginBottom: 10, padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>QC lot expiration warning</div>
                <CatalogField label="Amber threshold (days)">
                  <input className="input mono tnum" placeholder="default 14"
                    value={draft.lotExpirationAmberDays}
                    onChange={e => setDraft({ ...draft, lotExpirationAmberDays: e.target.value })}/>
                </CatalogField>
                <div style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                  Days before a QC lot expires when the watcher should fire the
                  "expiring soon" notification. Empty = use global default (14).
                  Useful when this test's reagent has a tighter shelf life than
                  most and the lab wants earlier warning.
                </div>
              </div>

              <div style={{ marginTop: 6, marginBottom: 10, padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Delta check</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <CatalogField label="% change threshold">
                    <input className="input mono tnum" placeholder="e.g. 20"
                      value={draft.deltaCheckPercent}
                      onChange={e => setDraft({ ...draft, deltaCheckPercent: e.target.value })}/>
                  </CatalogField>
                  <CatalogField label={`Absolute Δ (${draft.units || 'units'})`}>
                    <input className="input mono tnum" placeholder="e.g. 1.5"
                      value={draft.deltaCheckAbsolute}
                      onChange={e => setDraft({ ...draft, deltaCheckAbsolute: e.target.value })}/>
                  </CatalogField>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                  Per-test thresholds for the <span className="mono" style={{ fontSize: 10 }}>result.delta.test</span> rules condition.
                  The condition fires when either threshold is exceeded. Empty = no per-test gate
                  (use explicit values in individual rule conditions instead).
                </div>
              </div>

              <CatalogField label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                  <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>
                  Available for ordering
                </label>
              </CatalogField>
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button className="btn" data-size="sm" onClick={cancel}>Cancel</button>
              <button className="btn" data-variant="primary" data-size="sm" onClick={save}
                disabled={!draft.code || !draft.name || !canEditTestCatalog}
                title={permissionTitle(canEditTestCatalog, editingId ? 'Save test' : 'Create test', 'edit the test catalog')}>
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
};

// One row in the demographic ranges editor. Pure controlled component —
// parent owns the array, child only knows about itself.
const RefRangeRow = ({ rr, onChange, onRemove, testUnits }) => {
  const cellStyle = { fontSize: 11, height: 24 };
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 4, padding: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '60px 60px 70px 60px 60px 1fr 24px', gap: 6, alignItems: 'center' }}>
        <input className="input mono tnum" placeholder="low" value={rr.low}
          onChange={e => onChange({ low: e.target.value })} style={cellStyle}/>
        <input className="input mono tnum" placeholder="high" value={rr.high}
          onChange={e => onChange({ high: e.target.value })} style={cellStyle}/>
        <input className="input mono" placeholder={testUnits || 'units'} value={rr.units}
          onChange={e => onChange({ units: e.target.value })} style={cellStyle}/>
        <select className="input" value={rr.sex || 'any'}
          onChange={e => onChange({ sex: e.target.value })} style={cellStyle}>
          <option value="any">any sex</option>
          <option value="M">M</option>
          <option value="F">F</option>
          <option value="X">X</option>
        </select>
        <input className="input tnum" placeholder="ageMin" value={rr.ageMinYears}
          onChange={e => onChange({ ageMinYears: e.target.value })} style={cellStyle}/>
        <input className="input tnum" placeholder="ageMax" value={rr.ageMaxYears}
          onChange={e => onChange({ ageMaxYears: e.target.value })} style={cellStyle}/>
        <button className="btn" data-variant="ghost" data-size="xs" onClick={onRemove} title="Remove range" style={{ padding: 0, height: 24, width: 24, justifyContent: 'center' }}>
          <IconClose size={11}/>
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
        <input className="input" placeholder="Method (optional, e.g. instrument id)" value={rr.method || ''}
          onChange={e => onChange({ method: e.target.value })} style={cellStyle}/>
        <input className="input" placeholder="Notes (optional)" value={rr.notes || ''}
          onChange={e => onChange({ notes: e.target.value })} style={cellStyle}/>
      </div>
    </div>
  );
};

const CatalogField = ({ label, required, mono, children }) => (
  <div style={{ marginBottom: 10 }}>
    <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>
      {label}{required && <span style={{ color: 'var(--err-700)', marginLeft: 4 }}>*</span>}
    </div>
    {children}
  </div>
);

// ===== Clients (referring clinics / outreach customers) =====
const ClientsPage = ({ onBack }) => {
  const clients = window.useEntities('clients');
  const orders = window.useEntities('orders');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');
  const canEditLabConfig = hasPermission('EDIT_LAB_CONFIG');

  const ordersByClient = useMemoOS(() => {
    const m = {};
    for (const o of orders) if (o.clientId) m[o.clientId] = (m[o.clientId] || 0) + 1;
    return m;
  }, [orders]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...clients]
      .filter(c => !needle || [c.code, c.name, c.contactName, c.type].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [clients, q]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    setEditingId(null);
    setDraft({ code: '', name: '', type: 'CLINIC', contactName: '', phone: '', fax: '', email: '', deliveryChannel: 'fax', deliveryEndpoint: '', billType: 'CLIENT', active: true });
  };
  const startEdit = (c) => { if (!hasPermission('EDIT_LAB_CONFIG')) return; setEditingId(c.id); setDraft({ ...c }); };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    if (!draft || !draft.code || !draft.name) return;
    if (editingId) {
      const existing = clients.find(c => c.id === editingId);
      if (existing) await window.db.put('clients', { ...existing, ...draft });
    } else {
      const c = window.schema.newClient(draft);
      await window.db.put('clients', c);
    }
    cancel();
  };
  const remove = async (c) => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    if ((ordersByClient[c.id] || 0) > 0) {
      await safetyNotice({
        tone: 'warning',
        title: 'Client delete blocked',
        message: 'Orders reference this client. Deactivate it instead of deleting.',
        facts: [
          safetyFact('client', ((c.code || '') + ' ' + (c.name || '')).trim()),
          safetyFact('referencing orders', ordersByClient[c.id]),
        ],
      });
      return;
    }
    const ask = await safetyConfirm({
      id: 'admin.client.delete',
      tone: 'danger',
      title: 'Delete client',
      message: 'This removes the referring client account from configuration.',
      facts: [
        safetyFact('client id', c.id),
        safetyFact('code', c.code),
        safetyFact('name', c.name),
        safetyFact('delivery', [c.deliveryChannel, c.deliveryEndpoint].filter(Boolean).join(' ')),
      ],
      entityType: 'client',
      entityId: c.id,
      confirmLabel: 'Delete client',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const fresh = await window.db.get('clients', c.id);
    if (!fresh) return;
    await window.db.delete('clients', c.id);
    if (editingId === c.id) cancel();
  };

  const toggleActive = async (c) => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const nextActive = c.active === false;
    const ask = await confirmConfigChange({
      id: nextActive ? 'admin.client.activate' : 'admin.client.deactivate',
      title: nextActive ? 'Activate client' : 'Deactivate client',
      message: 'This changes whether the client can be selected for new orders and intake.',
      facts: [
        safetyFact('client id', c.id),
        safetyFact('code', c.code),
        safetyFact('name', c.name),
        safetyFact('next state', nextActive ? 'active' : 'inactive'),
      ],
      entityType: 'client',
      entityId: c.id,
      confirmLabel: nextActive ? 'Activate client' : 'Deactivate client',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const fresh = await window.db.get('clients', c.id);
    if (!fresh) return;
    await window.db.put('clients', { ...fresh, active: nextActive });
  };

  return (
    <Page label="Clients">
      <PageHeader title="Clients" sub="Referring clinics and outreach customers — orders pin a client at intake."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}
            disabled={!canEditLabConfig}
            title={permissionTitle(canEditLabConfig, 'Create new client', 'edit lab configuration')}><IconPlus size={13}/> New client</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 380px' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search code, name, contact…" style={{ height: 28, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {clients.length}</span>
          </div>
          {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">{clients.length === 0 ? 'No clients yet' : 'No clients match'}</div>
                <div className="empty-sub">{clients.length === 0 ? 'Add a referring clinic. Orders will pin one at the time of entry.' : 'Adjust the search.'}</div>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Code</th><th>Name</th><th>Type</th>
                    <th>Delivery</th><th>Contact</th><th>Orders</th>
                    <th style={{ width: 100 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map(c => (
                    <tr key={c.id} style={{ opacity: c.active === false ? 0.5 : 1, background: editingId === c.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(c)}
                        style={{ cursor: canEditLabConfig ? 'pointer' : 'not-allowed' }}
                        title={permissionTitle(canEditLabConfig, c.active === false ? 'Inactive - click to activate' : 'Active - click to deactivate', 'edit lab configuration')}>
                        <span className="dot" data-tone={c.active === false ? 'idle' : 'ok'}/>
                      </td>
                      <td><span className="mono">{c.code}</span></td>
                      <td>{c.name}</td>
                      <td><span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{(c.type || '—').toLowerCase()}</span></td>
                      <td><span style={{ fontSize: 11.5, color: 'var(--ink-700)' }}>{c.deliveryChannel || '—'}</span>{c.deliveryEndpoint && <span className="mono" style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-400)' }}>{c.deliveryEndpoint}</span>}</td>
                      <td>{c.contactName || c.phone || '—'}</td>
                      <td className="mono tnum">{ordersByClient[c.id] || 0}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-size="xs" onClick={() => startEdit(c)}
                            disabled={!canEditLabConfig}
                            title={permissionTitle(canEditLabConfig, 'Edit client', 'edit lab configuration')}>Edit</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(c)}
                            disabled={!canEditLabConfig}
                            title={permissionTitle(canEditLabConfig, 'Delete client', 'edit lab configuration')}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filtered.length > 0 && <TablePagination {...pager}/>}
        </div>

        {draft && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{editingId ? 'Edit client' : 'New client'}</span>
              <div style={{ flex: 1 }}/>
              <button className="btn" data-size="xs" data-variant="ghost" onClick={cancel}>Cancel</button>
            </div>
            <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
              <CatalogField label="Code" required>
                <input className="input mono" autoFocus value={draft.code}
                  onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase() })}/>
              </CatalogField>
              <CatalogField label="Name" required>
                <input className="input" value={draft.name} placeholder="St Joseph Family Clinic"
                  onChange={e => setDraft({ ...draft, name: e.target.value })}/>
              </CatalogField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Type">
                  <select className="input" value={draft.type}
                    onChange={e => setDraft({ ...draft, type: e.target.value })}>
                    <option value="CLINIC">Clinic</option>
                    <option value="HOSPITAL">Hospital</option>
                    <option value="PHYSICIAN_OFFICE">Physician office</option>
                    <option value="OTHER">Other</option>
                  </select>
                </CatalogField>
                <CatalogField label="Bill type">
                  <select className="input" value={draft.billType}
                    onChange={e => setDraft({ ...draft, billType: e.target.value })}>
                    <option value="CLIENT">Client</option>
                    <option value="PATIENT">Patient</option>
                    <option value="INSURANCE">Insurance</option>
                    <option value="HOSPITAL">Hospital</option>
                  </select>
                </CatalogField>
              </div>
              <CatalogField label="Contact name">
                <input className="input" value={draft.contactName}
                  onChange={e => setDraft({ ...draft, contactName: e.target.value })}/>
              </CatalogField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Phone">
                  <input className="input mono" value={draft.phone}
                    onChange={e => setDraft({ ...draft, phone: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Fax">
                  <input className="input mono" value={draft.fax}
                    onChange={e => setDraft({ ...draft, fax: e.target.value })}/>
                </CatalogField>
              </div>
              <CatalogField label="Email">
                <input className="input" value={draft.email}
                  onChange={e => setDraft({ ...draft, email: e.target.value })}/>
              </CatalogField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Delivery channel">
                  <select className="input" value={draft.deliveryChannel}
                    onChange={e => setDraft({ ...draft, deliveryChannel: e.target.value })}>
                    <option value="fax">Fax</option>
                    <option value="hl7">HL7</option>
                    <option value="portal">Portal</option>
                    <option value="email">Email</option>
                    <option value="print">Print/Courier</option>
                  </select>
                </CatalogField>
                <CatalogField label="Delivery endpoint">
                  <input className="input mono" value={draft.deliveryEndpoint}
                    placeholder="fax #, HL7 id, URL…"
                    onChange={e => setDraft({ ...draft, deliveryEndpoint: e.target.value })}/>
                </CatalogField>
              </div>
              <CatalogField label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                  <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>
                  Available for new orders
                </label>
              </CatalogField>
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button className="btn" data-size="sm" onClick={cancel}>Cancel</button>
              <button className="btn" data-variant="primary" data-size="sm" onClick={save}
                disabled={!draft.code || !draft.name || !canEditLabConfig}
                title={permissionTitle(canEditLabConfig, editingId ? 'Save client' : 'Create client', 'edit lab configuration')}>
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
};

// ===== Locations (facilities, departments, draw stations) =====
const LOCATION_TYPES = ['LAB','DRAW_STATION','HOSPITAL','CLINIC','OTHER'];
const DEPARTMENT_OPTIONS = ['CHEMISTRY','HEMATOLOGY','MICROBIOLOGY','IMMUNOLOGY','URINALYSIS','BLOOD_BANK','MOLECULAR','TOXICOLOGY','PATHOLOGY'];

const LocationsPage = ({ onBack }) => {
  const all = window.useEntities('locations');
  const orders = window.useEntities('orders');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');
  const canEditLabConfig = hasPermission('EDIT_LAB_CONFIG');

  // Order counts by location: prefer the locationId FK, fall back to a string
  // match against `facility` (legacy / one-off orders). The display picks
  // whichever yields a count for the row.
  const ordersByLocId = useMemoOS(() => {
    const m = {};
    for (const o of orders) if (o.locationId) m[o.locationId] = (m[o.locationId] || 0) + 1;
    return m;
  }, [orders]);
  const ordersByLocCode = useMemoOS(() => {
    const m = {};
    for (const o of orders) {
      if (o.facility) m[o.facility] = (m[o.facility] || 0) + 1;
    }
    return m;
  }, [orders]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...all]
      .filter(l => !needle || [l.code, l.name, l.type, l.notes].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [all, q]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    setEditingId(null);
    setDraft({ code: '', name: '', type: 'LAB', parentId: '', phone: '', hours: '', departments: [], notes: '', active: true });
  };
  const startEdit = (l) => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    setEditingId(l.id);
    setDraft({
      code: l.code || '', name: l.name || '', type: l.type || 'LAB',
      parentId: l.parentId || '', phone: l.phone || '', hours: l.hours || '',
      departments: Array.isArray(l.departments) ? [...l.departments] : [],
      notes: l.notes || '', active: l.active !== false,
    });
  };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    if (!draft || !draft.code || !draft.name) return;
    const init = { ...draft, parentId: draft.parentId || null };
    if (editingId) {
      const existing = all.find(l => l.id === editingId);
      if (existing) await window.db.put('locations', { ...existing, ...init });
    } else {
      const l = window.schema.newLocation(init);
      await window.db.put('locations', l);
    }
    cancel();
  };
  const remove = async (l) => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const ask = await safetyConfirm({
      id: 'admin.location.delete',
      tone: 'danger',
      title: 'Delete location',
      message: 'This removes the facility or draw-station configuration.',
      facts: [
        safetyFact('location id', l.id),
        safetyFact('code', l.code),
        safetyFact('name', l.name),
        safetyFact('type', l.type),
      ],
      entityType: 'location',
      entityId: l.id,
      confirmLabel: 'Delete location',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const fresh = await window.db.get('locations', l.id);
    if (!fresh) return;
    await window.db.delete('locations', l.id);
    if (editingId === l.id) cancel();
  };

  const toggleDept = (d) => {
    setDraft(s => ({
      ...s,
      departments: s.departments.includes(d)
        ? s.departments.filter(x => x !== d)
        : [...s.departments, d],
    }));
  };
  const toggleActive = async (l) => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const nextActive = l.active === false;
    const ask = await confirmConfigChange({
      id: nextActive ? 'admin.location.activate' : 'admin.location.deactivate',
      title: nextActive ? 'Activate location' : 'Deactivate location',
      message: 'This changes whether the location can be selected for ordering, routing, and reporting.',
      facts: [
        safetyFact('location id', l.id),
        safetyFact('code', l.code),
        safetyFact('name', l.name),
        safetyFact('type', l.type),
        safetyFact('next state', nextActive ? 'active' : 'inactive'),
      ],
      entityType: 'location',
      entityId: l.id,
      confirmLabel: nextActive ? 'Activate location' : 'Deactivate location',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const fresh = await window.db.get('locations', l.id);
    if (!fresh) return;
    await window.db.put('locations', { ...fresh, active: nextActive });
  };

  const parentOptions = useMemoOS(
    () => all.filter(l => l.type === 'LAB' && l.id !== editingId),
    [all, editingId]
  );

  return (
    <Page label="Locations">
      <PageHeader title="Locations" sub="Facilities, departments, and draw stations the lab serves."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}
            disabled={!canEditLabConfig}
            title={permissionTitle(canEditLabConfig, 'Create new location', 'edit lab configuration')}><IconPlus size={13}/> New location</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 380px' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search by code, name, type, notes…" style={{ height: 28, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {all.length}</span>
          </div>
          {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">{all.length === 0 ? 'No locations yet' : 'No locations match'}</div>
                <div className="empty-sub">{all.length === 0 ? 'Create the lab and any draw stations or partner facilities.' : 'Adjust the search.'}</div>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Code</th><th>Name</th><th>Type</th>
                    <th>Departments</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Orders</th>
                    <th style={{ width: 100 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pager.slice.map(l => (
                    <tr key={l.id} style={{ opacity: l.active === false ? 0.5 : 1, background: editingId === l.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(l)}
                        style={{ cursor: canEditLabConfig ? 'pointer' : 'not-allowed' }}
                        title={permissionTitle(canEditLabConfig, l.active === false ? 'Inactive - click to activate' : 'Active - click to deactivate', 'edit lab configuration')}>
                        <span className="dot" data-tone={l.active === false ? 'idle' : 'ok'}/>
                      </td>
                      <td><span className="mono">{l.code}</span></td>
                      <td>{l.name}</td>
                      <td><span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{(l.type || 'LAB').toLowerCase().replace('_',' ')}</span></td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {(l.departments || []).slice(0, 3).map(d =>
                            <span key={d} className="pill" data-tone="ghost" style={{ fontSize: 9.5, height: 18 }}>{d.toLowerCase()}</span>
                          )}
                          {(l.departments || []).length > 3 && <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>+{l.departments.length - 3}</span>}
                        </div>
                      </td>
                      <td className="mono tnum" style={{ textAlign: 'right', color: 'var(--ink-500)' }}>{(ordersByLocId[l.id] || 0) + (ordersByLocCode[l.code] || 0) + (ordersByLocCode[l.name] || 0)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-size="xs" onClick={() => startEdit(l)}
                            disabled={!canEditLabConfig}
                            title={permissionTitle(canEditLabConfig, 'Edit location', 'edit lab configuration')}>Edit</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(l)}
                            disabled={!canEditLabConfig}
                            title={permissionTitle(canEditLabConfig, 'Delete location', 'edit lab configuration')}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filtered.length > 0 && <TablePagination {...pager}/>}
        </div>

        {draft && (
          <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{editingId ? 'Edit location' : 'New location'}</span>
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
                <CatalogField label="Type">
                  <select className="input" value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
                    {LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </CatalogField>
                <CatalogField label="Parent (optional)">
                  <select className="input" value={draft.parentId} onChange={e => setDraft({ ...draft, parentId: e.target.value })}>
                    <option value="">— none —</option>
                    {parentOptions.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                  </select>
                </CatalogField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Phone">
                  <input className="input mono" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="555-0100"/>
                </CatalogField>
                <CatalogField label="Hours">
                  <input className="input" value={draft.hours} onChange={e => setDraft({ ...draft, hours: e.target.value })} placeholder="M-F 0700-1700"/>
                </CatalogField>
              </div>
              <div style={{ marginTop: 6, marginBottom: 10, padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Departments</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {DEPARTMENT_OPTIONS.map(d => {
                    const on = draft.departments.includes(d);
                    return (
                      <button key={d} type="button" onClick={() => toggleDept(d)}
                        className="pill" data-tone={on ? 'sage' : 'ghost'}
                        style={{ cursor: 'pointer', height: 22, padding: '0 9px', border: 'none', fontSize: 11 }}>
                        {d.toLowerCase().replace('_',' ')}
                      </button>
                    );
                  })}
                </div>
              </div>
              <CatalogField label="Notes">
                <textarea className="input" rows={3} value={draft.notes}
                  onChange={e => setDraft({ ...draft, notes: e.target.value })}
                  style={{ height: 'auto', padding: 8, resize: 'vertical' }}/>
              </CatalogField>
              <CatalogField label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                  <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>
                  Available for use
                </label>
              </CatalogField>
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button className="btn" data-size="sm" onClick={cancel}>Cancel</button>
              <button className="btn" data-variant="primary" data-size="sm" onClick={save}
                disabled={!draft.code || !draft.name || !canEditLabConfig}
                title={permissionTitle(canEditLabConfig, editingId ? 'Save location' : 'Create location', 'edit lab configuration')}>
                {editingId ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
};

// ===== Labels & Printing (ZPL templates + printer config) =====
