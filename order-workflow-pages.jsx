const OrdersPage = ({ filterClientId, onClearFilter }) => {
  const orders = window.useEntities('orders');
  const patients = window.useEntities('patients');
  const clients = window.useEntities('clients');
  const locations = window.useEntities('locations');
  const patientById  = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const clientById   = useMemoOS(() => Object.fromEntries(clients.map(c => [c.id, c])), [clients]);
  const locationById = useMemoOS(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);

  const [q, setQ] = useStateOS('');
  const [status, setStatus] = useStateOS('all');
  const [copiedOrderId, setCopiedOrderId] = useStateOS(null);
  const canCreateOrder = hasPermission('CREATE_ORDER');
  // false on first render → no animation on initial paint; true thereafter →
  // newly-arrived rows mount with `slide-up` and animate on insert.
  const animateNew = window.useDeferredEnter();

  const pinnedClient = filterClientId ? clientById[filterClientId] : null;

  const copyOrderNumber = async (e, order) => {
    e.preventDefault();
    e.stopPropagation();
    const text = order && order.orderNumber;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOrderId(order.id);
      window.setTimeout(() => setCopiedOrderId(cur => cur === order.id ? null : cur), 1300);
    } catch (err) {
      console.warn('[orders] copy order number failed', err);
    }
  };

  const filtered = useMemoOS(() => {
    return orders
      .filter(o => !filterClientId || o.clientId === filterClientId)
      .filter(o => status === 'all' || o.status === status)
      .filter(o => {
        if (!q) return true;
        const needle = q.toLowerCase();
        const pat = o.patientId ? patientById[o.patientId] : null;
        const loc = o.locationId ? locationById[o.locationId] : null;
        const hay = [
          o.orderNumber, o.placerOrderNumber, o.fillerOrderNumber, o.facility, o.notes,
          loc && loc.code, loc && loc.name,
          pat && pat.mrn, pat && pat.lastName, pat && pat.firstName,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => (b.orderedAt || b.createdAt || 0) - (a.orderedAt || a.createdAt || 0));
  }, [orders, patientById, locationById, q, status, filterClientId]);

  const pager = usePagination(filtered);

  return (
    <Page label="Orders">
      <PageHeader title="Orders" sub="All laboratory orders across the system."
        actions={[
          <button key="f" className="btn" data-size="sm"><IconFilter size={13}/> Filter</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={() => window.openNewOrder && window.openNewOrder()}
            disabled={!canCreateOrder}
            title={permissionTitle(canCreateOrder, 'Create new order', 'create orders')}><IconPlus size={13}/> New order</button>,
        ]}/>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderBottom: '1px solid var(--line)' }}>
          <input className="input" placeholder="Search orders…" style={{ height: 28, maxWidth: 320 }}
            value={q} onChange={e => setQ(e.target.value)}/>
          <SegSelect
            options={[{id:'all',label:'All'},{id:'open',label:'Open'},{id:'in_progress',label:'In progress'},{id:'completed',label:'Completed'},{id:'cancelled',label:'Cancelled'}]}
            value={status} onChange={setStatus}/>
          {pinnedClient && (
            <button className="pill" data-tone="info" onClick={() => onClearFilter && onClearFilter()}
              title="Click to clear client filter"
              style={{ cursor: 'pointer', height: 22, padding: '0 8px', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: 0.06 }}>client</span>
              <span className="mono">{pinnedClient.code}</span>
              <span style={{ marginLeft: 4, opacity: 0.7 }}>×</span>
            </button>
          )}
          <div style={{ flex:1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} orders</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        {filtered.length === 0 ? (
          <EmptyTable
            columns={['Order #','Patient','MRN','Tests','Priority','Status','TAT','Ordered','Facility']}
            message={orders.length === 0 ? 'No orders yet' : 'No orders match the filter'}
            sub={orders.length === 0 ? 'Click "New order" to add a patient, pick tests, and set priority. Orders can also arrive via inbound interface.' : 'Adjust the filter or search.'}/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Order #</th><th>Client</th><th>Patient</th><th>MRN</th><th>Tests</th>
                <th>Priority</th><th>Status</th><th>TAT</th><th>Ordered</th><th>Facility</th>
              </tr>
            </thead>
            <tbody className="stagger-children">
              {pager.slice.map(o => {
                const pat = o.patientId ? patientById[o.patientId] : null;
                const cli = o.clientId ? clientById[o.clientId] : null;
                const loc = o.locationId ? locationById[o.locationId] : null;
                const name = pat ? ((pat.lastName || '') + (pat.firstName ? ', ' + pat.firstName : '')).trim() : '';
                return (
                  <tr key={o.id} className={animateNew ? 'slide-up' : ''} style={{ cursor: 'pointer' }}
                      onClick={() => window.openEntity && window.openEntity('order', o.id)}>
                    <td>
                      {o.orderNumber ? (
                        <button className="mono"
                          onClick={e => copyOrderNumber(e, o)}
                          title={copiedOrderId === o.id ? 'Copied' : 'Copy order number'}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: copiedOrderId === o.id ? 'var(--ok-700)' : 'var(--sage-700)',
                            padding: 0,
                            textDecoration: 'underline',
                            textUnderlineOffset: 3,
                            cursor: 'copy',
                            font: 'inherit',
                          }}>
                          {copiedOrderId === o.id ? 'copied' : o.orderNumber}
                        </button>
                      ) : (
                        <span className="mono" style={{ color: 'var(--ink-300)' }}>-</span>
                      )}
                    </td>
                    <td>
                      {cli ? <span className="pill" data-tone="info" style={{ height: 18, padding: '0 6px', fontSize: 10.5 }}>
                        <span className="mono">{cli.code}</span>
                      </span> : <span style={{ color: 'var(--ink-300)' }}>—</span>}
                    </td>
                    <td onClick={e => { if (pat) { e.stopPropagation(); window.openEntity && window.openEntity('patient', pat.id); }}}
                        style={pat ? { color: 'var(--sage-700)', cursor: 'pointer' } : {}}>
                      {name || '—'}
                    </td>
                    <td onClick={e => { if (pat) { e.stopPropagation(); window.openEntity && window.openEntity('patient', pat.id); }}}
                        style={pat ? { cursor: 'pointer' } : {}}>
                      <span className="mono" style={pat ? { color: 'var(--sage-700)' } : {}}>{pat ? pat.mrn : '—'}</span>
                    </td>
                    <td className="mono tnum">{o.testIds.length}</td>
                    <td><PriorityPill p={o.priority}/></td>
                    <td><StatusPill s={o.status}/></td>
                    <td><TatPill order={o}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(o.orderedAt)}</span></td>
                    <td style={{ maxWidth: 220 }}>
                      {loc ? (
                        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, maxWidth: '100%' }}>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-500)', flexShrink: 0 }}>{loc.code}</span>
                          <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }} title={loc.name}>{loc.name}</span>
                        </span>
                      ) : (o.facility ? <span style={{ color: 'var(--ink-500)' }}>{o.facility}</span> : <span style={{ color: 'var(--ink-300)' }}>—</span>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>
    </Page>
  );
};

