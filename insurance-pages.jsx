// insurance-pages.jsx — Insurance admin surfaces.
//
//   PayorsPage           — carriers (BCBS, Aetna, Medicare, …). CRUD with
//                          payor type, EDI ids, electronic-claim flag.
//   PlansPage            — per-payor product list (PPO, HMO, Medicare A, …)
//                          with prior-auth flags and per-test PA lists.
//   PatientInsurancePage — per-patient enrollment with member id, group,
//                          effective dates, primary/secondary/tertiary
//                          rank. "Check eligibility" is a simulated 270/271
//                          round-trip; the eligibility status persists so
//                          the claim builder can refuse to bill on stale
//                          eligibility.
//
// Schema (schema.js): newPayor, newPlan, newPatientInsurance.
// Collections (db.js): payors, plans, patient_insurance.

const PAYOR_TYPES = ['COMMERCIAL', 'MEDICARE', 'MEDICAID', 'TRICARE', 'WORKERS_COMP', 'SELF_PAY'];
const PLAN_TYPES = ['HMO', 'PPO', 'EPO', 'POS', 'HDHP', 'MEDICARE_A', 'MEDICARE_B', 'MEDICARE_C', 'MEDICAID', 'TRICARE'];
const INS_RANKS = ['PRIMARY', 'SECONDARY', 'TERTIARY'];
const SUB_RELATIONS = ['self', 'spouse', 'child', 'other'];

// ── PayorsPage ─────────────────────────────────────────────────────
const PayorTypePill = ({ type }) => {
  const TONE = {
    COMMERCIAL: 'info', MEDICARE: 'sage', MEDICAID: 'amber',
    TRICARE: 'slate', WORKERS_COMP: 'rust', SELF_PAY: 'ghost',
  };
  return <span className="pill" data-tone={TONE[type] || 'ghost'}>{type}</span>;
};

