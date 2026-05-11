// tox-pages.jsx — Toxicology admin surfaces.
//
//   ToxPanelsPage      — predefined UDS panels (5-panel, 10-panel, …) with
//                        screen analytes + cutoffs, and confirmation tests
//                        triggered when a screen trips its cutoff.
//   ChainOfCustodyPage — list of forensic/DOT/employer-tox specimens with
//                        their chain-of-custody state (sealed, breaks,
//                        signatures). Add COC to a specimen, record a
//                        break (with reason), close-out at the bench.
//
// Schema: newToxPanel; specimen.chainOfCustody object; lab_config.toxicology
// flags govern cascade and MRO review.

const TOX_CATEGORIES = ['employment', 'dot', 'court', 'clinical', 'pain_mgmt'];
const COMMON_ANALYTES = [
  'AMP',   // amphetamines
  'METH',  // methamphetamine
  'COC',   // cocaine metabolite
  'OPI',   // opiates
  'OXY',   // oxycodone
  'BZO',   // benzodiazepines
  'BAR',   // barbiturates
  'MDMA',  // ecstasy
  'PCP',   // phencyclidine
  'THC',   // marijuana metabolite
  'MTD',   // methadone
  'PPX',   // propoxyphene
  'BUP',   // buprenorphine
  'FYL',   // fentanyl
  'TRA',   // tramadol
  'ETG',   // ethyl glucuronide (alcohol)
];