// ===== Specimens =====
const SpecimensPage = () => {
  const specimens = window.useEntities('specimens');
  const patients = window.useEntities('patients');
  const orders = window.useEntities('orders');
  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const orderById = useMemoOS(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);

  const [q, setQ] = useStateOS('');
  const [filter, setFilter] = useStateOS('all');
  const animateNew = window.useDeferredEnter();

  const filtered = useMemoOS(() => {
    return specimens
      .filter(s => {
        if (filter === 'all') return true;
        if (filter === 'transit') return s.state === 'pending' || s.state === 'in_transit';
        if (filter === 'received') return s.state === 'received';
        if (filter === 'rejected') return s.state === 'rejected';
        if (filter === 'final') return s.state === 'completed';
        return true;
      })
      .filter(s => {
        if (!q) return true;
        const needle = q.toLowerCase();
        return [s.barcode, s.accessionNumber, s.id, s.type, s.container]
          .filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [specimens, q, filter]);

  const pager = usePagination(filtered);

  return (
    <Page label="Specimens">
      <PageHeader title="Specimens" sub="Trace every specimen through collection, routing, accessioning, analysis, and disposition."
        actions={[<button key="f" className="btn" data-size="sm"><IconFilter size={13}/> Filter</button>]}/>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderBottom: '1px solid var(--line)' }}>
          <input className="input" placeholder="Specimen ID, accession, container barcode…" style={{ height: 28, maxWidth: 320 }}
            value={q} onChange={e => setQ(e.target.value)}/>
          <SegSelect
            options={[{id:'all',label:'All'},{id:'transit',label:'In transit'},{id:'received',label:'Received'},{id:'rejected',label:'Rejected'},{id:'final',label:'Final'}]}
            value={filter} onChange={setFilter}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} specimens</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        {filtered.length === 0 ? (
          <EmptyTable
            columns={['Accession','Barcode','Patient','Order','Type','Container','Collected','Received','Flags','State']}
            message={specimens.length === 0 ? 'No specimens yet' : 'No specimens match the filter'}
            sub={specimens.length === 0 ? 'Accession a specimen to populate the pipeline.' : 'Adjust the filter or search.'}/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Accession</th><th>Barcode</th><th>Patient</th><th>Order</th>
                <th>Type</th><th>Container</th><th>Received</th>
                <th>Condition</th><th>Flags</th><th>State</th>
              </tr>
            </thead>
            <tbody className="stagger-children">
              {pager.slice.map(s => {
                const pat = s.patientId ? patientById[s.patientId] : null;
                const ord = s.orderId ? orderById[s.orderId] : null;
                const flags = Array.isArray(s.flags) ? s.flags : [];
                return (
                  <tr key={s.id} className={animateNew ? 'slide-up' : ''} style={{ cursor: 'pointer' }}
                      onClick={() => window.openEntity && window.openEntity('specimen', s.id)}>
                    <td><span className="mono" style={{ color: 'var(--sage-700)' }}>{s.accessionNumber || '—'}</span></td>
                    <td><span className="mono">{s.barcode || '—'}</span></td>
                    <td onClick={e => { if (pat) { e.stopPropagation(); window.openEntity && window.openEntity('patient', pat.id); }}}
                        style={pat ? { color: 'var(--sage-700)', cursor: 'pointer' } : {}}>
                      {pat ? (pat.mrn || ((pat.lastName || '') + (pat.firstName ? ', ' + pat.firstName : ''))) : '—'}
                    </td>
                    <td onClick={e => { if (ord) { e.stopPropagation(); window.openEntity && window.openEntity('order', ord.id); }}}
                        style={ord ? { cursor: 'pointer' } : {}}>
                      <span className="mono" style={ord ? { color: 'var(--sage-700)' } : {}}>{ord ? ord.orderNumber : '—'}</span>
                    </td>
                    <td>{s.type || '—'}</td>
                    <td>{s.container || '—'}</td>
                    <td><span className="mono">{formatTime(s.receivedAt)}</span></td>
                    <td><ConditionPill condition={s.condition} rejectReason={s.rejectReason}/></td>
                    <td>
                      {flags.length === 0 ? (
                        <span style={{ color: 'var(--ink-300)' }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {flags.map(f => <span key={f} className="pill" data-tone="info" style={{ height: 18, padding: '0 6px', fontSize: 10.5 }}>{f}</span>)}
                        </div>
                      )}
                    </td>
                    <td><SpecimenStatePill state={s.state}/></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>
    </Page>
  );
};

// ----- Local presentational helpers shared by Orders/Specimens -----
// Compact TAT pill: surfaces in-flight breach/warn at a glance on the Orders
// list and any drawer that shows order rows. Renders nothing for `ok` or
// terminal orders so the column stays quiet on a healthy lab.

const WorklistsPage = () => {
  const specimens = window.useEntities('specimens');
  const orders = window.useEntities('orders');
  const patients = window.useEntities('patients');
  const tests = window.useEntities('tests');
  const instruments = window.useEntities('instruments');
  const orderById = useMemoOS(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);
  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  const canAccession = hasPermission('ACCESSION');
  const animateNew = window.useDeferredEnter();

  // Build a routedTo → instrument lookup that handles BOTH key formats:
  // some specimens were routed by id (`inst_xxx` from the seeder), others
  // by code (`cobas-c303` from the route modal's old freeform input). Both
  // resolve to the same instrument record so the worklist UI shows one
  // queue per analyzer regardless of how the routing was authored.
  const instrumentByKey = useMemoOS(() => {
    const out = {};
    for (const inst of instruments) {
      if (inst.id) out[inst.id] = inst;
      if (inst.code) out[inst.code] = inst;
    }
    return out;
  }, [instruments]);

  const labelForRouteKey = (key) => {
    if (!key || key === '__unrouted') return 'Unrouted';
    const inst = instrumentByKey[key];
    if (inst) return inst.name || inst.code || key;
    return key;  // fallback — operator-typed string we can't resolve
  };

  // Group specimens by routedTo (analyzers/labs). Specimens that share an
  // instrument via either id or code are merged into a single bucket keyed
  // by the canonical instrument id, so seeded + operator-routed specimens
  // for the same analyzer don't fork into two queues.
  const groups = useMemoOS(() => {
    const g = new Map();
    for (const s of specimens) {
      if (s.state === 'rejected' || s.state === 'completed') continue;
      const raw = s.routedTo || '__unrouted';
      const inst = instrumentByKey[raw];
      const key = inst ? inst.id : raw;  // canonicalize to instrument id
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(s);
    }
    return Array.from(g.entries()).map(([key, items]) => ({
      id: key,
      label: labelForRouteKey(key),
      items: items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    })).sort((a, b) => {
      if (a.id === '__unrouted') return -1;
      if (b.id === '__unrouted') return 1;
      return a.label.localeCompare(b.label);
    });
  }, [specimens, instrumentByKey]);

  // Build the dropdown options once for the route modals — instrument records
  // sorted by name. Submit value is the instrument id (canonical) so all
  // future route operations land in the same bucket as the seeder.
  const routeOptions = useMemoOS(() =>
    [...instruments]
      .filter(i => i.active !== false)
      .sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || ''))
      .map(i => ({ value: i.id, label: (i.name || i.code) + (i.code ? ' (' + i.code + ')' : '') })),
    [instruments]);

  const [selectedKey, setSelectedKey] = useStateOS(null);
  const [checked, setChecked] = useStateOS(() => new Set());
  const selected = groups.find(g => g.id === selectedKey) || groups[0] || null;

  // Reset selection when switching queues — checked ids would be stale.
  useEffectOS(() => { setChecked(new Set()); }, [selectedKey]);

  const toggleOne = (id) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setChecked(prev => {
    if (!selected) return prev;
    const ids = selected.items.map(s => s.id);
    if (ids.every(id => prev.has(id))) return new Set();
    return new Set(ids);
  });
  const allChecked = selected && selected.items.length > 0 && selected.items.every(s => checked.has(s.id));

  const checkedSpecimens = useMemoOS(() => {
    if (!selected) return [];
    return selected.items.filter(s => checked.has(s.id));
  }, [selected, checked]);

  const factsForSpecimen = (s) => {
    const o = s && s.orderId ? orderById[s.orderId] : null;
    const p = s && s.patientId ? patientById[s.patientId] : null;
    const testCodes = o ? o.testIds.map(id => (testById[id] || {}).code).filter(Boolean).join(' ') : '';
    return [
      safetyFact('specimen id', s && s.id),
      safetyFact('accession', s && (s.accessionNumber || s.barcode)),
      safetyFact('patient', compactName(p)),
      safetyFact('order', o && o.orderNumber),
      safetyFact('tests', testCodes),
      safetyFact('state', s && s.state),
      safetyFact('current route', s && (s.routedTo || 'unrouted')),
    ];
  };

  // ── Bulk actions — all flow through the lifecycle (events publish so the
  // completion watcher and downstream pages stay in sync). ─────────────────
  const __routeOne = async (s, target, actor) => {
    try {
      const updated = await window.lifecycle.transition('specimens',
        { ...s, routedTo: target }, 'in_analysis',
        { actor, reason: 'routed to ' + target });
      window.events.publish(window.EVENTS.SPECIMEN_ROUTED, {
        entityType: 'specimen', entityId: updated.id, specimen: updated, target, actor,
      });
    } catch (e) {
      console.warn('[worklists] route refused', s.id, e);
    }
  };
  const __rejectOne = async (s, reason, actor) => {
    if (s.state === 'rejected' || s.state === 'completed') return;
    try {
      const updated = await window.lifecycle.transition('specimens',
        { ...s, rejectReason: reason }, 'rejected', { actor, reason });
      window.events.publish(window.EVENTS.SPECIMEN_REJECTED, {
        entityType: 'specimen', entityId: updated.id, specimen: updated, reason, actor,
      });
    } catch (e) {
      console.warn('[worklists] reject refused', s.id, e);
    }
  };

  const bulkRoute = async () => {
    if (!hasPermission('ACCESSION')) return;
    if (checkedSpecimens.length === 0) return;
    if (routeOptions.length === 0) {
      await safetyNotice({
        tone: 'danger',
        title: 'No instruments configured',
        message: 'Add at least one instrument in Admin > Instruments before routing specimens.',
      });
      return;
    }
    const ask = await safetyConfirm({
      id: 'worklists.route.batch',
      tone: 'warning',
      title: 'Batch route specimens',
      message: 'This moves selected specimens into analysis on the target analyzer or lab queue.',
      facts: [
        safetyFact('selected', checkedSpecimens.length),
        safetyFact('first accessions', checkedSpecimens.slice(0, 8).map(s => s.accessionNumber || s.id.slice(-6)).join(', ')),
      ],
      requireReason: true,
      reasonLabel: 'Route to',
      reasonOptions: routeOptions,
      entityType: 'specimen',
      entityId: 'batch',
      confirmLabel: 'Route batch',
    });
    if (!ask.confirmed || !ask.reason) return;
    if (!hasPermission('ACCESSION')) return;
    const target = ask.reason;
    const actor = currentActorId();
    for (const s of checkedSpecimens) {
      const fresh = await window.db.get('specimens', s.id);
      if (fresh) await __routeOne(fresh, target, actor);
    }
    setChecked(new Set());
  };

  const bulkReject = async () => {
    if (!hasPermission('ACCESSION')) return;
    if (checkedSpecimens.length === 0) return;
    const ask = await safetyConfirm({
      id: 'worklists.reject.batch',
      tone: 'danger',
      title: 'Batch reject specimens',
      message: 'Rejected specimens leave the active analytical path and may complete or cancel downstream work.',
      facts: [
        safetyFact('selected', checkedSpecimens.length),
        safetyFact('first accessions', checkedSpecimens.slice(0, 8).map(s => s.accessionNumber || s.id.slice(-6)).join(', ')),
      ],
      requireReason: true,
      reasonLabel: 'Reject reason',
      reasonDefault: 'Insufficient volume',
      entityType: 'specimen',
      entityId: 'batch',
      confirmLabel: 'Reject batch',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('ACCESSION')) return;
    const actor = currentActorId();
    for (const s of checkedSpecimens) {
      const fresh = await window.db.get('specimens', s.id);
      if (fresh) await __rejectOne(fresh, ask.reason, actor);
    }
    setChecked(new Set());
  };

  const releaseToInstrument = async (specimen) => {
    if (!hasPermission('ACCESSION')) return;
    if (routeOptions.length === 0) {
      await safetyNotice({
        tone: 'danger',
        title: 'No instruments configured',
        message: 'Add at least one instrument in Admin > Instruments before routing specimens.',
      });
      return;
    }
    // Pre-select the specimen's current routedTo if it resolves to a known
    // instrument — handy for re-routes. Falls through to "— pick one —" if
    // unresolvable so the operator can't accidentally re-confirm a stale id.
    const currentInst = specimen.routedTo ? instrumentByKey[specimen.routedTo] : null;
    const ask = await safetyConfirm({
      id: 'worklists.route.single',
      tone: 'info',
      title: 'Route specimen',
      message: 'Send this specimen to an analyzer or lab queue.',
      facts: factsForSpecimen(specimen),
      requireReason: true,
      reasonLabel: 'Route to',
      reasonOptions: routeOptions,
      reasonDefault: currentInst ? currentInst.id : '',
      entityType: 'specimen',
      entityId: specimen.id,
      confirmLabel: 'Route',
      audit: false,
    });
    if (!ask.confirmed || !ask.reason) return;
    if (!hasPermission('ACCESSION')) return;
    const fresh = await window.db.get('specimens', specimen.id);
    if (!fresh) return;
    const actor = currentActorId();
    await __routeOne(fresh, ask.reason, actor);
  };

  return (
    <Page label="Worklists">
      <PageHeader title="Worklists" sub="Specimens grouped by routing target. Click a target to see its queue."
        actions={[<button key="n" className="btn" data-size="sm"><IconPlus size={13}/> New worklist</button>]}/>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div className="section-title" style={{ padding: '6px 8px' }}>Active queues</div>
          {groups.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--ink-400)' }}>
              No active specimens. Accession one to populate.
            </div>
          ) : groups.map(g => {
            const isSel = (selected && selected.id === g.id);
            return (
              <button key={g.id} type="button"
                onClick={() => setSelectedKey(g.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', borderRadius: 4, border: 0,
                  background: isSel ? 'var(--sage-50)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12.5, color: 'var(--ink-700)', textAlign: 'left',
                }}
                onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--ivory-100)'; }}
                onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dot" data-tone={g.id === '__unrouted' ? 'idle' : 'ok'}/>
                  <span className="mono">{g.label}</span>
                </span>
                <span className="mono tnum" style={{ color: 'var(--ink-400)' }}>{g.items.length}</span>
              </button>
            );
          })}
        </div>

        <div className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {!selected ? (
            <div className="empty" style={{ flex: 1 }}>
              <div className="empty-icon"><IconList size={16}/></div>
              <div className="empty-title">No worklist selected</div>
              <div className="empty-sub">Pick a queue from the left.</div>
            </div>
          ) : (
            <>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.label}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{selected.items.length} specimens</span>
                <div style={{ flex: 1 }}/>
                {checkedSpecimens.length > 0 && (
                  <>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{checkedSpecimens.length} selected</span>
                    <button className="btn" data-variant="primary" data-size="xs" onClick={bulkRoute}
                      disabled={!canAccession}
                      title={permissionTitle(canAccession, 'Route selected specimens', 'accession or route specimens')}>Route…</button>
                    <button className="btn" data-variant="danger" data-size="xs" onClick={bulkReject}
                      disabled={!canAccession}
                      title={permissionTitle(canAccession, 'Reject selected specimens', 'accession or route specimens')}>Reject…</button>
                    <button className="btn" data-variant="ghost" data-size="xs" onClick={() => setChecked(new Set())}>Clear</button>
                  </>
                )}
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {selected.items.length === 0 ? (
                  <div className="empty" style={{ padding: '40px 24px' }}>
                    <div className="empty-sub">Queue is empty.</div>
                  </div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 32 }}>
                          <input type="checkbox" checked={!!allChecked} onChange={toggleAll}
                            style={{ cursor: 'pointer' }}/>
                        </th>
                        <th>Accession</th><th>Patient</th><th>Order</th>
                        <th>Type</th><th>Tests</th><th>State</th><th>Received</th>
                        <th style={{ width: 110 }}></th>
                      </tr>
                    </thead>
                    <tbody className="stagger-children">
                      {selected.items.map(s => {
                        const o = s.orderId ? orderById[s.orderId] : null;
                        const p = s.patientId ? patientById[s.patientId] : null;
                        const testCodes = o ? o.testIds.map(id => (testById[id] || {}).code).filter(Boolean).join(' ') : '';
                        const isChecked = checked.has(s.id);
                        return (
                          <tr key={s.id} className={animateNew ? 'slide-up' : ''} style={{ background: isChecked ? 'var(--sage-50)' : undefined, cursor: 'pointer' }}
                              onClick={() => window.openEntity && window.openEntity('specimen', s.id)}>
                            <td onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={isChecked} onChange={() => toggleOne(s.id)}
                                style={{ cursor: 'pointer' }}/>
                            </td>
                            <td><span className="mono" style={{ color: 'var(--sage-700)' }}>{s.accessionNumber || '—'}</span></td>
                            <td onClick={e => { if (p) { e.stopPropagation(); window.openEntity && window.openEntity('patient', p.id); }}}
                                style={p ? { cursor: 'pointer', color: 'var(--sage-700)' } : {}}>
                              {p ? (p.mrn || ((p.lastName || '') + (p.firstName ? ', ' + p.firstName : ''))) : '—'}
                            </td>
                            <td onClick={e => { if (o) { e.stopPropagation(); window.openEntity && window.openEntity('order', o.id); }}}
                                style={o ? { cursor: 'pointer' } : {}}>
                              <span className="mono" style={o ? { color: 'var(--sage-700)' } : {}}>{o ? o.orderNumber : '—'}</span>
                            </td>
                            <td>{s.type || '—'}</td>
                            <td><span className="mono" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{testCodes || '—'}</span></td>
                            <td><SpecimenStatePill state={s.state}/></td>
                            <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatTime(s.receivedAt)}</span></td>
                            <td onClick={e => e.stopPropagation()}>
                              {selected.id === '__unrouted' ? (
                                <button className="btn" data-variant="primary" data-size="xs" onClick={() => releaseToInstrument(s)}
                                  disabled={!canAccession}
                                  title={permissionTitle(canAccession, 'Route specimen', 'accession or route specimens')}>Route</button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Page>
  );
};

// ===== Instruments =====