const PayorsPage = ({ onBack }) => {
  const payors = window.useEntities('payors');
  const plans = window.useEntities('plans');
  const claims = window.useEntities('claims');
  const canEdit = hasPermission('EDIT_LAB_CONFIG');
  const [q, setQ] = useStateOS('');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);

  const planCountByPayor = useMemoOS(() => {
    const m = {};
    for (const p of plans) m[p.payorId] = (m[p.payorId] || 0) + 1;
    return m;
  }, [plans]);
  const claimCountByPayor = useMemoOS(() => {
    const m = {};
    for (const c of claims) m[c.payorId] = (m[c.payorId] || 0) + 1;
    return m;
  }, [claims]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...payors]
      .filter(p => !needle || [p.name, p.code, p.payorId].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [payors, q]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!canEdit) return;
    setEditingId(null);
    setDraft(window.schema.newPayor({ name: 'New payor', type: 'COMMERCIAL' }));
  };
  const startEdit = (p) => { if (!canEdit) return; setEditingId(p.id); setDraft({ ...p }); };
  const cancel = () => { setEditingId(null); setDraft(null); };

  const save = async () => {
    if (!canEdit || !draft || !draft.name) return;
    const existing = await window.db.get('payors', draft.id);
    const next = { ...(existing || {}), ...draft, updatedAt: Date.now() };
    if (!existing) next.createdAt = next.createdAt || Date.now();
    await window.db.put('payors', next);
    cancel();
  };

  const remove = async (p) => {
    if (!canEdit) return;
    const planCount = planCountByPayor[p.id] || 0;
    if (planCount > 0) {
      await safetyNotice({
        tone: 'warning',
        title: 'Cannot delete payor with plans',
        message: `${p.name} has ${planCount} plan${planCount === 1 ? '' : 's'}. Delete the plans first, or deactivate the payor instead.`,
        facts: [safetyFact('payor', p.name), safetyFact('plans', String(planCount))],
      });
      return;
    }
    const ask = await safetyConfirm({
      id: 'admin.payor.delete', tone: 'danger', title: 'Delete payor',
      message: 'Removes the payor record. Existing claims that reference it keep payorId — UI shows "—" for the carrier.',
      facts: [safetyFact('payor', p.name), safetyFact('type', p.type)],
      entityType: 'payor', entityId: p.id, confirmLabel: 'Delete payor',
    });
    if (!ask.confirmed) return;
    await window.db.delete('payors', p.id);
    if (editingId === p.id) cancel();
  };

  return (
    <Page label="Payors">
      <PageHeader title="Payors"
        sub="Insurance carriers — commercial, Medicare, Medicaid, TRICARE, Workers' Comp. Each carrier has one or more plans."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Insurance</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={startNew} disabled={!canEdit}
            title={permissionTitle(canEdit, 'Add payor', 'edit lab config')}><IconPlus size={13}/> Add payor</button>,
        ]}/>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search payors…" style={{ width: 280, height: 28 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {payors.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['Payor', 'Type', 'Code', 'Plans', 'Claims', 'Status']}
              message="No payors"
              sub="Add carriers individually or run seed.demo() for a starter set."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>Payor</th><th>Type</th><th>Code</th><th>EDI id</th><th>Plans</th><th>Claims</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(p => (
                  <tr key={p.id} style={{ opacity: p.active === false ? 0.55 : 1, background: editingId === p.id ? 'var(--sage-50)' : undefined }}>
                    <td style={{ fontWeight: 500 }}>{p.name}</td>
                    <td><PayorTypePill type={p.type}/></td>
                    <td><span className="mono">{p.code || '—'}</span></td>
                    <td><span className="mono" style={{ color: 'var(--ink-500)' }}>{p.payorId || '—'}</span></td>
                    <td className="tnum">{planCountByPayor[p.id] || 0}</td>
                    <td className="tnum">{claimCountByPayor[p.id] || 0}</td>
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
            <span style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? 'Edit payor' : 'New payor'}</span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={cancel}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!draft.name}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="field-label">Name</div>
              <input className="input" value={draft.name || ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Type</div>
              <select className="input" value={draft.type || 'COMMERCIAL'} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} style={{ width: '100%' }}>
                {PAYOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Code (short mnemonic)</div>
              <input className="input" value={draft.code || ''} onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">External payor id (EDI / trading partner)</div>
              <input className="input" value={draft.payorId || ''} onChange={e => setDraft(d => ({ ...d, payorId: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Phone</div>
              <input className="input" value={draft.phone || ''} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Electronic claims</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.electronicClaims !== false} onChange={e => setDraft(d => ({ ...d, electronicClaims: e.target.checked }))}/>
                Submit electronically (837P)
              </label>
            </div>
            <div>
              <div className="field-label">Active</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}/>
                Available for new claims
              </label>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
};

// ── PlansPage ─────────────────────────────────────────────────────
const PlansPage = ({ onBack }) => {
  const plans = window.useEntities('plans');
  const payors = window.useEntities('payors');
  const tests = window.useEntities('tests');
  const canEdit = hasPermission('EDIT_LAB_CONFIG');
  const [q, setQ] = useStateOS('');
  const [payorFilter, setPayorFilter] = useStateOS('');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);

  const payorById = useMemoOS(() => Object.fromEntries(payors.map(p => [p.id, p])), [payors]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...plans]
      .filter(p => !payorFilter || p.payorId === payorFilter)
      .filter(p => !needle || [p.name, p.type, payorById[p.payorId] && payorById[p.payorId].name].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [plans, q, payorFilter, payorById]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!canEdit) return;
    setEditingId(null);
    setDraft(window.schema.newPlan({ name: 'New plan', type: 'PPO', payorId: payors[0] && payors[0].id }));
  };
  const startEdit = (p) => { if (!canEdit) return; setEditingId(p.id); setDraft({ ...p }); };
  const cancel = () => { setEditingId(null); setDraft(null); };

  const save = async () => {
    if (!canEdit || !draft || !draft.name || !draft.payorId) return;
    const existing = await window.db.get('plans', draft.id);
    const next = { ...(existing || {}), ...draft, updatedAt: Date.now() };
    if (!existing) next.createdAt = next.createdAt || Date.now();
    await window.db.put('plans', next);
    cancel();
  };

  const remove = async (p) => {
    if (!canEdit) return;
    const ask = await safetyConfirm({
      id: 'admin.plan.delete', tone: 'danger', title: 'Delete plan',
      message: 'Removes the plan. Patient insurance records that reference it keep planId but will resolve to "—".',
      facts: [safetyFact('plan', p.name), safetyFact('payor', payorById[p.payorId] && payorById[p.payorId].name || '-')],
      entityType: 'plan', entityId: p.id, confirmLabel: 'Delete plan',
    });
    if (!ask.confirmed) return;
    await window.db.delete('plans', p.id);
    if (editingId === p.id) cancel();
  };

  const togglePATest = (testId) => {
    setDraft(d => {
      const arr = Array.isArray(d.paTests) ? [...d.paTests] : [];
      const i = arr.indexOf(testId);
      if (i >= 0) arr.splice(i, 1); else arr.push(testId);
      return { ...d, paTests: arr };
    });
  };

  return (
    <Page label="Plans">
      <PageHeader title="Insurance Plans"
        sub="Per-payor products (PPO, HMO, Medicare A, …). Flag tests that require prior authorization on a given plan."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Insurance</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={startNew} disabled={!canEdit || payors.length === 0}
            title={payors.length === 0 ? 'Add a payor first' : permissionTitle(canEdit, 'Add plan', 'edit lab config')}><IconPlus size={13}/> Add plan</button>,
        ]}/>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select className="input" value={payorFilter} onChange={e => setPayorFilter(e.target.value)} style={{ height: 28 }}>
            <option value="">All payors</option>
            {payors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search plans…" style={{ height: 28, flex: 1, maxWidth: 320 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {plans.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['Plan', 'Payor', 'Type', 'PA required', 'PA tests', 'Status']}
              message="No plans"
              sub="Add plans under a payor here."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>Plan</th><th>Payor</th><th>Type</th><th>PA</th><th>PA tests</th><th>Copay</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(p => {
                  const payor = payorById[p.payorId];
                  return (
                    <tr key={p.id} style={{ opacity: p.active === false ? 0.55 : 1, background: editingId === p.id ? 'var(--sage-50)' : undefined }}>
                      <td style={{ fontWeight: 500 }}>{p.name}</td>
                      <td>{payor ? payor.name : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                      <td><span className="pill" data-tone="ghost">{p.type}</span></td>
                      <td>{p.requiresPA ? <span className="pill" data-tone="amber">Required</span> : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                      <td>{(p.paTests || []).length}</td>
                      <td className="mono tnum">{Number(p.copay) > 0 ? '$' + Number(p.copay).toFixed(2) : '—'}</td>
                      <td><span className="pill" data-tone={p.active === false ? 'ghost' : 'sage'}>{p.active === false ? 'inactive' : 'active'}</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => startEdit(p)} disabled={!canEdit}>Edit</button>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => remove(p)} disabled={!canEdit}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>

      {draft && (
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? 'Edit plan' : 'New plan'}</span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={cancel}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!draft.name || !draft.payorId}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="field-label">Plan name</div>
              <input className="input" value={draft.name || ''} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Type</div>
              <select className="input" value={draft.type || 'PPO'} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} style={{ width: '100%' }}>
                {PLAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Payor</div>
              <select className="input" value={draft.payorId || ''} onChange={e => setDraft(d => ({ ...d, payorId: e.target.value }))} style={{ width: '100%' }}>
                <option value="">— Select payor —</option>
                {payors.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Copay (per visit)</div>
              <input className="input" value={draft.copay || 0}
                onChange={e => setDraft(d => ({ ...d, copay: Number(e.target.value) || 0 }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Prior authorization</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.requiresPA === true} onChange={e => setDraft(d => ({ ...d, requiresPA: e.target.checked }))}/>
                Require PA on flagged tests
              </label>
            </div>
            <div>
              <div className="field-label">Active</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}/>
                Available for new patient enrollments
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Tests requiring PA on this plan ({(draft.paTests || []).length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
                {tests.map(t => {
                  const on = (draft.paTests || []).includes(t.id);
                  return (
                    <button key={t.id} type="button"
                      onClick={() => togglePATest(t.id)}
                      className="pill" data-tone={on ? 'amber' : 'ghost'}
                      style={{ height: 22, padding: '0 8px', cursor: 'pointer', border: '1px solid var(--line)' }}>
                      <span className="mono">{t.code}</span> {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
};

// ── PatientInsurancePage ─────────────────────────────────────────────────────
const ELIGIBILITY_TONE = { active: 'sage', inactive: 'rust', pending: 'amber', unknown: 'ghost' };
const EligibilityPill = ({ status }) => (
  <span className="pill" data-tone={ELIGIBILITY_TONE[status] || 'ghost'}>{status || 'unknown'}</span>
);

const PatientInsurancePage = ({ onBack }) => {
  const insurance = window.useEntities('patient_insurance');
  const patients = window.useEntities('patients');
  const plans = window.useEntities('plans');
  const payors = window.useEntities('payors');
  const canEdit = hasPermission('EDIT_LAB_CONFIG');
  const [q, setQ] = useStateOS('');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [checkingId, setCheckingId] = useStateOS(null);

  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const planById = useMemoOS(() => Object.fromEntries(plans.map(p => [p.id, p])), [plans]);
  const payorById = useMemoOS(() => Object.fromEntries(payors.map(p => [p.id, p])), [payors]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...insurance]
      .filter(i => {
        if (!needle) return true;
        const p = patientById[i.patientId];
        const plan = planById[i.planId];
        return [
          p && p.mrn, p && p.lastName, p && p.firstName,
          plan && plan.name, i.memberId, i.groupNumber,
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        const aP = patientById[a.patientId], bP = patientById[b.patientId];
        return (aP && aP.lastName || '').localeCompare(bP && bP.lastName || '');
      });
  }, [insurance, q, patientById, planById]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!canEdit) return;
    setEditingId(null);
    setDraft(window.schema.newPatientInsurance({ rank: 'PRIMARY', subscriberRelation: 'self' }));
  };
  const startEdit = (i) => { if (!canEdit) return; setEditingId(i.id); setDraft({ ...i }); };
  const cancel = () => { setEditingId(null); setDraft(null); };

  const save = async () => {
    if (!canEdit || !draft || !draft.patientId || !draft.planId || !draft.memberId) return;
    const existing = await window.db.get('patient_insurance', draft.id);
    const next = { ...(existing || {}), ...draft, updatedAt: Date.now() };
    if (!existing) next.createdAt = next.createdAt || Date.now();
    await window.db.put('patient_insurance', next);
    cancel();
  };

  const remove = async (i) => {
    if (!canEdit) return;
    const p = patientById[i.patientId];
    const plan = planById[i.planId];
    const ask = await safetyConfirm({
      id: 'admin.patient_insurance.delete', tone: 'danger', title: 'Delete patient insurance',
      message: 'Removes the enrollment record. Existing claims linked to it keep their patientInsuranceId.',
      facts: [
        safetyFact('patient', p ? `${p.lastName}, ${p.firstName}` : i.patientId),
        safetyFact('plan', plan ? plan.name : i.planId),
        safetyFact('member', i.memberId),
      ],
      entityType: 'patient_insurance', entityId: i.id, confirmLabel: 'Delete enrollment',
    });
    if (!ask.confirmed) return;
    await window.db.delete('patient_insurance', i.id);
    if (editingId === i.id) cancel();
  };

  // Simulated 270/271 eligibility check. In production this hits the
  // payor's clearinghouse with an X12 270 request; here we flip 'unknown'
  // to 'active' (90%) or 'inactive' (10%) after a brief delay so the UI
  // shows the state machine. Real eligibility integration replaces this
  // function body; the surface (status field + checkedAt timestamp) is
  // unchanged so claim builder logic doesn't need to know which path ran.
  const checkEligibility = async (ins) => {
    if (!canEdit) return;
    setCheckingId(ins.id);
    await window.db.put('patient_insurance', { ...ins, eligibilityStatus: 'pending', updatedAt: Date.now() });
    setTimeout(async () => {
      try {
        const fresh = await window.db.get('patient_insurance', ins.id);
        if (!fresh) return;
        const ok = Math.random() < 0.9;
        await window.db.put('patient_insurance', {
          ...fresh,
          eligibilityStatus: ok ? 'active' : 'inactive',
          eligibilityCheckedAt: Date.now(),
          updatedAt: Date.now(),
        });
      } finally {
        setCheckingId(null);
      }
    }, 600);
  };

  return (
    <Page label="Patient Insurance">
      <PageHeader title="Patient Insurance"
        sub="Per-patient enrollments. Each patient may have primary, secondary, tertiary coverage. 'Check eligibility' is a simulated 270/271 round-trip."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Insurance</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={startNew} disabled={!canEdit || plans.length === 0 || patients.length === 0}
            title={plans.length === 0 ? 'Add a plan first' : patients.length === 0 ? 'No patients yet' : permissionTitle(canEdit, 'Add insurance', 'edit lab config')}><IconPlus size={13}/> Add enrollment</button>,
        ]}/>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by patient, plan, member id…" style={{ width: 320, height: 28 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {insurance.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['Patient', 'Plan', 'Payor', 'Member id', 'Rank', 'Eligibility']}
              message="No patient insurance"
              sub="Enroll a patient with the button above, or run seed.demo() for a starter set."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>Patient</th><th>Plan</th><th>Payor</th><th>Member id</th><th>Group</th><th>Rank</th><th>Eligibility</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(i => {
                  const p = patientById[i.patientId];
                  const plan = planById[i.planId];
                  const payor = plan && payorById[plan.payorId];
                  return (
                    <tr key={i.id} style={{ opacity: i.active === false ? 0.55 : 1, background: editingId === i.id ? 'var(--sage-50)' : undefined }}>
                      <td>{p ? <span><span className="mono">{p.mrn}</span> · {p.lastName}, {p.firstName}</span> : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                      <td>{plan ? plan.name : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                      <td>{payor ? payor.name : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                      <td><span className="mono">{i.memberId}</span></td>
                      <td><span className="mono" style={{ color: 'var(--ink-500)' }}>{i.groupNumber || '—'}</span></td>
                      <td><span className="pill" data-tone={i.rank === 'PRIMARY' ? 'sage' : 'ghost'}>{i.rank}</span></td>
                      <td>
                        <EligibilityPill status={checkingId === i.id ? 'pending' : i.eligibilityStatus}/>
                        {i.eligibilityCheckedAt && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-400)' }}>{formatDateTime(i.eligibilityCheckedAt)}</span>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => checkEligibility(i)} disabled={!canEdit || checkingId === i.id}>
                          {checkingId === i.id ? 'Checking…' : 'Check eligibility'}
                        </button>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => startEdit(i)} disabled={!canEdit}>Edit</button>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => remove(i)} disabled={!canEdit}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>

      {draft && (
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? 'Edit enrollment' : 'New patient insurance'}</span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={cancel}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={save}
              disabled={!draft.patientId || !draft.planId || !draft.memberId}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div>
              <div className="field-label">Patient</div>
              <select className="input" value={draft.patientId || ''} onChange={e => setDraft(d => ({ ...d, patientId: e.target.value }))} style={{ width: '100%' }}>
                <option value="">— Select patient —</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.mrn} · {p.lastName}, {p.firstName}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Plan</div>
              <select className="input" value={draft.planId || ''} onChange={e => setDraft(d => ({ ...d, planId: e.target.value }))} style={{ width: '100%' }}>
                <option value="">— Select plan —</option>
                {plans.filter(p => p.active !== false).map(p => {
                  const payor = payorById[p.payorId];
                  return <option key={p.id} value={p.id}>{p.name} ({payor ? payor.name : '?'})</option>;
                })}
              </select>
            </div>
            <div>
              <div className="field-label">Rank</div>
              <select className="input" value={draft.rank || 'PRIMARY'} onChange={e => setDraft(d => ({ ...d, rank: e.target.value }))} style={{ width: '100%' }}>
                {INS_RANKS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Member id</div>
              <input className="input" value={draft.memberId || ''} onChange={e => setDraft(d => ({ ...d, memberId: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Group number</div>
              <input className="input" value={draft.groupNumber || ''} onChange={e => setDraft(d => ({ ...d, groupNumber: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Subscriber relation</div>
              <select className="input" value={draft.subscriberRelation || 'self'} onChange={e => setDraft(d => ({ ...d, subscriberRelation: e.target.value }))} style={{ width: '100%' }}>
                {SUB_RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Effective from</div>
              <input type="date" className="input" value={draft.effectiveFrom || ''} onChange={e => setDraft(d => ({ ...d, effectiveFrom: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Effective to (blank = open)</div>
              <input type="date" className="input" value={draft.effectiveTo || ''} onChange={e => setDraft(d => ({ ...d, effectiveTo: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Active</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}/>
                Available for new claims
              </label>
            </div>
            {draft.subscriberRelation !== 'self' && (
              <div style={{ gridColumn: 'span 2' }}>
                <div className="field-label">Subscriber name</div>
                <input className="input" value={draft.subscriberName || ''} onChange={e => setDraft(d => ({ ...d, subscriberName: e.target.value }))} style={{ width: '100%' }}/>
              </div>
            )}
          </div>
        </div>
      )}
    </Page>
  );
};

Object.assign(window, { PayorsPage, PlansPage, PatientInsurancePage });
