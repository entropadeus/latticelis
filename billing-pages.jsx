// billing-pages.jsx — Billing admin surfaces.
//
//   ChargeCodesPage — CPT/HCPCS catalogue tied to tests with default fees.
//                     Drives claim creation; the lab-config
//                     `billing.feeScheduleMultiplier` scales these at
//                     claim build time so a single contracted-discount
//                     toggle moves all fees together.
//   ClaimsPage      — one row per claim with status filter, drawer to
//                     edit. Builds new claims from existing orders that
//                     don't yet have one (the "Generate claim" button).
//                     Money flows are simulated; status transitions are
//                     real and audited.
//
// Schema (schema.js): newChargeCode, newClaim.
// Collections (db.js): charge_codes, claims.

const CHARGE_MODIFIERS = ['', '26', 'TC', '59', '90', '91', 'GA', 'GZ'];

// ── Money helpers ────────────────────────────────────────────────────
const fmtMoney = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '$0.00';
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
const parseMoney = (s) => {
  const v = Number(String(s || '').replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

// ── ChargeCodesPage ─────────────────────────────────────────────────
const ChargeCodesPage = ({ onBack }) => {
  const codes = window.useEntities('charge_codes');
  const tests = window.useEntities('tests');
  const canEdit = hasPermission('EDIT_LAB_CONFIG');
  const [q, setQ] = useStateOS('');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);

  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...codes]
      .filter(c => !needle || [c.cptCode, c.description, testById[c.testId] && testById[c.testId].code].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.cptCode || '').localeCompare(b.cptCode || ''));
  }, [codes, q, testById]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!canEdit) return;
    setEditingId(null);
    setDraft(window.schema.newChargeCode({ description: 'New charge', defaultFee: 0 }));
  };
  const startEdit = (c) => { if (!canEdit) return; setEditingId(c.id); setDraft({ ...c }); };
  const cancel = () => { setEditingId(null); setDraft(null); };

  const save = async () => {
    if (!canEdit || !draft) return;
    if (!draft.cptCode) return;
    const existing = await window.db.get('charge_codes', draft.id);
    const next = { ...(existing || {}), ...draft, defaultFee: Number(draft.defaultFee) || 0, updatedAt: Date.now() };
    if (!existing) next.createdAt = next.createdAt || Date.now();
    await window.db.put('charge_codes', next);
    cancel();
  };

  const remove = async (c) => {
    if (!canEdit) return;
    const ask = await safetyConfirm({
      id: 'admin.charge_code.delete',
      tone: 'danger',
      title: 'Delete charge code',
      message: 'Removes the charge code. Existing claims that reference it keep their charge line — the CPT code is copied at claim time.',
      facts: [
        safetyFact('cpt', c.cptCode),
        safetyFact('description', c.description),
        safetyFact('default fee', fmtMoney(c.defaultFee)),
      ],
      entityType: 'charge_code', entityId: c.id, confirmLabel: 'Delete charge code',
    });
    if (!ask.confirmed) return;
    await window.db.delete('charge_codes', c.id);
    if (editingId === c.id) cancel();
  };

  return (
    <Page label="Charge Codes">
      <PageHeader title="Charge Codes"
        sub="CPT/HCPCS codes mapped to tests. Drives claim creation. The lab-config fee multiplier scales all fees together at claim build time."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Billing</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={startNew} disabled={!canEdit}
            title={permissionTitle(canEdit, 'Add charge code', 'edit lab config')}><IconPlus size={13}/> Add charge code</button>,
        ]}/>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by CPT, description, test code…"
            style={{ width: 320, height: 28 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {codes.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['CPT', 'Description', 'Test', 'Default fee', 'Modifiers', 'Status']}
              message="No charge codes"
              sub="Add codes individually here or run seed.demo() to populate a starter catalog."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>CPT</th><th>Description</th><th>Test</th><th>Default fee</th><th>Modifiers</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(c => {
                  const t = testById[c.testId];
                  return (
                    <tr key={c.id} style={{ opacity: c.active === false ? 0.55 : 1, background: editingId === c.id ? 'var(--sage-50)' : undefined }}>
                      <td><span className="mono">{c.cptCode}</span></td>
                      <td>{c.description || '—'}</td>
                      <td>{t ? <span><span className="mono">{t.code}</span> · {t.name}</span> : <span style={{ color: 'var(--ink-400)' }}>(unlinked)</span>}</td>
                      <td className="mono tnum">{fmtMoney(c.defaultFee)}</td>
                      <td>
                        {(c.modifiers || []).filter(Boolean).map(m => <span key={m} className="pill" data-tone="ghost" style={{ marginRight: 4 }}>{m}</span>)}
                        {(c.modifiers || []).filter(Boolean).length === 0 && <span style={{ color: 'var(--ink-300)' }}>—</span>}
                      </td>
                      <td><span className="pill" data-tone={c.active === false ? 'ghost' : 'sage'}>{c.active === false ? 'inactive' : 'active'}</span></td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => startEdit(c)} disabled={!canEdit}>Edit</button>
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => remove(c)} disabled={!canEdit}>Delete</button>
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
            <span style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? 'Edit charge code' : 'New charge code'}</span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={cancel}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!draft.cptCode}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div>
              <div className="field-label">CPT / HCPCS</div>
              <input className="input" value={draft.cptCode || ''} onChange={e => setDraft(d => ({ ...d, cptCode: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="field-label">Description</div>
              <input className="input" value={draft.description || ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Linked test</div>
              <select className="input" value={draft.testId || ''} onChange={e => setDraft(d => ({ ...d, testId: e.target.value || null }))} style={{ width: '100%' }}>
                <option value="">— None —</option>
                {tests.map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Default fee</div>
              <input className="input" value={draft.defaultFee || 0}
                onChange={e => setDraft(d => ({ ...d, defaultFee: parseMoney(e.target.value) }))} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Active</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                <input type="checkbox" checked={draft.active !== false} onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))}/>
                Available for new claims
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Modifiers</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {CHARGE_MODIFIERS.filter(Boolean).map(m => {
                  const on = (draft.modifiers || []).includes(m);
                  return (
                    <button key={m} type="button"
                      onClick={() => setDraft(d => {
                        const arr = Array.isArray(d.modifiers) ? [...d.modifiers] : [];
                        const i = arr.indexOf(m);
                        if (i >= 0) arr.splice(i, 1); else arr.push(m);
                        return { ...d, modifiers: arr };
                      })}
                      className="pill" data-tone={on ? 'sage' : 'ghost'}
                      style={{ height: 22, padding: '0 8px', cursor: 'pointer', border: '1px solid var(--line)' }}>
                      <span className="mono">{m}</span>
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

// ── ClaimsPage ─────────────────────────────────────────────────────
const CLAIM_STATUSES = ['open', 'submitted', 'paid', 'denied', 'rejected', 'self_pay'];
const CLAIM_STATUS_TONE = {
  open: 'ghost', submitted: 'info', paid: 'sage', denied: 'rust', rejected: 'rust', self_pay: 'amber',
};
const ClaimStatusPill = ({ status }) => (
  <span className="pill" data-tone={CLAIM_STATUS_TONE[status] || 'ghost'}>{status || '—'}</span>
);

const ClaimsPage = ({ onBack }) => {
  const claims = window.useEntities('claims');
  const orders = window.useEntities('orders');
  const patients = window.useEntities('patients');
  const payors = window.useEntities('payors');
  const chargeCodes = window.useEntities('charge_codes');
  const insurance = window.useEntities('patient_insurance');
  const labConfig = window.useEntities('lab_config')[0] || null;
  const canEdit = hasPermission('EDIT_LAB_CONFIG');

  const [statusFilter, setStatusFilter] = useStateOS('');
  const [q, setQ] = useStateOS('');
  const [expandedId, setExpandedId] = useStateOS(null);
  const [busy, setBusy] = useStateOS(false);

  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const orderById = useMemoOS(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);
  const payorById = useMemoOS(() => Object.fromEntries(payors.map(p => [p.id, p])), [payors]);
  const chargeById = useMemoOS(() => Object.fromEntries(chargeCodes.map(c => [c.id, c])), [chargeCodes]);
  const insById = useMemoOS(() => Object.fromEntries(insurance.map(i => [i.id, i])), [insurance]);
  const multiplier = labConfig && labConfig.billing && Number(labConfig.billing.feeScheduleMultiplier) || 1.0;

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...claims]
      .filter(c => !statusFilter || c.status === statusFilter)
      .filter(c => {
        if (!needle) return true;
        const o = orderById[c.orderId];
        const p = patientById[c.patientId];
        return [
          o && o.orderNumber, o && o.fillerOrderNumber,
          p && p.mrn, p && p.lastName, p && p.firstName,
          c.id, c.status, c.notes,
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [claims, q, statusFilter, orderById, patientById]);
  const pager = usePagination(filtered);

  const counts = useMemoOS(() => ({
    open: claims.filter(c => c.status === 'open').length,
    submitted: claims.filter(c => c.status === 'submitted').length,
    paid: claims.filter(c => c.status === 'paid').length,
    denied: claims.filter(c => c.status === 'denied' || c.status === 'rejected').length,
    paidTotal: claims.reduce((s, c) => s + (Number(c.paidAmount) || 0), 0),
    openTotal: claims.filter(c => c.status === 'open' || c.status === 'submitted').reduce((s, c) => s + (Number(c.billedAmount) || 0), 0),
  }), [claims]);

  // Builds a claim from an order: looks up charge codes for each test on
  // the order, applies the global fee multiplier, attaches the patient's
  // primary insurance, marks billTo based on order override > client.
  const generateClaim = async (orderId) => {
    if (!canEdit) return;
    const o = await window.db.get('orders', orderId);
    if (!o) return;
    const existing = (await window.db.list('claims', c => c.orderId === orderId))[0];
    if (existing) { setExpandedId(existing.id); return; }
    const patient = o.patientId ? await window.db.get('patients', o.patientId) : null;
    const pIns = patient ? (await window.db.list('patient_insurance', i => i.patientId === patient.id && i.active !== false && i.rank === 'PRIMARY'))[0] : null;
    const plan = pIns && pIns.planId ? await window.db.get('plans', pIns.planId) : null;
    const charges = [];
    for (const tid of (o.testIds || [])) {
      const cc = chargeCodes.find(x => x.testId === tid && x.active !== false);
      if (!cc) continue;
      charges.push({
        chargeCodeId: cc.id,
        cptCode: cc.cptCode,
        fee: Math.round((Number(cc.defaultFee) * multiplier) * 100) / 100,
        qty: 1,
      });
    }
    const billedAmount = charges.reduce((s, c) => s + (Number(c.fee) * Number(c.qty || 1)), 0);
    const billTo = o.billTo || (o.clientId ? 'CLIENT' : 'PATIENT');
    const claim = window.schema.newClaim({
      orderId: o.id,
      patientId: patient ? patient.id : null,
      payorId: plan ? plan.payorId : null,
      patientInsuranceId: pIns ? pIns.id : null,
      billTo: billTo === 'INSURANCE' && pIns ? 'INSURANCE' : billTo,
      charges,
      billedAmount,
      status: billTo === 'PATIENT' ? 'self_pay' : 'open',
    });
    await window.db.put('claims', claim);
    // Mirror on the order so the order drawer can show claim status without
    // a join. Status flips back to '' if the claim is later deleted.
    await window.db.put('orders', { ...o, claimStatus: claim.status, updatedAt: Date.now() });
    setExpandedId(claim.id);
  };

  const submit = async (claim) => {
    if (!canEdit) return;
    await window.db.put('claims', { ...claim, status: 'submitted', submittedAt: Date.now(), updatedAt: Date.now() });
    const o = await window.db.get('orders', claim.orderId);
    if (o) await window.db.put('orders', { ...o, claimStatus: 'submitted', updatedAt: Date.now() });
  };
  const markPaid = async (claim) => {
    if (!canEdit) return;
    await window.db.put('claims', { ...claim, status: 'paid', paidAt: Date.now(), paidAmount: Number(claim.billedAmount) || 0, updatedAt: Date.now() });
    const o = await window.db.get('orders', claim.orderId);
    if (o) await window.db.put('orders', { ...o, claimStatus: 'paid', updatedAt: Date.now() });
  };
  const markDenied = async (claim) => {
    if (!canEdit) return;
    const reason = window.prompt('Denial reason?', claim.denialReason || '') || '';
    await window.db.put('claims', { ...claim, status: 'denied', denialReason: reason, updatedAt: Date.now() });
    const o = await window.db.get('orders', claim.orderId);
    if (o) await window.db.put('orders', { ...o, claimStatus: 'denied', updatedAt: Date.now() });
  };

  const billableOrdersWithoutClaim = useMemoOS(() => {
    const claimedOrderIds = new Set(claims.map(c => c.orderId).filter(Boolean));
    return orders.filter(o => !claimedOrderIds.has(o.id) && o.status === 'completed').slice(0, 20);
  }, [orders, claims]);

  const generateAll = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      for (const o of billableOrdersWithoutClaim) {
        await generateClaim(o.id);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page label="Claims">
      <PageHeader title="Claims"
        sub="One claim per order. Statuses flow open → submitted → paid/denied. Money flows are simulated; status transitions are real and audited."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Billing</button>] : []),
          <button key="g" className="btn" data-size="sm" data-variant="primary"
            onClick={generateAll}
            disabled={!canEdit || billableOrdersWithoutClaim.length === 0 || busy}
            title={billableOrdersWithoutClaim.length === 0 ? 'No completed orders without claims' : `Generate claims for ${billableOrdersWithoutClaim.length} completed orders`}>
            {busy ? 'Generating…' : `Generate ${billableOrdersWithoutClaim.length} new claims`}
          </button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Open" value={counts.open}/>
        <KpiPanel label="Submitted" value={counts.submitted}/>
        <KpiPanel label="Paid" value={counts.paid}/>
        <KpiPanel label="Denied / rejected" value={counts.denied} tone={counts.denied > 0 ? 'rust' : null}/>
        <KpiPanel label="Open billed" value={fmtMoney(counts.openTotal)}/>
        <KpiPanel label="Paid total" value={fmtMoney(counts.paidTotal)}/>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ height: 28 }}>
            <option value="">All statuses</option>
            {CLAIM_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by MRN, order #, claim id…"
            style={{ height: 28, flex: 1, minWidth: 220 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {claims.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['When', 'Patient', 'Order', 'Payor', 'Bill to', 'Billed', 'Status']}
              message="No claims"
              sub="Generate claims from completed orders with the button above, or run seed.demo() to populate a starter set."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>When</th><th>Patient</th><th>Order</th><th>Payor</th><th>Bill to</th><th>Billed</th><th>Paid</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(c => {
                  const p = patientById[c.patientId];
                  const o = orderById[c.orderId];
                  const payor = payorById[c.payorId];
                  const ins = insById[c.patientInsuranceId];
                  const isExpanded = expandedId === c.id;
                  return (
                    <React.Fragment key={c.id}>
                      <tr onClick={() => setExpandedId(isExpanded ? null : c.id)} style={{ cursor: 'pointer', background: isExpanded ? 'var(--ivory-100)' : undefined }}>
                        <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{formatDateTime(c.createdAt)}</span></td>
                        <td>{p ? <span><span className="mono">{p.mrn}</span> · {p.lastName}, {p.firstName}</span> : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                        <td><span className="mono">{o ? o.orderNumber : '—'}</span></td>
                        <td>{payor ? payor.name : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                        <td><span className="pill" data-tone="ghost">{c.billTo}</span></td>
                        <td className="mono tnum">{fmtMoney(c.billedAmount)}</td>
                        <td className="mono tnum" style={{ color: c.status === 'paid' ? 'var(--ok-700)' : 'var(--ink-500)' }}>{fmtMoney(c.paidAmount)}</td>
                        <td><ClaimStatusPill status={c.status}/></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {c.status === 'open' && <button className="btn" data-size="xs" data-variant="primary" onClick={e => { e.stopPropagation(); submit(c); }} disabled={!canEdit}>Submit</button>}
                          {c.status === 'submitted' && <>
                            <button className="btn" data-size="xs" data-variant="ghost" onClick={e => { e.stopPropagation(); markPaid(c); }} disabled={!canEdit}>Mark paid</button>
                            <button className="btn" data-size="xs" data-variant="ghost" onClick={e => { e.stopPropagation(); markDenied(c); }} disabled={!canEdit}>Mark denied</button>
                          </>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={9} style={{ background: 'var(--ivory-50)', padding: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                              <div>
                                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Claim</div>
                                <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '100px 1fr', rowGap: 3 }}>
                                  <span style={{ color: 'var(--ink-400)' }}>Claim id</span><span className="mono">{c.id}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Patient</span><span>{p ? `${p.lastName}, ${p.firstName}` : '—'}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Insurance</span><span>{ins ? `Member ${ins.memberId} (${ins.rank})` : '—'}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Payor</span><span>{payor ? `${payor.name} (${payor.type})` : '—'}</span>
                                  {c.denialReason ? <><span style={{ color: 'var(--ink-400)' }}>Denial</span><span style={{ color: 'var(--err-700)' }}>{c.denialReason}</span></> : null}
                                </div>
                              </div>
                              <div>
                                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Charges</div>
                                <table className="tbl" style={{ fontSize: 11.5 }}>
                                  <thead><tr><th>CPT</th><th>Qty</th><th style={{ textAlign: 'right' }}>Fee</th></tr></thead>
                                  <tbody>
                                    {(c.charges || []).map((ch, i) => (
                                      <tr key={i}>
                                        <td><span className="mono">{ch.cptCode}</span></td>
                                        <td>{ch.qty || 1}</td>
                                        <td className="mono tnum" style={{ textAlign: 'right' }}>{fmtMoney(ch.fee)}</td>
                                      </tr>
                                    ))}
                                    <tr>
                                      <td colSpan={2} style={{ textAlign: 'right', color: 'var(--ink-500)' }}>Billed</td>
                                      <td className="mono tnum" style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoney(c.billedAmount)}</td>
                                    </tr>
                                  </tbody>
                                </table>
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

Object.assign(window, { ChargeCodesPage, ClaimsPage });