// ── ToxPanelsPage ─────────────────────────────────────────────────
const ToxPanelsPage = ({ onBack }) => {
  const panels = window.useEntities('tox_panels');
  const canEdit = hasPermission('EDIT_TEST_CATALOG');
  const [q, setQ] = useStateOS('');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...panels]
      .filter(p => !needle || [p.name, p.category, ...(p.screenTests || []).map(s => s.analyte)].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [panels, q]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!canEdit) return;
    setEditingId(null);
    setDraft(window.schema.newToxPanel({ name: 'New panel', category: 'employment', screenTests: [], confirmTests: [] }));
  };
  const startEdit = (p) => { if (!canEdit) return; setEditingId(p.id); setDraft({ ...p, screenTests: [...(p.screenTests || [])], confirmTests: [...(p.confirmTests || [])] }); };
  const cancel = () => { setEditingId(null); setDraft(null); };

  const save = async () => {
    if (!canEdit || !draft || !draft.name) return;
    const existing = await window.db.get('tox_panels', draft.id);
    const next = { ...(existing || {}), ...draft, updatedAt: Date.now() };
    if (!existing) next.createdAt = next.createdAt || Date.now();
    await window.db.put('tox_panels', next);
    cancel();
  };

  const remove = async (p) => {
    if (!canEdit) return;
    const ask = await safetyConfirm({
      id: 'admin.tox_panel.delete', tone: 'danger', title: 'Delete tox panel',
      message: 'Removes the panel. Orders that referenced it keep their testIds — the panel reference itself is informational.',
      facts: [safetyFact('panel', p.name), safetyFact('analytes', String((p.screenTests || []).length))],
      entityType: 'tox_panel', entityId: p.id, confirmLabel: 'Delete panel',
    });
    if (!ask.confirmed) return;
    await window.db.delete('tox_panels', p.id);
    if (editingId === p.id) cancel();
  };

  const toggleAnalyte = (kind, analyte) => {
    setDraft(d => {
      const arr = Array.isArray(d[kind]) ? [...d[kind]] : [];
      const idx = arr.findIndex(x => x.analyte === analyte);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push({ analyte, cutoff: kind === 'screenTests' ? 50 : 25 });
      return { ...d, [kind]: arr };
    });
  };
  const setCutoff = (kind, analyte, val) => {
    setDraft(d => ({
      ...d,
      [kind]: (d[kind] || []).map(x => x.analyte === analyte ? { ...x, cutoff: Number(val) || 0 } : x),
    }));
  };

  return (
    <Page label="Tox Panels">
      <PageHeader title="UDS Panels"
        sub="Urine drug screen panels. Each analyte has an immunoassay cutoff; positives auto-add the confirmation test (when cascade enabled in lab config)."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Toxicology</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={startNew} disabled={!canEdit}
            title={permissionTitle(canEdit, 'Add panel', 'edit test catalog')}><IconPlus size={13}/> Add panel</button>,
        ]}/>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search panels…" style={{ width: 280, height: 28 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {panels.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['Panel', 'Category', 'Screen analytes', 'Confirm analytes', 'COC required', 'Status']}
              message="No tox panels"
              sub="Add panels here, or run seed.demo() for a 5-panel / 10-panel / pain-management starter set."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>Panel</th><th>Category</th><th>Screen</th><th>Confirm</th><th>COC</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(p => (
                  <tr key={p.id} style={{ opacity: p.active === false ? 0.55 : 1, background: editingId === p.id ? 'var(--sage-50)' : undefined }}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td><span className="pill" data-tone="ghost">{p.category}</span></td>
                    <td>
                      {(p.screenTests || []).slice(0, 6).map(s => (
                        <span key={s.analyte} className="pill" data-tone="info" style={{ marginRight: 4, height: 18, padding: '0 6px', fontSize: 10.5 }}>
                          <span className="mono">{s.analyte}</span>
                        </span>
                      ))}
                      {(p.screenTests || []).length > 6 && <span style={{ color: 'var(--ink-400)', fontSize: 11 }}>+{(p.screenTests || []).length - 6}</span>}
                    </td>
                    <td>{(p.confirmTests || []).length}</td>
                    <td>{p.cocRequired ? <span className="pill" data-tone="amber">Required</span> : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                    <td><span className="pill" data-tone={p.active === false ? 'ghost' : 'sage'}>{p.active === false ? 'inactive' : 'active'}</span></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn" data-size="xs" data-variant="ghost" onClick={() => startEdit(p)} disabled={!canEdit}>Edit</button>
                      <button className="btn" data-size="xs" data-variant="ghost" onClick={() => remove(p)} disabled={!canEdit}>Delete</button>
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
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? 'Edit panel' : 'New panel'}</span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={cancel}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!draft.name}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="field-label">Panel name</div>
              <input className="input" value={draft.name || ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Category</div>
              <select className="input" value={draft.category || 'employment'} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} style={{ width: '100%' }}>
                {TOX_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Chain of custody</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.cocRequired !== false} onChange={e => setDraft(d => ({ ...d, cocRequired: e.target.checked }))}/>
                Required for specimens on this panel
              </label>
            </div>
            <div>
              <div className="field-label">Active</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}/>
                Selectable on new orders
              </label>
            </div>
          </div>

          <div className="section-title" style={{ fontSize: 11, marginBottom: 6 }}>Screen analytes ({(draft.screenTests || []).length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {COMMON_ANALYTES.map(a => {
              const on = (draft.screenTests || []).some(x => x.analyte === a);
              return (
                <button key={a} type="button"
                  onClick={() => toggleAnalyte('screenTests', a)}
                  className="pill" data-tone={on ? 'info' : 'ghost'}
                  style={{ height: 22, padding: '0 8px', cursor: 'pointer', border: '1px solid var(--line)' }}>
                  <span className="mono">{a}</span>
                </button>
              );
            })}
          </div>
          {(draft.screenTests || []).length > 0 && (
            <table className="tbl" style={{ marginBottom: 12, fontSize: 11.5 }}>
              <thead><tr><th>Analyte</th><th style={{ width: 140 }}>Cutoff (ng/mL)</th></tr></thead>
              <tbody>
                {(draft.screenTests || []).map(s => (
                  <tr key={s.analyte}>
                    <td><span className="mono">{s.analyte}</span></td>
                    <td>
                      <input className="input" type="number" value={s.cutoff}
                        onChange={e => setCutoff('screenTests', s.analyte, e.target.value)}
                        style={{ width: 120, height: 24 }}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="section-title" style={{ fontSize: 11, marginBottom: 6 }}>Confirmation analytes ({(draft.confirmTests || []).length})</div>
          <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 6 }}>Added automatically on screen positives when lab config has tox cascade enabled.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {COMMON_ANALYTES.map(a => {
              const on = (draft.confirmTests || []).some(x => x.analyte === a);
              return (
                <button key={a} type="button"
                  onClick={() => toggleAnalyte('confirmTests', a)}
                  className="pill" data-tone={on ? 'amber' : 'ghost'}
                  style={{ height: 22, padding: '0 8px', cursor: 'pointer', border: '1px solid var(--line)' }}>
                  <span className="mono">{a}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Page>
  );
};

// ── ChainOfCustodyPage ─────────────────────────────────────────────────
//
// Lists specimens linked to a tox-flagged patient. For each, surface the
// COC state (sealed / unsealed / breaks recorded). The drawer lets the
// operator open a COC record on a specimen, record a custody break, or
// close it out at the bench.
const ChainOfCustodyPage = ({ onBack }) => {
  const specimens = window.useEntities('specimens');
  const patients = window.useEntities('patients');
  const orders = window.useEntities('orders');
  const canEdit = hasPermission('ACCESSION');
  const [q, setQ] = useStateOS('');
  const [expandedId, setExpandedId] = useStateOS(null);
  const [breakReason, setBreakReason] = useStateOS('');

  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const orderById = useMemoOS(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);

  const toxSpecs = useMemoOS(() => {
    return specimens.filter(s => {
      const p = patientById[s.patientId];
      return s.chainOfCustody || (p && p.toxFlag === true);
    });
  }, [specimens, patientById]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...toxSpecs]
      .filter(s => {
        if (!needle) return true;
        const p = patientById[s.patientId];
        return [s.accessionNumber, s.barcode, p && p.mrn, p && p.lastName, p && p.firstName,
                s.chainOfCustody && s.chainOfCustody.sealNumber]
          .filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [toxSpecs, q, patientById]);
  const pager = usePagination(filtered);

  const startCoc = async (spec) => {
    if (!canEdit) return;
    const cur = window.currentUser || { id: 'system', firstName: 'system' };
    const sealNumber = 'COC-' + new Date().toISOString().slice(0,10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
    await window.db.put('specimens', {
      ...spec,
      chainOfCustody: {
        sealNumber,
        sealedAt: Date.now(),
        sealedBy: cur.id,
        sealedByName: [cur.firstName, cur.lastName].filter(Boolean).join(' ') || cur.username || cur.id,
        breaks: [],
        closedAt: null,
        closedBy: null,
      },
      updatedAt: Date.now(),
    });
  };

  const recordBreak = async (spec) => {
    if (!canEdit) return;
    if (!spec.chainOfCustody) return;
    const reason = breakReason.trim();
    if (!reason) return;
    const cur = window.currentUser || { id: 'system' };
    const coc = spec.chainOfCustody;
    const next = {
      ...coc,
      breaks: [...(coc.breaks || []), {
        at: Date.now(), by: cur.id,
        byName: [cur.firstName, cur.lastName].filter(Boolean).join(' ') || cur.username || cur.id,
        reason,
      }],
    };
    await window.db.put('specimens', { ...spec, chainOfCustody: next, updatedAt: Date.now() });
    setBreakReason('');
  };

  const closeCoc = async (spec) => {
    if (!canEdit) return;
    if (!spec.chainOfCustody) return;
    const cur = window.currentUser || { id: 'system' };
    await window.db.put('specimens', {
      ...spec,
      chainOfCustody: {
        ...spec.chainOfCustody,
        closedAt: Date.now(),
        closedBy: cur.id,
        closedByName: [cur.firstName, cur.lastName].filter(Boolean).join(' ') || cur.username || cur.id,
      },
      updatedAt: Date.now(),
    });
  };

  const counts = useMemoOS(() => {
    let withCoc = 0, breaks = 0, closed = 0;
    for (const s of toxSpecs) {
      if (!s.chainOfCustody) continue;
      withCoc++;
      if ((s.chainOfCustody.breaks || []).length > 0) breaks++;
      if (s.chainOfCustody.closedAt) closed++;
    }
    return { withCoc, breaks, closed, withoutCoc: toxSpecs.length - withCoc };
  }, [toxSpecs]);

  return (
    <Page label="Chain of Custody">
      <PageHeader title="Chain of Custody"
        sub="Forensic, DOT, employer, and court-ordered specimens. Seal at accession, record breaks, close at the bench."
        actions={onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Toxicology</button>] : []}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Tox specimens" value={toxSpecs.length}/>
        <KpiPanel label="With active COC" value={counts.withCoc}/>
        <KpiPanel label="With recorded breaks" value={counts.breaks} tone={counts.breaks > 0 ? 'rust' : null}/>
        <KpiPanel label="Awaiting seal" value={counts.withoutCoc} tone={counts.withoutCoc > 0 ? 'amber' : null}/>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by MRN, accession, seal #…" style={{ width: 320, height: 28 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {toxSpecs.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['Specimen', 'Patient', 'COC state', 'Seal #', 'Breaks']}
              message="No tox specimens"
              sub="Flip a patient's tox flag in the patient drawer, or run seed.demo() to populate examples."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>Specimen</th><th>Patient</th><th>State</th><th>Seal #</th><th>Breaks</th><th>Sealed by</th><th>Closed</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(s => {
                  const p = patientById[s.patientId];
                  const coc = s.chainOfCustody;
                  const isExpanded = expandedId === s.id;
                  const state = !coc ? 'unsealed' : coc.closedAt ? 'closed' : ((coc.breaks || []).length > 0 ? 'breaks' : 'active');
                  const TONE = { unsealed: 'amber', active: 'sage', breaks: 'rust', closed: 'ghost' };
                  return (
                    <React.Fragment key={s.id}>
                      <tr onClick={() => setExpandedId(isExpanded ? null : s.id)} style={{ cursor: 'pointer', background: isExpanded ? 'var(--ivory-100)' : undefined }}>
                        <td><span className="mono">{s.accessionNumber || s.barcode || s.id.slice(-8)}</span></td>
                        <td>{p ? <span><span className="mono">{p.mrn}</span> · {p.lastName}, {p.firstName}</span> : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                        <td><span className="pill" data-tone={TONE[state]}>{state}</span></td>
                        <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{coc && coc.sealNumber || '—'}</span></td>
                        <td>{coc ? (coc.breaks || []).length : 0}</td>
                        <td>{coc ? coc.sealedByName || coc.sealedBy : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                        <td>{coc && coc.closedAt ? <span className="mono" style={{ fontSize: 11.5 }}>{formatDateTime(coc.closedAt)}</span> : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {!coc && <button className="btn" data-size="xs" data-variant="primary" onClick={e => { e.stopPropagation(); startCoc(s); }} disabled={!canEdit}>Seal</button>}
                          {coc && !coc.closedAt && <button className="btn" data-size="xs" data-variant="ghost" onClick={e => { e.stopPropagation(); closeCoc(s); }} disabled={!canEdit}>Close</button>}
                        </td>
                      </tr>
                      {isExpanded && coc && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--ivory-50)', padding: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                              <div>
                                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Seal record</div>
                                <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '100px 1fr', rowGap: 3 }}>
                                  <span style={{ color: 'var(--ink-400)' }}>Seal #</span><span className="mono">{coc.sealNumber}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Sealed at</span><span className="mono">{formatDateTime(coc.sealedAt)}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Sealed by</span><span>{coc.sealedByName || coc.sealedBy}</span>
                                  {coc.closedAt && <><span style={{ color: 'var(--ink-400)' }}>Closed at</span><span className="mono">{formatDateTime(coc.closedAt)}</span></>}
                                  {coc.closedByName && <><span style={{ color: 'var(--ink-400)' }}>Closed by</span><span>{coc.closedByName}</span></>}
                                </div>
                                {!coc.closedAt && canEdit && (
                                  <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }}>
                                    <div className="field-label">Record custody break</div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                      <input className="input" value={breakReason} onChange={e => setBreakReason(e.target.value)}
                                        placeholder="e.g. transport to confirmation lab"
                                        style={{ height: 28, flex: 1 }}/>
                                      <button className="btn" data-size="sm" data-variant="ghost" onClick={() => recordBreak(s)} disabled={!breakReason.trim()}>
                                        Add break
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Custody breaks ({(coc.breaks || []).length})</div>
                                {(coc.breaks || []).length === 0 ? (
                                  <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No breaks recorded — seal intact.</div>
                                ) : (
                                  <table className="tbl" style={{ fontSize: 11.5 }}>
                                    <thead><tr><th>When</th><th>By</th><th>Reason</th></tr></thead>
                                    <tbody>
                                      {(coc.breaks || []).map((b, i) => (
                                        <tr key={i}>
                                          <td><span className="mono">{formatDateTime(b.at)}</span></td>
                                          <td>{b.byName || b.by}</td>
                                          <td>{b.reason}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>
    </Page>
  );
};

Object.assign(window, { ToxPanelsPage, ChainOfCustodyPage });
