// Other screens — Dashboard, Orders, Specimens, Results, Patients, Worklists, Instruments, Interfaces, Reports, Admin
// All real shells. No dummy data. Empty states reflect actual schema.

const { useState: useStateOS, useMemo: useMemoOS, useEffect: useEffectOS } = React;

// ===== Page header (shared) =====
//
// PageHeader carries the top padding (24px) instead of the Page wrapper.
// Why: when a page scrolls and a sticky thead inside it activates, putting
// padding on the scroll container leaves a 24px ivory band between the
// topbar and the sticky header — visually reads as a "gap" between two
// floating chrome bars. Putting the padding on PageHeader keeps the
// at-rest breathing room (header sits 24px below the topbar) but lets
// sticky children inside the scroll container sit flush against the
// scroll container's top when activated.
const PageHeader = ({ title, sub, actions }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18, paddingTop: 24 }}>
    <div style={{ flex: 1 }}>
      <h1 className="page-title">{title}</h1>
      {sub && <p className="page-sub">{sub}</p>}
    </div>
    {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
  </div>
);

const Page = ({ children, label }) => (
  <div data-screen-label={label} style={{ padding: '0 32px 24px', overflow: 'auto', height: '100%' }}>
    {children}
  </div>
);

// ===== Empty data table (column scaffold preserved) =====
const EmptyTable = ({ columns, message, sub }) => (
  <div className="panel" style={{ overflow: 'hidden' }}>
    <table className="tbl">
      <thead>
        <tr>{columns.map(c => <th key={c} style={{ minWidth: c.length * 9 }}>{c}</th>)}</tr>
      </thead>
    </table>
    <div className="empty" style={{ padding: '56px 24px' }}>
      <div className="empty-icon"><IconInbox size={18}/></div>
      <div className="empty-title">{message || 'No data to display'}</div>
      <div className="empty-sub">{sub || 'This view is wired and ready. Records will appear once data flows in.'}</div>
    </div>
  </div>
);

// ===== Dashboard =====
const DashboardPage = () => {
  const orders = window.useEntities('orders');
  const specimens = window.useEntities('specimens');
  const results = window.useEntities('results');
  const interfaces = window.useEntities('interfaces');
  const clients = window.useEntities('clients');

  const kpis = useMemoOS(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const t = todayStart.getTime();
    const ordersToday = orders.filter(o => (o.orderedAt || o.createdAt || 0) >= t).length;
    const specimensInTransit = specimens.filter(s => s.state === 'pending' || s.state === 'in_transit').length;
    const resultsToVerify = results.filter(r => r.status === 'preliminary' || r.status === 'pending').length;
    const criticalResults = results.filter(r => r.flag === 'LL' || r.flag === 'HH' || r.flag === 'A').length;
    const interfaceAlerts = interfaces.filter(i => i.status === 'error' || i.status === 'offline').length;
    return [
      { l: 'Orders today',         v: ordersToday,         i: 'IconOrder' },
      { l: 'Specimens in transit', v: specimensInTransit,  i: 'IconTube' },
      { l: 'Results to verify',    v: resultsToVerify,     i: 'IconResults' },
      { l: 'Critical results',     v: criticalResults,     i: 'IconFlag', tone: criticalResults > 0 ? 'rust' : null },
      { l: 'Interface alerts',     v: interfaceAlerts,     i: 'IconInterface', tone: interfaceAlerts > 0 ? 'amber' : null },
    ];
  }, [orders, specimens, results, interfaces]);

  return (
  <Page label="Dashboard">
    <PageHeader
      title="Dashboard"
      sub="Real-time overview of laboratory operations."
      actions={[
        <button key="c" className="btn" data-size="sm"><IconEdit size={13}/> Customize</button>,
      ]}/>
    {/* KPI strip */}
    <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
      {kpis.map(k => {
        const Ico = window[k.i];
        const isZero = k.v === 0;
        const valueColor = isZero ? 'var(--ink-300)'
          : k.tone === 'rust'  ? 'var(--err-700)'
          : k.tone === 'amber' ? 'var(--warn-700)'
          : 'var(--ink-900)';
        return (
          <div key={k.l} className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="section-title" style={{ fontSize: 10 }}>{k.l}</span>
              <Ico size={14} style={{ color: 'var(--ink-300)' }}/>
            </div>
            <div className="mono tnum" style={{ fontSize: 26, color: valueColor, fontWeight: 400, letterSpacing: '-0.02em' }}>{isZero ? '0' : k.v}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-300)', marginTop: 2 }}>{isZero ? 'No data' : 'Live'}</div>
          </div>
        );
      })}
    </div>

    {/* Live operational panels */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
      <TatPanel results={results} specimens={specimens} orders={orders}/>
      <SpecimenStatusPanel specimens={specimens}/>
      <PendingReviewPanel results={results}/>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
      <ClientVolumePanel orders={orders} results={results} specimens={specimens} clients={clients}/>
      <DeliveryStatusPanel results={results}/>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <ActivityPanel/>
      <div className="panel">
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Interface monitor</span>
          <button className="btn" data-variant="ghost" data-size="xs">View all</button>
        </div>
        <EmptyTable columns={['Interface','Status','Last message','Time']} message="No interfaces configured" sub="Connect an HL7 endpoint from Admin → Interfaces."/>
      </div>
    </div>
  </Page>
  );
};

// ===== Orders =====
// Optional `filterClientId` lets callers (e.g. Dashboard "Top clients" panel)
// open the page with a client pre-pinned. Pinned filter shows a removable chip
// in the toolbar; clearing it returns to the unfiltered view.
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

  const pinnedClient = filterClientId ? clientById[filterClientId] : null;

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

  return (
    <Page label="Orders">
      <PageHeader title="Orders" sub="All laboratory orders across the system."
        actions={[
          <button key="f" className="btn" data-size="sm"><IconFilter size={13}/> Filter</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={() => window.openNewOrder && window.openNewOrder()}><IconPlus size={13}/> New order</button>,
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
            <tbody>
              {filtered.map(o => {
                const pat = o.patientId ? patientById[o.patientId] : null;
                const cli = o.clientId ? clientById[o.clientId] : null;
                const loc = o.locationId ? locationById[o.locationId] : null;
                const name = pat ? ((pat.lastName || '') + (pat.firstName ? ', ' + pat.firstName : '')).trim() : '';
                return (
                  <tr key={o.id} style={{ cursor: 'pointer' }}
                      onClick={() => window.openEntity && window.openEntity('order', o.id)}>
                    <td><span className="mono" style={{ color: 'var(--sage-700)' }}>{o.orderNumber || '—'}</span></td>
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
            <tbody>
              {filtered.map(s => {
                const pat = s.patientId ? patientById[s.patientId] : null;
                const ord = s.orderId ? orderById[s.orderId] : null;
                const flags = Array.isArray(s.flags) ? s.flags : [];
                return (
                  <tr key={s.id} style={{ cursor: 'pointer' }}
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
      </div>
    </Page>
  );
};

// ----- Local presentational helpers shared by Orders/Specimens -----
// Compact TAT pill: surfaces in-flight breach/warn at a glance on the Orders
// list and any drawer that shows order rows. Renders nothing for `ok` or
// terminal orders so the column stays quiet on a healthy lab.
const TatPill = ({ order }) => {
  if (!order) return null;
  if (order.status === 'completed' || order.status === 'cancelled') return null;
  const level = order.tatBreachLevel || 'ok';
  if (level === 'ok') return null;
  const tone = level === 'breach' ? 'rust' : 'amber';
  const label = level === 'breach' ? 'TAT breach' : 'TAT warn';
  // Show elapsed-since-breach for breaches (gives quick "5h over" sense at a glance).
  let elapsedHint = null;
  if (level === 'breach' && order.tatBreachedAt) {
    const ms = Date.now() - order.tatBreachedAt;
    const m = Math.round(ms / 60000);
    elapsedHint = m < 60 ? (m + 'm') : (m / 60).toFixed(1).replace(/\.0$/, '') + 'h';
  }
  const source = order.tatThresholdSource === 'test' ? 'test override' : 'priority target';
  const paused = Number(order.tatPausedMs) > 0 || order.tatPauseStartedAt;
  const title = [
    level === 'breach'
      ? 'Order has exceeded its adjusted TAT target.'
      : 'Order is approaching its adjusted TAT target.',
    order.tatThresholdMin ? `Target: ${order.tatThresholdMin}m (${source}).` : '',
    paused ? 'Clock includes specimen-recollect pause time.' : '',
  ].filter(Boolean).join(' ');
  return (
    <span className="pill" data-tone={tone} title={title}
      style={{ height: 18, padding: '0 6px', fontSize: 10.5, gap: 4 }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: 0.04, fontSize: 9.5 }}>{label}</span>
      {elapsedHint && <span className="mono tnum">+{elapsedHint}</span>}
      {paused && <span className="mono tnum">pause</span>}
    </span>
  );
};

const PRIORITY_TONE = { stat: 'rust', asap: 'amber', routine: 'ghost' };
const PriorityPill = ({ p }) => (
  <span className="pill" data-tone={PRIORITY_TONE[p] || 'ghost'}>
    {p === 'stat' ? 'STAT' : p === 'asap' ? 'ASAP' : 'Routine'}
  </span>
);

const STATUS_TONE = { open: 'sage', in_progress: 'info', completed: 'slate', cancelled: 'ghost' };
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
const StatusPill = ({ s }) => (
  <span className="pill" data-tone={STATUS_TONE[s] || 'ghost'}>{STATUS_LABEL[s] || s || '—'}</span>
);

const SPEC_STATE_TONE = {
  pending: 'ghost', in_transit: 'amber', received: 'sage',
  in_analysis: 'info', completed: 'slate', rejected: 'rust',
};
const SPEC_STATE_LABEL = {
  pending: 'Pending', in_transit: 'In transit', received: 'Received',
  in_analysis: 'In analysis', completed: 'Completed', rejected: 'Rejected',
};
const SpecimenStatePill = ({ state }) => (
  <span className="pill" data-tone={SPEC_STATE_TONE[state] || 'ghost'}>{SPEC_STATE_LABEL[state] || state || '—'}</span>
);

const ConditionPill = ({ condition, rejectReason }) => {
  const conds = window.schema && window.schema.SPECIMEN_CONDITIONS ? window.schema.SPECIMEN_CONDITIONS : [];
  const def = conds.find(c => c.id === condition);
  if (!condition || !def) return <span style={{ color: 'var(--ink-300)' }}>—</span>;
  return (
    <span className="pill" data-tone={def.tone || 'ghost'}
      title={rejectReason || def.label}>
      {def.label}
    </span>
  );
};

const formatTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};
const formatDateTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sameDay = d.getTime() >= today.getTime();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

// ===== Dashboard live panels =====
// Three derived panels (TAT, specimen status, pending review) all read off
// existing entity collections — no new state, no new events. Adding more
// dashboard tiles never costs anything but a function.

const median = (nums) => {
  if (!nums || nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

const TatPanel = ({ results, specimens, orders }) => {
  const data = useMemoOS(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const specById = Object.fromEntries(specimens.map(s => [s.id, s]));
    const orderById = Object.fromEntries(orders.map(o => [o.id, o]));
    const byPriority = { stat: [], asap: [], routine: [] };
    let allCount = 0;
    for (const r of results) {
      if (!r.releasedAt || !r.specimenId) continue;
      const s = specById[r.specimenId];
      if (!s || !s.receivedAt) continue;
      if (r.releasedAt < dayAgo) continue;
      const o = s.orderId ? orderById[s.orderId] : null;
      const pri = (o && o.priority) || 'routine';
      const tatMin = (r.releasedAt - s.receivedAt) / 60000;
      if (byPriority[pri]) byPriority[pri].push(tatMin);
      allCount++;
    }
    // Live in-flight breach/warn counts. Computed off the same orders array so
    // the panel reflects the watcher's stamps without a separate db read.
    let warn = 0, breach = 0;
    for (const o of orders) {
      if (o.status === 'completed' || o.status === 'cancelled') continue;
      if (o.tatBreachLevel === 'warn') warn++;
      else if (o.tatBreachLevel === 'breach') breach++;
    }
    return {
      stat: median(byPriority.stat),
      asap: median(byPriority.asap),
      routine: median(byPriority.routine),
      count: allCount,
      activeWarn: warn,
      activeBreach: breach,
    };
  }, [results, specimens, orders]);

  const fmt = (m) => m == null ? '—' : (m < 60 ? Math.round(m) + 'm' : (m / 60).toFixed(1) + 'h');

  return (
    <div className="panel" style={{ padding: 14, height: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-900)' }}>Turnaround time</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>Median · last 24h</span>
      </div>
      {data.count === 0 ? (
        <div className="empty" style={{ flex: 1, padding: 0 }}>
          <div className="empty-sub" style={{ fontSize: 11.5 }}>No released results in the last 24h.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { l: 'STAT', v: data.stat, tone: 'rust' },
            { l: 'ASAP', v: data.asap, tone: 'amber' },
            { l: 'Routine', v: data.routine, tone: 'sage' },
          ].map(row => (
            <div key={row.l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="pill" data-tone={row.tone} style={{ width: 60, justifyContent: 'center' }}>{row.l}</span>
              <span className="mono tnum" style={{ fontSize: 18, fontWeight: 500, color: row.v == null ? 'var(--ink-300)' : 'var(--ink-900)', flex: 1 }}>
                {fmt(row.v)}
              </span>
            </div>
          ))}
          <div style={{
            marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--line-soft)',
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--ink-400)',
          }}>
            <span>{data.count} sampled</span>
            <span style={{ flex: 1 }}/>
            {(data.activeWarn > 0 || data.activeBreach > 0) ? (
              <button
                onClick={() => window.__navTo && window.__navTo('notifications')}
                title="Open Notifications admin"
                className="btn" data-size="xs" data-variant="ghost"
                style={{ height: 22, gap: 4 }}>
                {data.activeBreach > 0 && (
                  <span className="pill" data-tone="rust" style={{ fontSize: 10, height: 18 }}>{data.activeBreach} breach</span>
                )}
                {data.activeWarn > 0 && (
                  <span className="pill" data-tone="amber" style={{ fontSize: 10, height: 18 }}>{data.activeWarn} warn</span>
                )}
              </button>
            ) : (
              <span className="pill" data-tone="sage" style={{ fontSize: 10, height: 18 }}>All in target</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SpecimenStatusPanel = ({ specimens }) => {
  const counts = useMemoOS(() => {
    const c = {};
    for (const s of specimens) c[s.state] = (c[s.state] || 0) + 1;
    return c;
  }, [specimens]);
  const rows = [
    { state: 'pending',     label: 'Pending',     tone: 'ghost' },
    { state: 'in_transit',  label: 'In transit',  tone: 'amber' },
    { state: 'received',    label: 'Received',    tone: 'sage' },
    { state: 'in_analysis', label: 'In analysis', tone: 'info' },
    { state: 'completed',   label: 'Completed',   tone: 'slate' },
    { state: 'rejected',    label: 'Rejected',    tone: 'rust' },
  ];
  return (
    <div className="panel" style={{ padding: 14, height: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-900)' }}>Specimen status</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>All facilities</span>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, alignContent: 'start' }}>
        {rows.map(r => {
          const v = counts[r.state] || 0;
          return (
            <div key={r.state} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span className="pill" data-tone={r.tone} style={{ width: 90, justifyContent: 'center' }}>{r.label}</span>
              <span className="mono tnum" style={{ color: v ? 'var(--ink-900)' : 'var(--ink-300)' }}>{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PendingReviewPanel = ({ results }) => {
  const pending = useMemoOS(() => results.filter(r => r.status === 'preliminary' || r.status === 'pending'), [results]);
  const released = useMemoOS(() => results.filter(r => r.releasedAt), [results]);
  return (
    <div className="panel" style={{ padding: 14, height: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-900)' }}>Review queue</span>
        <button className="btn" data-variant="ghost" data-size="xs" onClick={() => window.__navTo && window.__navTo('results')}>Open</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }}>
        <div>
          <div className="section-title" style={{ fontSize: 9.5 }}>Pending verification</div>
          <div className="mono tnum" style={{ fontSize: 30, fontWeight: 400, color: pending.length > 0 ? 'var(--warn-700)' : 'var(--ink-300)', marginTop: 2, letterSpacing: '-0.02em' }}>
            {pending.length}
          </div>
        </div>
        <div>
          <div className="section-title" style={{ fontSize: 9.5 }}>Released today</div>
          <div className="mono tnum" style={{ fontSize: 18, color: 'var(--ink-700)', marginTop: 2, letterSpacing: '-0.01em' }}>
            {released.filter(r => r.releasedAt > Date.now() - 24*3600*1000).length}
          </div>
        </div>
      </div>
    </div>
  );
};

const ClientVolumePanel = ({ orders, results, specimens, clients }) => {
  const data = useMemoOS(() => {
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const clientById = Object.fromEntries(clients.map(c => [c.id, c]));
    const specById = Object.fromEntries(specimens.map(s => [s.id, s]));
    const ordersByClient = {};
    for (const o of orders) {
      if (!o.clientId) continue;
      if ((o.orderedAt || o.createdAt || 0) < dayAgo) continue;
      ordersByClient[o.clientId] = (ordersByClient[o.clientId] || 0) + 1;
    }
    // TAT per client (median of released results in last 24h whose order was theirs)
    const tatBuckets = {};
    for (const r of results) {
      if (!r.releasedAt || r.releasedAt < dayAgo) continue;
      const s = r.specimenId ? specById[r.specimenId] : null;
      if (!s) continue;
      const o = orders.find(x => x.id === s.orderId);
      if (!o || !o.clientId) continue;
      if (!s.receivedAt) continue;
      const min = (r.releasedAt - s.receivedAt) / 60000;
      tatBuckets[o.clientId] = tatBuckets[o.clientId] || [];
      tatBuckets[o.clientId].push(min);
    }
    const rows = Object.entries(ordersByClient)
      .map(([cid, count]) => ({
        client: clientById[cid] || { id: cid, code: '?', name: '—' },
        count, tatMedian: median(tatBuckets[cid]),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return { rows, total: Object.values(ordersByClient).reduce((s, n) => s + n, 0) };
  }, [orders, results, specimens, clients]);

  const fmt = (m) => m == null ? '—' : (m < 60 ? Math.round(m) + 'm' : (m / 60).toFixed(1) + 'h');

  return (
    <div className="panel" style={{ padding: 14, height: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-900)' }}>Top clients · 24h</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{data.total} order{data.total === 1 ? '' : 's'}</span>
      </div>
      {data.rows.length === 0 ? (
        <div className="empty" style={{ flex: 1, padding: 0 }}>
          <div className="empty-sub" style={{ fontSize: 11.5 }}>No client orders in the last 24h.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.rows.map(row => {
            const max = data.rows[0].count || 1;
            const widthPct = Math.round((row.count / max) * 100);
            const onClick = () => window.openOrdersFilteredByClient
              ? window.openOrdersFilteredByClient(row.client.id)
              : null;
            return (
              <div key={row.client.id}
                onClick={onClick}
                title={`Open Orders filtered to ${row.client.code} — ${row.client.name}`}
                style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr 60px 60px',
                  gap: 8, alignItems: 'center', fontSize: 12,
                  padding: '4px 6px', borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'background 80ms linear',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--ivory-100)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <span className="mono" style={{ color: 'var(--sage-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.client.code}
                </span>
                <div style={{ height: 14, background: 'var(--ivory-200)', borderRadius: 3, position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: widthPct + '%', background: 'var(--info)', borderRadius: 3 }}/>
                </div>
                <span className="mono tnum" style={{ color: 'var(--ink-900)', textAlign: 'right' }}>{row.count}</span>
                <span className="mono" style={{ color: 'var(--ink-400)', fontSize: 11, textAlign: 'right' }}>TAT {fmt(row.tatMedian)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DeliveryStatusPanel = ({ results }) => {
  const data = useMemoOS(() => {
    let delivered = 0, pending = 0, failed = 0, manual = 0, unreleased = 0;
    for (const r of results) {
      if (!r.releasedAt) { unreleased++; continue; }
      switch (r.deliveryStatus) {
        case 'delivered': delivered++; break;
        case 'pending':   pending++; break;
        case 'failed':    failed++; break;
        case 'manual':    manual++; break;
        default:          if (r.deliveredAt) delivered++; else pending++;
      }
    }
    return { delivered, pending, failed, manual, unreleased };
  }, [results]);

  const rows = [
    { l: 'Delivered',     v: data.delivered, tone: 'sage' },
    { l: 'Pending',       v: data.pending,   tone: 'amber' },
    { l: 'Failed',        v: data.failed,    tone: 'rust' },
    { l: 'Manual',        v: data.manual,    tone: 'ghost' },
    { l: 'Awaiting release', v: data.unreleased, tone: 'ghost' },
  ];
  return (
    <div className="panel" style={{ padding: 14, height: 220, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-900)' }}>Result delivery</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>All time</span>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignContent: 'start' }}>
        {rows.map(r => (
          <div key={r.l} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span className="pill" data-tone={r.tone} style={{ width: 110, justifyContent: 'center' }}>{r.l}</span>
            <span className="mono tnum" style={{ color: r.v ? 'var(--ink-900)' : 'var(--ink-300)' }}>{r.v}</span>
          </div>
        ))}
      </div>
      {data.failed > 0 && (
        <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid var(--line-soft)', fontSize: 11, color: 'var(--err-700)' }}>
          {data.failed} delivery failure{data.failed === 1 ? '' : 's'} — retry from Results page
        </div>
      )}
    </div>
  );
};

// ===== Activity panel — Dashboard's right pane =====
// Live tail of audit_events (every published lifecycle event lands here, plus
// rules-runtime audit entries). Most recent at top, capped to keep the panel
// dense.

const EVENT_TONE = {
  'order.created':      'info',
  'order.updated':      'slate',
  'order.cancelled':    'rust',
  'specimen.collected': 'sage',
  'specimen.received':  'sage',
  'specimen.rejected':  'rust',
  'specimen.routed':    'info',
  'specimen.completed': 'sage',
  'result.received':    'info',
  'result.verified':    'sage',
  'result.released':    'sage',
  'result.corrected':   'info',
  'result.delivered':   'sage',
  'result.delivery_failed': 'rust',
  'result.critical':    'rust',
  'result.critical.escalated': 'rust',
  'rule.fired':         'amber',
  'rule.audit':         'ghost',
  'lifecycle.transition': 'slate',
  'qc.violation':       'rust',
  'qc.violation_resolved': 'sage',
  'operator.safety.confirmed': 'amber',
  'notification':       'info',
  'order.tat.warned':   'amber',
  'order.tat.breached': 'rust',
};
const EVENT_LABEL = {
  'order.created':      'Order created',
  'order.updated':      'Order updated',
  'order.cancelled':    'Order cancelled',
  'specimen.collected': 'Specimen collected',
  'specimen.received':  'Specimen received',
  'specimen.rejected':  'Specimen rejected',
  'specimen.routed':    'Specimen routed',
  'specimen.completed': 'Specimen completed',
  'result.received':    'Result received',
  'result.verified':    'Result verified',
  'result.released':    'Result released',
  'result.corrected':   'Result corrected',
  'result.delivered':   'Result delivered',
  'result.delivery_failed': 'Delivery failed',
  'result.critical':    'Critical result',
  'result.critical.escalated': 'Critical escalated',
  'rule.fired':         'Rule fired',
  'rule.audit':         'Rule audit',
  'lifecycle.transition': 'Lifecycle transition',
  'qc.violation':       'QC violation',
  'qc.violation_resolved': 'QC resolved',
  'operator.safety.confirmed': 'Safety confirmed',
  'notification':       'Notification',
  'order.tat.warned':   'TAT warning',
  'order.tat.breached': 'TAT breach',
};

const ActivityPanel = () => {
  const events = window.useEntities('audit_events');
  const recent = useMemoOS(() => {
    return [...events]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 25);
  }, [events]);

  return (
    <div className="panel">
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>Activity</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
          {recent.length === 0 ? 'No events yet' : `${recent.length} most recent`}
        </span>
      </div>
      {recent.length === 0 ? (
        <div className="empty" style={{ padding: '32px 24px' }}>
          <div className="empty-icon"><IconReports size={16}/></div>
          <div className="empty-sub" style={{ fontSize: 11.5 }}>
            Lifecycle events stream here as the lab works — orders, specimens, results, and rule activity.
          </div>
        </div>
      ) : (
        <div style={{ maxHeight: 260, overflowY: 'auto' }}>
          {recent.map(ev => (
            <ActivityRow key={ev.id} ev={ev}/>
          ))}
        </div>
      )}
    </div>
  );
};

const ActivityRow = ({ ev }) => {
  const tone = EVENT_TONE[ev.type] || 'ghost';
  const label = EVENT_LABEL[ev.type] || ev.type;
  const detail = summarizeEvent(ev);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 1fr auto',
      alignItems: 'center', gap: 10,
      padding: '7px 14px',
      borderBottom: '1px solid var(--line-soft)',
      fontSize: 12,
    }}>
      <span className="mono" style={{ color: 'var(--ink-400)', fontSize: 11 }}>
        {formatTime(ev.ts)}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="pill" data-tone={tone} style={{ flexShrink: 0 }}>{label}</span>
        {detail && (
          <span style={{
            color: 'var(--ink-500)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{detail}</span>
        )}
      </div>
      {ev.actor && ev.actor !== 'system' && (
        <span style={{ fontSize: 10.5, color: 'var(--ink-300)' }}>{ev.actor}</span>
      )}
    </div>
  );
};

const summarizeEvent = (ev) => {
  const p = ev.payload || {};
  if (ev.type === 'operator.safety.confirmed') {
    return `${p.actionId || 'safety action'} confirmed`;
  }
  if (ev.type === 'rule.fired') {
    const n = (p.actionResults || []).length;
    return `${p.ruleName || 'rule'} → ${n} action${n === 1 ? '' : 's'}`;
  }
  if (ev.type === 'rule.audit') {
    return p.message || '';
  }
  if (p.order && p.order.orderNumber) return `Order ${p.order.orderNumber}`;
  if (p.specimen && p.specimen.accessionNumber) return `Accession ${p.specimen.accessionNumber}`;
  if (p.specimen && p.specimen.barcode) return `Barcode ${p.specimen.barcode}`;
  if (p.result) return p.result.id;
  if (ev.entityType && ev.entityId) return `${ev.entityType} ${String(ev.entityId).slice(-6)}`;
  return '';
};

const currentActorId = () => (window.currentUser ? window.currentUser.id : 'unknown');

const safetyFact = (label, value) => ({
  label,
  value: value == null || value === '' ? '-' : String(value),
});

const safetyConfirm = (options) => {
  if (!window.safetyConfirm) return Promise.resolve({ confirmed: false, reason: '', typedText: '' });
  return window.safetyConfirm(options);
};

const safetyNotice = (options) => safetyConfirm({
  tone: 'info',
  title: 'Notice',
  confirmLabel: 'OK',
  cancelLabel: null,
  audit: false,
  notice: true,
  ...options,
});

const INTAKE_LIMITS = {
  payloadBytes: 512 * 1024,
  rows: 250,
  testsPerOrder: 60,
  fieldChars: 500,
};

const bytesOfText = (text) => {
  const s = text == null ? '' : String(text);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return s.length;
};

const collectOversizedFields = (value, path = 'payload', out = []) => {
  if (out.length >= 8) return out;
  if (typeof value === 'string' && value.length > INTAKE_LIMITS.fieldChars) {
    out.push(path + ' is ' + value.length + ' chars');
    return out;
  }
  if (Array.isArray(value)) {
    value.slice(0, INTAKE_LIMITS.testsPerOrder + 1).forEach((item, i) => collectOversizedFields(item, path + '[' + i + ']', out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(k => collectOversizedFields(value[k], path + '.' + k, out));
  }
  return out;
};

const validateMapperPreview = (payload, rows) => {
  const errors = [];
  const bytes = bytesOfText(payload);
  if (bytes > INTAKE_LIMITS.payloadBytes) errors.push('payload is too large (' + bytes + ' bytes)');
  if (!Array.isArray(rows)) errors.push('mapped rows must be an array');
  else {
    if (rows.length > INTAKE_LIMITS.rows) errors.push('too many rows (' + rows.length + ')');
    rows.forEach((row, i) => {
      const tests = Array.isArray(row && row.tests) ? row.tests : [];
      const orderTestIds = row && row.order && row.order.testIds;
      const testCount = tests.length + (Array.isArray(orderTestIds) ? orderTestIds.length : typeof orderTestIds === 'string' ? orderTestIds.split(/[;,]/).filter(Boolean).length : 0);
      if (testCount > INTAKE_LIMITS.testsPerOrder) errors.push('row ' + (i + 1) + ' has too many tests (' + testCount + ')');
    });
    errors.push(...collectOversizedFields(rows, 'rows'));
  }
  return { ok: errors.length === 0, errors, bytes };
};

const validateHl7Intake = (text, parsed) => {
  const errors = [];
  const bytes = bytesOfText(text);
  if (bytes > INTAKE_LIMITS.payloadBytes) errors.push('message is too large (' + bytes + ' bytes)');
  if (parsed && Array.isArray(parsed.tests) && parsed.tests.length > INTAKE_LIMITS.testsPerOrder) {
    errors.push('too many tests (' + parsed.tests.length + ')');
  }
  errors.push(...collectOversizedFields(parsed, 'hl7'));
  return { ok: errors.length === 0, errors, bytes };
};

const confirmConfigChange = (options) => safetyConfirm({
  tone: 'warning',
  requireReason: true,
  reasonLabel: 'Change reason',
  reasonPlaceholder: 'why this control change is safe',
  ...options,
});

const compactName = (patient) => {
  if (!patient) return 'no patient';
  const name = [patient.lastName, patient.firstName].filter(Boolean).join(', ');
  return [patient.mrn, name].filter(Boolean).join(' - ') || patient.id;
};

// ===== Results =====
const ResultsPage = () => {
  const results = window.useEntities('results');
  const specimens = window.useEntities('specimens');
  const patients = window.useEntities('patients');
  const tests = window.useEntities('tests');
  const specimenById = useMemoOS(() => Object.fromEntries(specimens.map(s => [s.id, s])), [specimens]);
  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);

  const [filter, setFilter] = useStateOS('all');
  const [checked, setChecked] = useStateOS(new Set());
  const [batchOutcome, setBatchOutcome] = useStateOS(null);
  const [showSuperseded, setShowSuperseded] = useStateOS(false);
  const [correcting, setCorrecting] = useStateOS(null);  // result being corrected

  // Expose a global hook so the entity drawer's "Correct this result" button
  // can open the modal regardless of the originating page. Cleared on unmount
  // so navigating away doesn't leave a stale handler bound.
  useEffectOS(() => {
    window.openCorrectionFor = async (resultId) => {
      const r = await window.db.get('results', resultId);
      if (r) setCorrecting(r);
    };
    return () => { delete window.openCorrectionFor; };
  }, []);

  const filtered = useMemoOS(() => {
    return results
      // Hide superseded records by default — operators want the latest in
      // each correction chain, not the historical originals. Toggle reveals
      // them for audit / review purposes.
      .filter(r => showSuperseded || !r.supersededByResultId)
      .filter(r => {
        if (filter === 'all') return true;
        if (filter === 'pending')  return r.status === 'pending' || r.status === 'preliminary';
        if (filter === 'critical') return r.flag === 'LL' || r.flag === 'HH' || r.flag === 'A' || r.flag === 'AA';
        if (filter === 'final')    return r.status === 'final';
        if (filter === 'amended')  return r.status === 'corrected';
        return true;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [results, filter, showSuperseded]);

  const pendingCount = useMemoOS(
    () => results.filter(r => r.status === 'preliminary' || r.status === 'pending').length,
    [results]
  );

  const factsForResult = (r) => {
    const spec = r && r.specimenId ? specimenById[r.specimenId] : null;
    const pat = spec && spec.patientId ? patientById[spec.patientId] : null;
    const test = r && r.testId ? testById[r.testId] : null;
    return [
      safetyFact('result id', r && r.id),
      safetyFact('patient', compactName(pat)),
      safetyFact('accession', spec ? (spec.accessionNumber || spec.id) : (r && r.specimenId)),
      safetyFact('test', test ? `${test.code || ''} ${test.name || ''}`.trim() : (r && r.testId)),
      safetyFact('value', r ? `${r.value == null ? '-' : r.value} ${r.units || ''}`.trim() : '-'),
      safetyFact('flag', (r && r.flag) || 'none'),
      safetyFact('status', r && r.status),
      safetyFact('released', r && r.releasedAt ? formatDateTime(r.releasedAt) : 'not released'),
    ];
  };

  const verify = async (r) => {
    // Verify only — release is a separate explicit action so the workflow
    // mirrors a real lab (tech verifies; supervisor or auto-rule releases).
    const actor = currentActorId();
    let updated;
    try {
      updated = await window.lifecycle.transition('results',
        { ...r, verifiedAt: Date.now(), verifiedBy: actor }, 'final',
        { actor, reason: 'tech-verified' });
    } catch (e) {
      console.warn('[results] verify via lifecycle refused; not advancing', e);
      return;
    }
    window.events.publish(window.EVENTS.RESULT_VERIFIED, {
      entityType: 'result', entityId: updated.id, result: updated,
      actor,
    });
  };
  const release = async (r) => {
    const ask = await safetyConfirm({
      id: 'results.release.single',
      tone: 'danger',
      title: 'Release result',
      message: 'This reports the result and starts delivery routing. QC will be re-checked after you confirm.',
      facts: factsForResult(r),
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Release',
    });
    if (!ask.confirmed) return;

    const fresh = await window.db.get('results', r.id);
    if (!fresh || fresh.releasedAt || fresh.status !== 'final') {
      await safetyNotice({
        tone: 'warning',
        title: 'Release skipped',
        message: 'The result changed before release. Reopen the row and try again.',
        facts: factsForResult(fresh || r),
      });
      return;
    }

    if (window.qcGate) {
      const gate = await window.qcGate.canRelease(fresh);
      if (!gate.ok) {
        await safetyNotice({
          id: 'results.release.blocked',
          tone: 'danger',
          title: 'Release blocked by QC',
          message: 'Resolve the QC violation or run passing QC before releasing.',
          facts: [...factsForResult(fresh), safetyFact('qc lockout', gate.reason)],
        });
        return;
      }
    }
    const actor = currentActorId();
    const updated = {
      ...fresh, releasedAt: Date.now(), releasedBy: actor,
    };
    await window.db.put('results', updated);
    window.events.publish(window.EVENTS.RESULT_RELEASED, {
      entityType: 'result', entityId: updated.id, result: updated,
      actor,
    });
  };
  const reject = async (r) => {
    const ask = await safetyConfirm({
      id: 'results.cancel',
      tone: 'danger',
      title: 'Cancel result',
      message: 'This removes the result from the active reporting path.',
      facts: factsForResult(r),
      requireReason: true,
      reasonLabel: 'Cancel reason',
      reasonPlaceholder: 'short clinical reason',
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Cancel result',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('results', r.id);
    if (!fresh || fresh.status === 'cancelled') return;
    const actor = currentActorId();
    try {
      await window.lifecycle.transition('results', fresh, 'cancelled',
        { actor, reason: ask.reason || 'cancelled by operator' });
    } catch (e) {
      console.warn('[results] reject via lifecycle refused', e);
    }
  };

  // Issue a correction. Creates a NEW result record with status='corrected'
  // pointing at the prior via correctionOf. The prior is NOT mutated except
  // for a back-reference stamp (supersededByResultId). The new record gets
  // a fresh ref-range resolution + flag computation since the corrected
  // value may cross thresholds the prior didn't. Publishes:
  //   - RESULT_CORRECTED — for audit + delivery-watcher amendment re-send
  //   - RESULT_RECEIVED  — so reflex / critical / delta rules cascade
  //                        against the corrected value
  // The watcher decides whether to also fire RESULT_RELEASED when the prior
  // was already released — corrections to released results need to go out
  // as amendments to the same client.
  const issueCorrection = async (priorResult, draft) => {
    if (!priorResult || !draft.value) {
      await safetyNotice({
        tone: 'warning',
        title: 'Correction incomplete',
        message: 'Value and reason are required to issue a correction.',
      });
      return null;
    }
    if (!draft.reason || !String(draft.reason).trim()) {
      await safetyNotice({
        tone: 'warning',
        title: 'Correction reason required',
        message: 'A regulatory reason is required for any correction.',
      });
      return null;
    }
    const ask = await safetyConfirm({
      id: priorResult.releasedAt ? 'results.correction.released' : 'results.correction',
      tone: priorResult.releasedAt ? 'danger' : 'warning',
      title: priorResult.releasedAt ? 'Correct released result' : 'Correct result',
      message: priorResult.releasedAt
        ? 'This creates an amended result and re-sends the correction to the client.'
        : 'This creates a new corrected result and preserves the original.',
      facts: [
        ...factsForResult(priorResult),
        safetyFact('new value', `${draft.value} ${draft.units || priorResult.units || ''}`.trim()),
        safetyFact('reason', draft.reason),
      ],
      entityType: 'result',
      entityId: priorResult.id,
      confirmLabel: priorResult.releasedAt ? 'Issue amendment' : 'Issue correction',
    });
    if (!ask.confirmed) return null;

    const freshPrior = await window.db.get('results', priorResult.id);
    if (!freshPrior || freshPrior.supersededByResultId) {
      await safetyNotice({
        tone: 'warning',
        title: 'Correction skipped',
        message: 'The result changed before correction. Reopen the row and try again.',
        facts: factsForResult(freshPrior || priorResult),
      });
      return null;
    }

    const actor = currentActorId();
    priorResult = freshPrior;
    const test = priorResult.testId ? testById[priorResult.testId] : null;
    const spec = priorResult.specimenId ? specimenById[priorResult.specimenId] : null;
    const patient = spec && spec.patientId ? patientById[spec.patientId] : null;

    // Re-resolve the demographic-aware reference range against the patient.
    // The corrected value may legitimately fall outside what the prior
    // value's range said — flag the new record, not stamp-copy the prior.
    let range = { low: priorResult.refRangeLow, high: priorResult.refRangeHigh, units: priorResult.units, source: priorResult.refRangeSource || 'snapshot', matchedRange: null };
    if (test && window.referenceRanges && typeof window.referenceRanges.pick === 'function') {
      const picked = window.referenceRanges.pick(test, { patient, asOf: Date.now() });
      if (picked) range = picked;
    }

    // Auto-flag from the resolved range. Numeric values get L/H if outside;
    // strings stay flagless and rules can stamp A/AA downstream.
    const v = Number(draft.value);
    const numericValue = !isNaN(v);
    let flag = '';
    if (numericValue) {
      if (range.low  != null && v < Number(range.low))  flag = 'L';
      else if (range.high != null && v > Number(range.high)) flag = 'H';
    }

    // Build the corrected record. Copies through specimen/test/instrument and
    // resets verification state — the corrected value is a NEW final record
    // that needs no re-verification (the operator who issued the correction
    // is the one signing off). releasedAt/releasedBy stay null until either
    // the user explicitly releases OR the delivery-watcher promotes it.
    const corrected = window.schema.newResult({
      specimenId: priorResult.specimenId, testId: priorResult.testId,
      value: numericValue ? v : draft.value,
      units: draft.units || range.units || priorResult.units || '',
      refRangeLow: range.low == null ? null : range.low,
      refRangeHigh: range.high == null ? null : range.high,
      refRangeSource: range.source || 'none',
      refRangeId: range.matchedRange ? range.matchedRange.id : null,
      flag,
      status: 'corrected',
      verifiedBy: actor, verifiedAt: Date.now(),
      // Correction chain
      correctionOf: priorResult.id,
      correctionReason: String(draft.reason).trim(),
      correctedBy: actor,
      correctedAt: Date.now(),
      // Carry over instrument id + comments (operator can edit comments)
      instrumentId: priorResult.instrumentId || null,
      comments: draft.comments || priorResult.comments || '',
      enteredManually: true, enteredBy: actor,
    });
    await window.db.put('results', corrected);

    // Stamp back-reference on the prior — does NOT change the prior's status
    // (it really WAS final at the time it was reported; preserving that is the
    // whole point of a correction chain).
    await window.db.put('results', { ...priorResult, supersededByResultId: corrected.id });

    // Fire RESULT_RECEIVED so rules + critical-flag detection cascade against
    // the corrected value as if it were a fresh result (a corrected value
    // that crosses a critical threshold should escalate).
    window.events.publish(window.EVENTS.RESULT_RECEIVED, {
      entityType: 'result', entityId: corrected.id,
      result: corrected, specimen: spec, test, manual: true, viaCorrection: true, actor,
    });
    // Fire RESULT_CORRECTED — the delivery-watcher subscribes to this to
    // re-send to the ordering client as an amendment.
    window.events.publish(window.EVENTS.RESULT_CORRECTED, {
      entityType: 'result', entityId: corrected.id,
      result: corrected, prior: priorResult, actor,
      reason: corrected.correctionReason,
      priorReleasedAt: priorResult.releasedAt || null,
    });
    return corrected;
  };
  const verifyAllPreliminary = async () => {
    const targets = results.filter(r => r.status === 'preliminary');
    if (targets.length === 0) return;
    const ask = await safetyConfirm({
      id: 'results.verify.batch',
      tone: 'warning',
      title: 'Batch verify results',
      message: 'This marks every current preliminary result as final. Routine single-result verification stays one click.',
      facts: [
        safetyFact('count', targets.length),
        safetyFact('first results', targets.slice(0, 6).map(r => {
          const spec = r.specimenId ? specimenById[r.specimenId] : null;
          const test = r.testId ? testById[r.testId] : null;
          return `${spec ? (spec.accessionNumber || spec.id.slice(-6)) : r.id.slice(-6)} ${test ? test.code : r.testId || ''}`.trim();
        }).join(', ')),
      ],
      entityType: 'result',
      entityId: 'batch',
      confirmLabel: 'Verify batch',
    });
    if (!ask.confirmed) return;
    for (const r of targets) {
      const fresh = await window.db.get('results', r.id);
      if (fresh && fresh.status === 'preliminary') await verify(fresh);
    }
  };

  // Batch release — releases each checked result that is in `final` status with
  // no releasedAt yet. Each one consults qcGate.canRelease so a locked test
  // doesn't sneak through. Partial-fail is the normal case: report counts.
  const releasable = useMemoOS(
    () => filtered.filter(r => r.status === 'final' && !r.releasedAt),
    [filtered]
  );
  const checkedReleasable = useMemoOS(
    () => releasable.filter(r => checked.has(r.id)),
    [releasable, checked]
  );

  const toggleCheck = (id) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };
  const toggleAllReleasable = () => {
    if (checkedReleasable.length === releasable.length && releasable.length > 0) {
      setChecked(new Set());
    } else {
      setChecked(new Set(releasable.map(r => r.id)));
    }
  };

  const batchRelease = async () => {
    if (checkedReleasable.length === 0) return;
    const ask = await safetyConfirm({
      id: 'results.release.batch',
      tone: 'danger',
      title: 'Batch release results',
      message: 'This reports all selected final results. Each result will be re-read and QC-checked after confirmation.',
      facts: [
        safetyFact('selected', checkedReleasable.length),
        safetyFact('first accessions', checkedReleasable.slice(0, 6).map(r => {
          const spec = r.specimenId ? specimenById[r.specimenId] : null;
          const test = r.testId ? testById[r.testId] : null;
          return `${spec ? (spec.accessionNumber || spec.id.slice(-6)) : r.id.slice(-6)} ${test ? test.code : r.testId || ''}`.trim();
        }).join(', ')),
      ],
      entityType: 'result',
      entityId: 'batch',
      confirmLabel: 'Release selected',
    });
    if (!ask.confirmed) return;
    const actor = currentActorId();
    const outcome = { released: 0, blocked: [], errors: [] };
    for (const r of checkedReleasable) {
      const fresh = await window.db.get('results', r.id);
      if (!fresh || fresh.releasedAt || fresh.status !== 'final') {
        outcome.blocked.push({ id: r.id, accession: (specimenById[r.specimenId] || {}).accessionNumber, reason: 'changed before release' });
        continue;
      }
      const gate = window.qcGate ? await window.qcGate.canRelease(fresh) : { ok: true };
      if (!gate.ok) {
        outcome.blocked.push({ id: fresh.id, accession: (specimenById[fresh.specimenId] || {}).accessionNumber, reason: gate.reason });
        continue;
      }
      try {
        const updated = { ...fresh, releasedAt: Date.now(), releasedBy: actor };
        await window.db.put('results', updated);
        window.events.publish(window.EVENTS.RESULT_RELEASED, {
          entityType: 'result', entityId: updated.id, result: updated, actor,
        });
        outcome.released++;
      } catch (e) {
        outcome.errors.push({ id: r.id, msg: e.message });
      }
    }
    setBatchOutcome(outcome);
    setChecked(new Set());
  };

  const retryDelivery = async (r) => {
    const ask = await safetyConfirm({
      id: 'results.delivery.retry',
      tone: 'warning',
      title: 'Retry delivery',
      message: 'This queues the released result for another delivery attempt.',
      facts: factsForResult(r),
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Retry delivery',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('results', r.id);
    if (!fresh || !fresh.releasedAt) return;
    if (window.deliveryWatcher) await window.deliveryWatcher.resend(fresh.id);
  };

  return (
    <Page label="Results">
      <PageHeader title="Results" sub="Verified, pending, and amended results across all departments."
        actions={[
          checkedReleasable.length > 0 && (
            <button key="br" className="btn" data-variant="primary" data-size="sm" onClick={batchRelease}>
              Release {checkedReleasable.length}
            </button>
          ),
          pendingCount > 0 && (
            <button key="va" className="btn" data-size="sm" onClick={verifyAllPreliminary}>
              <IconCheck size={13}/> Verify all {pendingCount} preliminary
            </button>
          ),
        ].filter(Boolean)}/>
      {batchOutcome && (
        <div className="panel" style={{ padding: '10px 14px', marginBottom: 10, background: batchOutcome.blocked.length || batchOutcome.errors.length ? 'var(--amber-soft)' : 'var(--sage-100)', borderColor: 'var(--line-strong)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>
              Released {batchOutcome.released}
              {batchOutcome.blocked.length > 0 && ` · ${batchOutcome.blocked.length} blocked by QC`}
              {batchOutcome.errors.length > 0 && ` · ${batchOutcome.errors.length} errored`}
            </span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="xs" data-variant="ghost" onClick={() => setBatchOutcome(null)}>Dismiss</button>
          </div>
          {batchOutcome.blocked.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-700)' }}>
              {batchOutcome.blocked.slice(0, 3).map(b => <div key={b.id} className="mono">· {b.accession || b.id.slice(-6)} — {b.reason}</div>)}
              {batchOutcome.blocked.length > 3 && <div style={{ color: 'var(--ink-400)' }}>+ {batchOutcome.blocked.length - 3} more…</div>}
            </div>
          )}
        </div>
      )}
      <div className="panel">
        <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <SegSelect
            options={[
              {id:'all',label:'All'},
              {id:'pending',label:'Pending review'},
              {id:'critical',label:'Critical'},
              {id:'final',label:'Final'},
              {id:'amended',label:'Amended'},
            ]}
            value={filter} onChange={setFilter}/>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--ink-500)', cursor: 'pointer' }}
            title="Hide records that have been superseded by a corrected version">
            <input type="checkbox" checked={showSuperseded} onChange={e => setShowSuperseded(e.target.checked)}/>
            Show superseded
          </label>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} results</span>
        </div>
        {filtered.length === 0 ? (
          <EmptyTable
            columns={['Accession','Patient','Test','Value','Units','Ref range','Flag','Status','']}
            message={results.length === 0 ? 'No results yet' : 'No results match the filter'}
            sub={results.length === 0 ? 'Route a specimen to an analyzer — the simulator drops results within a few seconds.' : 'Adjust the filter.'}/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" title="Select all releasable"
                    checked={releasable.length > 0 && checkedReleasable.length === releasable.length}
                    onChange={toggleAllReleasable}
                    disabled={releasable.length === 0}/>
                </th>
                <th>Accession</th><th>Patient</th><th>Test</th>
                <th>Value</th><th>Units</th><th>Ref range</th>
                <th>Flag</th><th>Status</th><th>Delivery</th><th>Resulted</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const spec = r.specimenId ? specimenById[r.specimenId] : null;
                const pat = spec && spec.patientId ? patientById[spec.patientId] : null;
                const test = r.testId ? testById[r.testId] : null;
                const isPending = r.status === 'preliminary' || r.status === 'pending';
                const canBatchRelease = r.status === 'final' && !r.releasedAt;
                return (
                  <tr key={r.id} style={{ cursor: 'pointer' }}
                      onClick={() => window.openEntity && window.openEntity('result', r.id)}>
                    <td onClick={e => e.stopPropagation()}>
                      {canBatchRelease && (
                        <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleCheck(r.id)}/>
                      )}
                    </td>
                    <td onClick={e => { if (spec) { e.stopPropagation(); window.openEntity && window.openEntity('specimen', spec.id); }}}
                        style={spec ? { cursor: 'pointer' } : {}}>
                      <span className="mono" style={spec ? { color: 'var(--sage-700)' } : {}}>{spec ? spec.accessionNumber : '—'}</span>
                    </td>
                    <td onClick={e => { if (pat) { e.stopPropagation(); window.openEntity && window.openEntity('patient', pat.id); }}}
                        style={pat ? { cursor: 'pointer', color: 'var(--sage-700)' } : {}}>
                      {pat ? (pat.mrn || ((pat.lastName || '') + (pat.firstName ? ', ' + pat.firstName : ''))) : '—'}
                    </td>
                    <td>{test ? <><span className="mono">{test.code}</span> <span style={{ color: 'var(--ink-400)', marginLeft: 4 }}>{test.shortName || test.name}</span></> : '—'}</td>
                    <td className="mono tnum" style={{ fontWeight: 500 }}>{r.value != null ? r.value : '—'}</td>
                    <td>{r.units || '—'}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-400)' }}>
                      {r.refRangeLow != null && r.refRangeHigh != null ? (r.refRangeLow + '–' + r.refRangeHigh) : '—'}
                    </td>
                    <td><ResultFlagPill flag={r.flag}/></td>
                    <td><ResultStatusPill status={r.status}/></td>
                    <td><DeliveryPill r={r}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(r.createdAt)}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      {isPending ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-variant="primary" data-size="xs" onClick={() => verify(r)}>Verify</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => reject(r)}>Reject</button>
                        </div>
                      ) : r.status === 'final' && !r.releasedAt ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-variant="primary" data-size="xs" onClick={() => release(r)}>Release</button>
                          <span style={{ fontSize: 10.5, color: 'var(--ink-400)', alignSelf: 'center' }}>
                            verified by {window.currentUserApi ? window.currentUserApi.displayName(r.verifiedBy) : r.verifiedBy}
                          </span>
                        </div>
                      ) : r.deliveryStatus === 'failed' ? (
                        <button className="btn" data-variant="primary" data-size="xs"
                          onClick={() => retryDelivery(r)}>
                          Retry delivery
                        </button>
                      ) : r.releasedAt ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                            released by {window.currentUserApi ? window.currentUserApi.displayName(r.releasedBy) : r.releasedBy}
                          </span>
                          {!r.supersededByResultId && (
                            <button className="btn" data-size="xs" data-variant="ghost"
                              onClick={() => setCorrecting(r)}
                              title="Issue a correction (creates an amended record; original preserved)">
                              Correct
                            </button>
                          )}
                        </div>
                      ) : (r.status === 'final' || r.status === 'corrected') && !r.supersededByResultId ? (
                        <button className="btn" data-size="xs" data-variant="ghost"
                          onClick={() => setCorrecting(r)}
                          title="Issue a correction">
                          Correct
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {correcting && (
        <CorrectResultModal
          prior={correcting}
          test={correcting.testId ? testById[correcting.testId] : null}
          specimen={correcting.specimenId ? specimenById[correcting.specimenId] : null}
          patient={(correcting.specimenId && specimenById[correcting.specimenId] && specimenById[correcting.specimenId].patientId)
            ? patientById[specimenById[correcting.specimenId].patientId] : null}
          onCancel={() => setCorrecting(null)}
          onSave={async (draft) => {
            const out = await issueCorrection(correcting, draft);
            if (out) setCorrecting(null);
          }}/>
      )}
    </Page>
  );
};

// Reasons preset list — operators can override but the dropdown covers the
// canonical CLIA-tracked reasons. The free-text comments field captures
// anything more nuanced.
const CORRECTION_REASONS = [
  'Transcription error',
  'Wrong specimen',
  'Instrument calibration drift',
  'Clerical / data entry',
  'Reflex test added',
  'QC re-evaluation',
  'Patient ID mismatch corrected',
  'Other (see comments)',
];

const CorrectResultModal = ({ prior, test, specimen, patient, onCancel, onSave }) => {
  const [draft, setDraft] = useStateOS({
    value: prior.value != null ? String(prior.value) : '',
    units: prior.units || (test && test.units) || '',
    reason: '',
    comments: prior.comments || '',
  });
  const [saving, setSaving] = useStateOS(false);

  // Resolve the demographic-aware range so the live preview shows what flag
  // the corrected value will get — same logic the save path will run.
  const resolvedRange = useMemoOS(() => {
    if (test && window.referenceRanges && typeof window.referenceRanges.pick === 'function') {
      try { return window.referenceRanges.pick(test, { patient, asOf: Date.now() }); }
      catch (e) { return null; }
    }
    return null;
  }, [test, patient]);

  const previewFlag = useMemoOS(() => {
    if (draft.value === '' || !resolvedRange) return '';
    const v = Number(draft.value);
    if (isNaN(v)) return '';
    if (resolvedRange.low  != null && v < Number(resolvedRange.low))  return 'L';
    if (resolvedRange.high != null && v > Number(resolvedRange.high)) return 'H';
    return '';
  }, [draft.value, resolvedRange]);

  const valueChanged = String(draft.value) !== (prior.value != null ? String(prior.value) : '');
  const ready = !!draft.value && !!String(draft.reason || '').trim() && valueChanged;

  const submit = async () => {
    setSaving(true);
    try { await onSave(draft); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onCancel} className="backdrop-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.45)',
        display: 'grid', placeItems: 'center', zIndex: 1500 }}>
      <div onClick={e => e.stopPropagation()} className="scale-in"
        style={{ background: 'var(--ivory-50)', border: '1px solid var(--line)',
          borderRadius: 8, width: 580, maxWidth: '92vw', maxHeight: '85vh',
          boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>Correct result</span>
          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
            {test ? <><span className="mono">{test.code}</span> · {test.name}</> : 'unknown test'}
            {specimen && <> · accession <span className="mono">{specimen.accessionNumber}</span></>}
          </span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="xs" data-variant="ghost" onClick={onCancel}>Cancel</button>
        </div>
        <div style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 5, padding: 10, marginBottom: 12 }}>
            <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Original result</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <span><span style={{ color: 'var(--ink-400)' }}>Value</span> <span className="mono tnum" style={{ fontWeight: 500 }}>{prior.value != null ? prior.value : '—'} {prior.units || ''}</span></span>
              <span><span style={{ color: 'var(--ink-400)' }}>Flag</span> {prior.flag || '—'}</span>
              <span><span style={{ color: 'var(--ink-400)' }}>Status</span> {prior.status}</span>
              <span><span style={{ color: 'var(--ink-400)' }}>Released</span> {prior.releasedAt ? '✓' : '—'}</span>
            </div>
            {prior.releasedAt && (
              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--warn-700)' }}>
                ⚠ This result has already been delivered. Saving the correction will re-send an amendment to the client.
              </div>
            )}
          </div>

          <CatalogField label="Corrected value" required>
            <input className="input mono tnum" autoFocus value={draft.value}
              onChange={e => setDraft({ ...draft, value: e.target.value })}/>
          </CatalogField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <CatalogField label="Units">
              <input className="input mono" value={draft.units}
                onChange={e => setDraft({ ...draft, units: e.target.value })}/>
            </CatalogField>
            <CatalogField label="Range / flag preview">
              <div style={{ height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--ivory-100)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <span className="mono tnum" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
                  {resolvedRange && resolvedRange.low != null ? `${resolvedRange.low}–${resolvedRange.high}` : '—'}
                </span>
                {resolvedRange && resolvedRange.source && (
                  <span className="pill" data-tone={resolvedRange.source === 'matched' ? 'sage' : 'ghost'} style={{ fontSize: 9.5 }}>
                    {resolvedRange.source}
                  </span>
                )}
                <span style={{ flex: 1 }}/>
                {previewFlag ? <span className="pill" data-tone={previewFlag === 'L' ? 'info' : 'amber'} style={{ fontSize: 10.5 }}>{previewFlag}</span> : <span style={{ color: 'var(--ink-300)', fontSize: 11 }}>—</span>}
              </div>
            </CatalogField>
          </div>
          <CatalogField label="Reason" required>
            <select className="input" value={draft.reason}
              onChange={e => setDraft({ ...draft, reason: e.target.value })}>
              <option value="">— pick a reason —</option>
              {CORRECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </CatalogField>
          <CatalogField label="Comments (optional)">
            <textarea className="input" rows={3} value={draft.comments}
              onChange={e => setDraft({ ...draft, comments: e.target.value })}
              style={{ height: 'auto', padding: 8, resize: 'vertical' }}
              placeholder="Additional context — operator notes, instrument run id, etc."/>
          </CatalogField>
          <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 4 }}>
            A correction creates a new record; the original is preserved at status <strong>final</strong> for audit. The new record is auto-verified by you ({(window.currentUser && window.currentUser.id) || 'unknown'}).
          </div>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button className="btn" data-size="sm" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={submit} disabled={saving || !ready}>
            {saving ? 'Saving…' : (prior.releasedAt ? 'Issue correction + re-deliver' : 'Issue correction')}
          </button>
        </div>
      </div>
    </div>
  );
};

const RESULT_FLAG_TONE = { L: 'info', H: 'amber', LL: 'rust', HH: 'rust', A: 'amber', AA: 'rust', '': 'ghost' };
const RESULT_FLAG_LABEL = { L: 'L', H: 'H', LL: 'LL', HH: 'HH', A: 'A', AA: 'AA', '': '—' };
const ResultFlagPill = ({ flag }) => (
  <span className="pill" data-tone={RESULT_FLAG_TONE[flag || ''] || 'ghost'}>
    {RESULT_FLAG_LABEL[flag || ''] || flag}
  </span>
);
const RESULT_STATUS_TONE = { pending: 'ghost', preliminary: 'amber', final: 'sage', corrected: 'info', cancelled: 'rust', entered_in_error: 'rust' };
const ResultStatusPill = ({ status }) => (
  <span className="pill" data-tone={RESULT_STATUS_TONE[status] || 'ghost'}>{status || '—'}</span>
);

const DELIVERY_TONE = { delivered: 'sage', pending: 'amber', failed: 'rust', manual: 'ghost', '': 'ghost' };
const DeliveryPill = ({ r }) => {
  if (!r.releasedAt) return <span style={{ color: 'var(--ink-300)' }}>—</span>;
  const status = r.deliveryStatus || (r.deliveredAt ? 'delivered' : 'pending');
  const label = status === 'delivered'
    ? `${r.deliveredVia || 'sent'}`
    : status === 'manual' ? 'manual'
    : status;
  return (
    <span className="pill" data-tone={DELIVERY_TONE[status] || 'ghost'}
      title={r.deliveredTo ? `${status} → ${r.deliveredTo}` : status}>
      {label}
    </span>
  );
};

// ===== Patient search =====
const PatientsPage = () => {
  const patients = window.useEntities('patients');
  const orders = window.useEntities('orders');
  const specimens = window.useEntities('specimens');
  const results = window.useEntities('results');
  const tests = window.useEntities('tests');

  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  const specimenById = useMemoOS(() => Object.fromEntries(specimens.map(s => [s.id, s])), [specimens]);

  const [q, setQ] = useStateOS('');
  const [selectedId, setSelectedId] = useStateOS(null);

  const matches = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return patients.slice(0, 40);
    return patients.filter(p => {
      const blob = [p.mrn, p.lastName, p.firstName, p.dob].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(needle);
    }).slice(0, 40);
  }, [patients, q]);

  const selected = selectedId ? patients.find(p => p.id === selectedId) : null;

  const patientOrders = useMemoOS(() => {
    if (!selected) return [];
    return orders
      .filter(o => o.patientId === selected.id)
      .sort((a, b) => (b.orderedAt || b.createdAt || 0) - (a.orderedAt || a.createdAt || 0));
  }, [orders, selected]);

  const patientResults = useMemoOS(() => {
    if (!selected) return [];
    return results
      .filter(r => {
        const s = r.specimenId ? specimenById[r.specimenId] : null;
        return s && s.patientId === selected.id;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 50);
  }, [results, specimenById, selected]);

  return (
    <Page label="Patient Search">
      <PageHeader title="Patient search" sub="Find a patient by MRN or name. Click a result to see demographics, orders, and recent values."/>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        {/* Left: search + results */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="MRN, last name, first name…"
              value={q} onChange={e => setQ(e.target.value)} autoFocus/>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 6 }}>
              {matches.length} of {patients.length} patient{patients.length === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {matches.length === 0 ? (
              <div style={{ padding: 24, fontSize: 12, color: 'var(--ink-400)', textAlign: 'center' }}>
                {patients.length === 0 ? 'No patients yet. Create one via New order.' : 'No matches'}
              </div>
            ) : matches.map(p => (
              <button key={p.id} type="button"
                onClick={() => setSelectedId(p.id)}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
                onMouseLeave={e => e.currentTarget.style.background = selectedId === p.id ? 'var(--sage-50)' : 'transparent'}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 0,
                  background: selectedId === p.id ? 'var(--sage-50)' : 'transparent',
                  borderBottom: '1px solid var(--line-soft)',
                  cursor: 'pointer',
                }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-900)' }}>
                  <span className="mono">{p.mrn || '—'}</span>
                  <span style={{ marginLeft: 8, fontWeight: 500 }}>
                    {[p.lastName, p.firstName].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>
                  {p.dob ? 'DOB ' + p.dob : ''}
                  {p.sex && <span style={{ marginLeft: 8 }}>{p.sex}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selected ? (
            <div className="empty" style={{ flex: 1 }}>
              <div className="empty-icon"><IconUser size={16}/></div>
              <div className="empty-title">No patient selected</div>
              <div className="empty-sub">Pick a patient from the left to load demographics, order history, and result trends.</div>
            </div>
          ) : (
            <PatientDetail
              patient={selected}
              orders={patientOrders}
              results={patientResults}
              testById={testById}
              specimenById={specimenById}
            />
          )}
        </div>
      </div>
    </Page>
  );
};

const PatientDetail = ({ patient, orders, results, testById, specimenById }) => {
  const locations = window.useEntities('locations');
  const locationById = useMemoOS(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* Demographics header */}
      <div style={{ padding: 16, borderBottom: '1px solid var(--line)', background: 'var(--ivory-50)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>
              {[patient.lastName, patient.firstName].filter(Boolean).join(', ') || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4, display: 'flex', gap: 14 }}>
              <span><span style={{ color: 'var(--ink-400)' }}>MRN</span> <span className="mono">{patient.mrn || '—'}</span></span>
              <span><span style={{ color: 'var(--ink-400)' }}>DOB</span> <span className="mono">{patient.dob || '—'}</span></span>
              <span><span style={{ color: 'var(--ink-400)' }}>Sex</span> {patient.sex || '—'}</span>
              {patient.phone && <span><span style={{ color: 'var(--ink-400)' }}>Phone</span> <span className="mono">{patient.phone}</span></span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" data-size="sm" data-variant="primary"
              onClick={() => window.openNewOrder && window.openNewOrder()}>
              <IconPlus size={13}/> New order
            </button>
          </div>
        </div>
      </div>

      {/* Orders */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Orders ({orders.length})</div>
        {orders.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No orders for this patient.</div>
        ) : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Order #</th><th>Tests</th><th>Priority</th><th>Status</th><th>Ordered</th><th>Facility</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 20).map(o => {
                const loc = o.locationId ? locationById[o.locationId] : null;
                return (
                  <tr key={o.id}>
                    <td><span className="mono">{o.orderNumber}</span></td>
                    <td className="mono tnum">{o.testIds.length}</td>
                    <td><PriorityPill p={o.priority}/></td>
                    <td><StatusPill s={o.status}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(o.orderedAt)}</span></td>
                    <td>{loc ? <span><span className="mono" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{loc.code}</span></span> : (o.facility || '—')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent results */}
      <div style={{ padding: '14px 16px' }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Recent results ({results.length})</div>
        {results.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No results for this patient.</div>
        ) : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Test</th><th>Value</th><th>Units</th><th>Ref range</th><th>Flag</th><th>Status</th><th>Resulted</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => {
                const test = r.testId ? testById[r.testId] : null;
                return (
                  <tr key={r.id}>
                    <td>{test ? <><span className="mono">{test.code}</span> <span style={{ marginLeft: 4, color: 'var(--ink-400)' }}>{test.shortName || test.name}</span></> : '—'}</td>
                    <td className="mono tnum" style={{ fontWeight: 500 }}>{r.value != null ? r.value : '—'}</td>
                    <td>{r.units || '—'}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-400)' }}>
                      {r.refRangeLow != null && r.refRangeHigh != null ? (r.refRangeLow + '–' + r.refRangeHigh) : '—'}
                    </td>
                    <td><ResultFlagPill flag={r.flag}/></td>
                    <td><ResultStatusPill status={r.status}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(r.createdAt)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ===== Worklists =====
const WorklistsPage = () => {
  const specimens = window.useEntities('specimens');
  const orders = window.useEntities('orders');
  const patients = window.useEntities('patients');
  const tests = window.useEntities('tests');
  const orderById = useMemoOS(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);
  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);

  // Group specimens by routedTo (analyzers/labs). The "Unrouted" bucket
  // holds anything received but not yet routed.
  const groups = useMemoOS(() => {
    const g = new Map();
    for (const s of specimens) {
      if (s.state === 'rejected' || s.state === 'completed') continue;
      const key = s.routedTo || '__unrouted';
      if (!g.has(key)) g.set(key, []);
      g.get(key).push(s);
    }
    return Array.from(g.entries()).map(([key, items]) => ({
      id: key,
      label: key === '__unrouted' ? 'Unrouted' : key,
      items: items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    })).sort((a, b) => {
      if (a.id === '__unrouted') return -1;
      if (b.id === '__unrouted') return 1;
      return a.label.localeCompare(b.label);
    });
  }, [specimens]);

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
    if (checkedSpecimens.length === 0) return;
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
      reasonDefault: 'cobas-c303',
      entityType: 'specimen',
      entityId: 'batch',
      confirmLabel: 'Route batch',
    });
    if (!ask.confirmed || !ask.reason) return;
    const target = ask.reason;
    const actor = currentActorId();
    for (const s of checkedSpecimens) {
      const fresh = await window.db.get('specimens', s.id);
      if (fresh) await __routeOne(fresh, target, actor);
    }
    setChecked(new Set());
  };

  const bulkReject = async () => {
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
    const actor = currentActorId();
    for (const s of checkedSpecimens) {
      const fresh = await window.db.get('specimens', s.id);
      if (fresh) await __rejectOne(fresh, ask.reason, actor);
    }
    setChecked(new Set());
  };

  const releaseToInstrument = async (specimen) => {
    const ask = await safetyConfirm({
      id: 'worklists.route.single',
      tone: 'info',
      title: 'Route specimen',
      message: 'Send this specimen to an analyzer or lab queue.',
      facts: factsForSpecimen(specimen),
      requireReason: true,
      reasonLabel: 'Route to',
      reasonDefault: specimen.routedTo || 'cobas-c303',
      entityType: 'specimen',
      entityId: specimen.id,
      confirmLabel: 'Route',
      audit: false,
    });
    if (!ask.confirmed || !ask.reason) return;
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
                    <button className="btn" data-variant="primary" data-size="xs" onClick={bulkRoute}>Route…</button>
                    <button className="btn" data-variant="danger" data-size="xs" onClick={bulkReject}>Reject…</button>
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
                    <tbody>
                      {selected.items.map(s => {
                        const o = s.orderId ? orderById[s.orderId] : null;
                        const p = s.patientId ? patientById[s.patientId] : null;
                        const testCodes = o ? o.testIds.map(id => (testById[id] || {}).code).filter(Boolean).join(' ') : '';
                        const isChecked = checked.has(s.id);
                        return (
                          <tr key={s.id} style={{ background: isChecked ? 'var(--sage-50)' : undefined, cursor: 'pointer' }}
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
                                <button className="btn" data-variant="primary" data-size="xs" onClick={() => releaseToInstrument(s)}>Route</button>
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
const InstrumentsPage = ({ onBack }) => {
  const [simEnabled, setSimEnabled] = useStateOS(window.instrumentSim ? window.instrumentSim.isEnabled() : true);
  const [activity, setActivity] = useStateOS(() => (window.instrumentSim ? window.instrumentSim.getRecent(40) : []));

  // Subscribe to simulator activity events; merge into our buffer.
  React.useEffect(() => {
    if (!window.instrumentSim) return;
    setActivity(window.instrumentSim.getRecent(40));
    const unsub = window.instrumentSim.subscribe(() => {
      setActivity(window.instrumentSim.getRecent(40));
    });
    return unsub;
  }, []);

  const toggleSim = () => {
    const next = !simEnabled;
    if (window.instrumentSim) window.instrumentSim.setEnabled(next);
    setSimEnabled(next);
  };

  const counts = useMemoOS(() => {
    const recent = activity.slice(0, 100);
    return {
      scheduled: recent.filter(a => a.kind === 'scheduled').length,
      results:   recent.filter(a => a.kind === 'result').length,
      errors:    recent.filter(a => a.kind === 'error').length,
      flagged:   recent.filter(a => a.kind === 'result' && a.flag).length,
    };
  }, [activity]);

  return (
    <Page label="Instrument Manager">
      <PageHeader title="Instrument Manager" sub="Connected analyzers, QC status, calibration, and message throughput."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []),
          <button key="r" className="btn" data-size="sm" onClick={() => window.instrumentSim && window.instrumentSim.catchUp('manual')}
            title="Re-scan all in-flight specimens for unfilled tests. Use after a page reload, after re-enabling the simulator, or to recover a stuck specimen.">
            Re-scan in-flight
          </button>,
          <button key="t" className="btn" data-size="sm" data-variant={simEnabled ? 'ghost' : 'primary'} onClick={toggleSim}>
            <span className="dot" data-tone={simEnabled ? 'ok' : 'idle'} style={{ marginRight: 6 }}/>
            Simulator: {simEnabled ? 'enabled' : 'disabled'}
          </button>,
          <button key="n" className="btn" data-size="sm"><IconPlus size={13}/> Connect analyzer</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Scheduled (recent)" value={counts.scheduled}/>
        <KpiPanel label="Results emitted"    value={counts.results}/>
        <KpiPanel label="Out-of-range flags" value={counts.flagged} tone={counts.flagged > 0 ? 'amber' : null}/>
        <KpiPanel label="Errors"             value={counts.errors}  tone={counts.errors > 0 ? 'rust' : null}/>
      </div>

      <div className="panel">
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Simulator activity</span>
          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
            until real ASTM/HL7 interfaces land, this stands in for analyzer hardware
          </span>
        </div>
        {activity.length === 0 ? (
          <div className="empty" style={{ padding: '40px 24px' }}>
            <div className="empty-icon"><IconInstrument size={16}/></div>
            <div className="empty-title">{simEnabled ? 'Waiting for routed specimens' : 'Simulator disabled'}</div>
            <div className="empty-sub">
              {simEnabled
                ? 'Route a specimen to an analyzer (via a routing rule, or set specimen.routedTo manually) and the simulator will emit results within a few seconds.'
                : 'Enable the simulator to auto-generate results when specimens are routed.'}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th><th>Kind</th><th>Accession</th><th>Instrument</th>
                  <th>Test</th><th>Value</th><th>Flag</th><th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a, i) => (
                  <tr key={i + ':' + a.ts}>
                    <td><span className="mono" style={{ fontSize: 11 }}>{formatTime(a.ts)}</span></td>
                    <td><SimKindPill kind={a.kind}/></td>
                    <td><span className="mono">{a.accession || '—'}</span></td>
                    <td><span className="mono" style={{ color: 'var(--ink-500)' }}>{a.instrument || '—'}</span></td>
                    <td>
                      {a.test ? <><span className="mono">{a.test}</span>{a.name && <span style={{ color: 'var(--ink-400)', marginLeft: 4 }}>{a.name}</span>}</> : '—'}
                    </td>
                    <td className="mono tnum">{a.value != null ? a.value + (a.units ? ' ' + a.units : '') : '—'}</td>
                    <td>{a.flag ? <ResultFlagPill flag={a.flag}/> : '—'}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                      {a.kind === 'scheduled' ? `${a.tests} test${a.tests === 1 ? '' : 's'}, ETA ${formatTime(a.eta)}` :
                       a.kind === 'skipped' ? a.reason :
                       a.kind === 'error' ? a.error : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
};

const KpiPanel = ({ label, value, tone }) => {
  const color = tone === 'rust'  ? 'var(--err-700)'
              : tone === 'amber' ? 'var(--warn-700)'
              : value === 0      ? 'var(--ink-300)'
              : 'var(--ink-900)';
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="section-title" style={{ fontSize: 10 }}>{label}</div>
      <div className="mono tnum" style={{ fontSize: 22, color, marginTop: 2 }}>{value}</div>
    </div>
  );
};

const SIM_KIND_TONE = { scheduled: 'info', result: 'sage', skipped: 'ghost', error: 'rust' };
const SimKindPill = ({ kind }) => (
  <span className="pill" data-tone={SIM_KIND_TONE[kind] || 'ghost'}>{kind || '—'}</span>
);

// ===== Interfaces =====
const InterfacesPage = ({ onBack }) => {
  const interfaces = window.useEntities('interfaces');
  const counts = useMemoOS(() => ({
    inbound:  interfaces.filter(i => i.direction === 'inbound' || i.direction === 'bidirectional').length,
    outbound: interfaces.filter(i => i.direction === 'outbound' || i.direction === 'bidirectional').length,
    healthy:  interfaces.filter(i => i.status === 'idle' || i.status === 'running').length,
    errors:   interfaces.filter(i => i.status === 'error').length,
    queued:   0,
  }), [interfaces]);

  return (
    <Page label="Interfaces">
      <PageHeader title="Interfaces" sub="HL7 endpoints, MLLP listeners, file drops, and reference lab integrations."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"><IconPlus size={13}/> Add interface</button>,
        ]}/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Inbound" value={counts.inbound}/>
        <KpiPanel label="Outbound" value={counts.outbound}/>
        <KpiPanel label="Healthy" value={counts.healthy}/>
        <KpiPanel label="Errors (24h)" value={counts.errors} tone={counts.errors > 0 ? 'rust' : null}/>
        <KpiPanel label="Queue depth" value={counts.queued}/>
      </div>

      <Hl7IntakePanel/>

      <div style={{ marginTop: 12 }}>
        <MapperIntakePanel/>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        {interfaces.length === 0 ? (
          <EmptyTable
            columns={['Interface','Direction','Protocol','Endpoint','Last message','Status']}
            message="No interfaces configured"
            sub="Real network listeners (MLLP, file drop) are Tier 6. The HL7 Intake above lets you exercise the same parser without networking."/>
        ) : (
          <table className="tbl">
            <thead><tr><th>Interface</th><th>Direction</th><th>Protocol</th><th>Endpoint</th><th>Last message</th><th>Status</th></tr></thead>
            <tbody>
              {interfaces.map(i => (
                <tr key={i.id}>
                  <td>{i.name || '—'}</td>
                  <td><span className="pill" data-tone="ghost">{i.direction || '—'}</span></td>
                  <td><span className="mono">{i.protocol || '—'}</span></td>
                  <td><span className="mono" style={{ color: 'var(--ink-500)' }}>{i.endpoint || '—'}</span></td>
                  <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(i.lastSeenAt)}</span></td>
                  <td><span className="pill" data-tone={i.status === 'error' ? 'rust' : i.status === 'running' ? 'sage' : 'ghost'}>{i.status || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
};

// ── Mapper Intake — partner CSV/JSON via a Lattice Mapper (LML) script.
// Demonstrates that adding a new partner format is just writing a small mapper,
// not a code change. The same downstream events fire (`order.created`).
const MapperIntakePanel = () => {
  const mappers = window.useEntities('mappers', m => m.active !== false);
  const inboundMappers = useMemoOS(() => {
    return mappers.filter(m => {
      const parsed = window.mappers && window.mappers.parse(m.text || '');
      return parsed && parsed.meta && parsed.meta.direction === 'inbound';
    });
  }, [mappers]);
  const clients = window.useEntities('clients');

  const [mapperId, setMapperId] = useStateOS(null);
  const [payload, setPayload] = useStateOS('');
  const [clientId, setClientId] = useStateOS(null);
  const [preview, setPreview] = useStateOS(null);
  const [committing, setCommitting] = useStateOS(false);
  const [result, setResult] = useStateOS(null);

  const mapperRecord = mapperId ? mappers.find(m => m.id === mapperId) : (inboundMappers[0] || null);
  const parsedMapper = useMemoOS(() => mapperRecord ? window.mappers.parse(mapperRecord.text) : null, [mapperRecord]);
  const meta = parsedMapper && parsedMapper.meta;

  const samplePayload = useMemoOS(() => {
    if (!meta) return '';
    if (meta.format === 'csv') {
      return 'MRN,LastName,FirstName,DOB,Sex,OrderID,Priority,TestCodes,Provider,Site,OrderDate,CollectedDate,ReceivedDate\n' +
             'MRN-1001,Doe,Jane,04/12/1985,F,EMR-9001,R,GLU;NA,Dr Smith,Outreach Clinic A,2026-05-08,2026-05-08,2026-05-08\n' +
             'MRN-1002,Smith,John,07/03/1972,M,EMR-9002,S,CMP;TSH,Dr Patel,Outreach Clinic A,2026-05-08,2026-05-08,2026-05-08';
    }
    if (meta.format === 'json') {
      return JSON.stringify([
        { patient: { mrn: 'MRN-2001', lastName: 'Doe', firstName: 'Jane', dob: '1985-04-12', sex: 'F' },
          order: { orderNumber: 'JSON-9001', placerOrderNumber: 'JSON-9001', priority: 'routine', testIds: ['GLU', 'NA'], providerId: 'Dr Smith', orderedAt: '2026-05-08' } },
      ], null, 2);
    }
    return '';
  }, [meta]);

  const fillSample = () => { setPayload(samplePayload); setPreview(null); setResult(null); };
  const reset = () => { setPayload(''); setPreview(null); setResult(null); };

  const runPreview = () => {
    if (!parsedMapper || !window.mappers) return;
    if (parsedMapper.errors && parsedMapper.errors.length > 0) {
      setPreview({ error: 'Mapper has parse errors: ' + parsedMapper.errors.join('; ') });
      return;
    }
    try {
      const result = meta.format === 'json'
        ? window.mappers.applyInboundJson(parsedMapper, payload)
        : window.mappers.applyInboundCsv(parsedMapper, payload);
      const check = validateMapperPreview(payload, result.rows || []);
      if (!check.ok) {
        setPreview({ error: 'Intake blocked: ' + check.errors.slice(0, 4).join('; ') });
        return;
      }
      setPreview(result);
      setResult(null);
    } catch (e) {
      setPreview({ error: e.message });
    }
  };

  const ingest = async () => {
    if (!preview || !preview.rows) return;
    const check = validateMapperPreview(payload, preview.rows);
    if (!check.ok) {
      await safetyNotice({ tone: 'danger', title: 'Mapper ingest blocked', message: check.errors.slice(0, 4).join('; ') });
      return;
    }
    const first = preview.rows[0] || {};
    const ask = await safetyConfirm({
      id: 'interface.mapper.ingest',
      tone: 'warning',
      title: 'Ingest mapped orders',
      message: 'This creates or updates patient, test, and order records from pasted interface data.',
      facts: [
        safetyFact('mapper', mapperRecord ? mapperRecord.name : '-'),
        safetyFact('rows', preview.rows.length),
        safetyFact('bytes', check.bytes),
        safetyFact('client', clientId || 'none'),
        safetyFact('first mrn', first.patient && first.patient.mrn),
        safetyFact('first order', first.order && (first.order.orderNumber || first.order.placerOrderNumber || first.order.fillerOrderNumber)),
      ],
      requireReason: true,
      reasonLabel: 'Ingest reason',
      reasonPlaceholder: 'source file / interface batch / operator note',
      entityType: 'interface',
      entityId: mapperRecord ? mapperRecord.id : 'mapper-intake',
      confirmLabel: 'Ingest rows',
    });
    if (!ask.confirmed) return;
    const freshCheck = validateMapperPreview(payload, preview.rows);
    if (!freshCheck.ok) {
      await safetyNotice({ tone: 'danger', title: 'Mapper ingest blocked', message: freshCheck.errors.slice(0, 4).join('; ') });
      return;
    }
    setCommitting(true);
    const out = { created: 0, errors: [] };
    try {
      for (const row of preview.rows) {
        const ing = await window.mappers.ingestInboundResult(row, { clientId, mapperName: mapperRecord && mapperRecord.name });
        if (ing.ok) out.created++; else out.errors.push(...ing.errors);
      }
      setResult(out);
    } catch (e) {
      setResult({ created: out.created, errors: [...out.errors, e.message] });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      <div style={{ padding: 14, borderRight: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Generic intake · via Mapper script</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={fillSample} disabled={!meta}>Sample data</button>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={reset}>Clear</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="field-label">Mapper</span>
          <select className="input" value={mapperId || (mapperRecord && mapperRecord.id) || ''}
            onChange={e => { setMapperId(e.target.value); setPayload(''); setPreview(null); setResult(null); }}
            style={{ height: 28, flex: 1 }}>
            {inboundMappers.length === 0 ? (
              <option value="">— no inbound mappers —</option>
            ) : inboundMappers.map(m => (
              <option key={m.id} value={m.id}>{m.name} · {(window.mappers.parse(m.text).meta || {}).format}</option>
            ))}
          </select>
          <button className="btn" data-variant="ghost" data-size="xs"
            onClick={() => window.__navTo && window.__navTo('mappers')}>
            Edit mappers
          </button>
        </div>

        <textarea
          value={payload}
          onChange={e => { setPayload(e.target.value); setPreview(null); setResult(null); }}
          placeholder={meta && meta.format === 'csv'
            ? 'Paste CSV (with header row by default)…'
            : meta && meta.format === 'json'
            ? 'Paste JSON object or array…'
            : 'Pick a mapper above first.'}
          style={{
            width: '100%', minHeight: 160, padding: 8, fontSize: 11.5,
            fontFamily: 'var(--font-mono)', color: 'var(--ink-900)',
            border: '1px solid var(--line)', borderRadius: 4,
            background: 'var(--ivory-50)', resize: 'vertical', outline: 'none',
          }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span className="field-label">Attach to client</span>
          <select className="input" value={clientId || ''} onChange={e => setClientId(e.target.value || null)}
            style={{ height: 28, flex: 1, maxWidth: 260 }}>
            <option value="">— No client —</option>
            {clients.filter(c => c.active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" onClick={runPreview} disabled={!payload || !mapperRecord}>Preview</button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={ingest}
            disabled={!preview || !preview.rows || preview.rows.length === 0 || committing}>
            {committing ? 'Ingesting…' : `Ingest ${preview && preview.rows ? preview.rows.length : 0} row(s)`}
          </button>
        </div>
      </div>

      <div style={{ padding: 14, maxHeight: 320, overflowY: 'auto' }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Mapped preview</div>
        {!preview ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
            Pick a mapper, paste data, click <strong>Preview</strong>. Each row maps to a Patient + Order + Tests via the script.
          </div>
        ) : preview.error ? (
          <div style={{ padding: 8, background: 'var(--rust-soft)', color: 'var(--err-700)', borderRadius: 4, fontSize: 12 }}>
            {preview.error}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 6 }}>
              {preview.rows.length} row(s) parsed
            </div>
            {preview.rows.slice(0, 5).map((row, i) => (
              <div key={i} style={{
                marginBottom: 8, padding: 8,
                background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 4,
                fontSize: 11.5,
              }}>
                {row.__errors && row.__errors.length > 0 && (
                  <div style={{ color: 'var(--err-700)', marginBottom: 4 }}>
                    {row.__errors.join(' · ')}
                  </div>
                )}
                {row.patient && (
                  <div><span style={{ color: 'var(--ink-400)' }}>patient</span>{' '}
                    <span className="mono">{row.patient.mrn || '—'}</span>{' '}
                    {row.patient.lastName}{row.patient.firstName ? ', ' + row.patient.firstName : ''}
                    {row.patient.dob && <span style={{ color: 'var(--ink-400)' }}> · {row.patient.dob}</span>}
                  </div>
                )}
                {row.order && (
                  <div><span style={{ color: 'var(--ink-400)' }}>order</span>{' '}
                    <span className="mono">{row.order.orderNumber || '—'}</span>{' '}
                    <span style={{ color: 'var(--ink-400)' }}>·</span> <PriorityPill p={row.order.priority || 'routine'}/>
                    <span style={{ color: 'var(--ink-400)', marginLeft: 6 }}>·</span> <span className="mono" style={{ marginLeft: 6 }}>{Array.isArray(row.order.testIds) ? row.order.testIds.join(' ') : (row.order.testIds || '—')}</span>
                  </div>
                )}
              </div>
            ))}
            {preview.rows.length > 5 && (
              <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>+ {preview.rows.length - 5} more</div>
            )}
            {result && (
              <div style={{
                marginTop: 8, padding: 8, fontSize: 12,
                background: result.errors.length === 0 ? 'var(--sage-50)' : 'var(--amber-soft)',
                color: result.errors.length === 0 ? 'var(--sage-900)' : 'var(--warn-700)',
                borderRadius: 4,
              }}>
                Created {result.created} order(s){result.errors.length > 0 && ` · ${result.errors.length} error(s): ${result.errors.slice(0,3).join('; ')}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── HL7 Intake — paste an ORM-O01 message, parse, ingest into the pipeline.
// Same downstream behavior as a drawer-created order (publishes order.created).
const Hl7IntakePanel = () => {
  const clients = window.useEntities('clients');
  const [text, setText] = useStateOS('');
  const [clientId, setClientId] = useStateOS(null);
  const [parsed, setParsed] = useStateOS(null);
  const [committing, setCommitting] = useStateOS(false);
  const [result, setResult] = useStateOS(null);

  const fillExample = () => {
    setText(window.hl7 && window.hl7.SAMPLE_ORM ? window.hl7.SAMPLE_ORM : '');
    setParsed(null);
    setResult(null);
  };
  const reset = () => {
    setText(''); setParsed(null); setResult(null); setClientId(null);
  };

  const parse = () => {
    if (!window.hl7) return;
    const out = window.hl7.parseORM(text);
    const check = validateHl7Intake(text, out);
    if (!check.ok) {
      out.errors = [...(out.errors || []), ...check.errors];
    }
    setParsed(out);
  };

  const ingest = async () => {
    if (!parsed || !parsed.patient || !parsed.order || parsed.tests.length === 0) return;
    const check = validateHl7Intake(text, parsed);
    if (!check.ok) {
      await safetyNotice({ tone: 'danger', title: 'HL7 ingest blocked', message: check.errors.slice(0, 4).join('; ') });
      return;
    }
    const ask = await safetyConfirm({
      id: 'interface.hl7_orm.ingest',
      tone: 'warning',
      title: 'Ingest HL7 order',
      message: 'This creates or updates patient, test, and order records from a pasted ORM message.',
      facts: [
        safetyFact('mrn', parsed.patient && parsed.patient.mrn),
        safetyFact('patient', [parsed.patient && parsed.patient.lastName, parsed.patient && parsed.patient.firstName].filter(Boolean).join(', ')),
        safetyFact('placer order', parsed.order && parsed.order.placerOrderNumber),
        safetyFact('filler order', parsed.order && parsed.order.fillerOrderNumber),
        safetyFact('tests', parsed.tests.map(t => t.code).join(', ')),
        safetyFact('bytes', check.bytes),
        safetyFact('client', clientId || 'none'),
      ],
      requireReason: true,
      reasonLabel: 'Ingest reason',
      reasonPlaceholder: 'source message / interface batch / operator note',
      entityType: 'interface',
      entityId: 'hl7-orm-intake',
      confirmLabel: 'Ingest order',
    });
    if (!ask.confirmed) return;
    const freshCheck = validateHl7Intake(text, parsed);
    if (!freshCheck.ok) {
      await safetyNotice({ tone: 'danger', title: 'HL7 ingest blocked', message: freshCheck.errors.slice(0, 4).join('; ') });
      return;
    }
    setCommitting(true);
    try {
      // 1. Resolve patient by MRN (or create)
      let patient = (await window.db.list('patients', p => p.mrn === parsed.patient.mrn))[0];
      if (!patient) {
        patient = window.schema.newPatient(parsed.patient);
        await window.db.put('patients', patient);
      }
      // 2. Resolve test catalogue entries by code (create stubs for missing)
      const testIds = [];
      for (const t of parsed.tests) {
        let test = (await window.db.list('tests', x => x.code === t.code))[0];
        if (!test) {
          test = window.schema.newTest({ code: t.code, name: t.name || t.code });
          await window.db.put('tests', test);
        }
        testIds.push(test.id);
      }
      // 3. Order — pull placer/filler if present, attach to selected client
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const allOrders = await window.db.list('orders');
      const todayCount = allOrders.filter(o => (o.orderedAt || o.createdAt || 0) >= todayStart.getTime()).length;
      const order = window.schema.newOrder({
        orderNumber: parsed.order.fillerOrderNumber || ('L' + new Date().toISOString().slice(0,10).replace(/-/g,'') + String(todayCount + 1).padStart(4, '0')),
        placerOrderNumber: parsed.order.placerOrderNumber || '',
        fillerOrderNumber: parsed.order.fillerOrderNumber || '',
        patientId: patient.id,
        clientId: clientId || null,
        priority: parsed.order.priority || 'routine',
        status: 'open',
        testIds,
        notes: parsed.order.placerOrderNumber ? `Placer order #: ${parsed.order.placerOrderNumber}` : '',
        providerId: parsed.order.orderingProvider || null,
        orderedAt: parsed.order.orderedAt || Date.now(),
        collectedAt: parsed.order.collectedAt || null,
        receivedAt: parsed.order.receivedAt || null,
      });
      await window.db.put('orders', order);
      window.events.publish(window.EVENTS.ORDER_CREATED, {
        entityType: 'order', entityId: order.id, order, patient,
        viaInterface: 'hl7-orm-intake',
      });
      setResult({ ok: true, orderId: order.id, orderNumber: order.orderNumber, patientMrn: patient.mrn, testCount: testIds.length });
    } catch (e) {
      console.error('[hl7-intake] ingest failed', e);
      setResult({ ok: false, error: e.message || String(e) });
    } finally {
      setCommitting(false);
    }
  };

  const canParse = text.trim().length > 0;
  const canIngest = parsed && parsed.patient && parsed.order && parsed.tests.length > 0 && (!parsed.errors || parsed.errors.length === 0);

  return (
    <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      <div style={{ padding: 14, borderRight: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>HL7 inbound · paste an ORM-O01</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={fillExample}>Sample</button>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={reset}>Clear</button>
        </div>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setParsed(null); setResult(null); }}
          placeholder={`MSH|^~\\&|EMR|CLINIC|LATTICE|MAIN|${(new Date()).getFullYear()}...|||ORM^O01|...|P|2.5\nPID|1||MRN-789012^^^MRN||Doe^Jane^A||19850412|F\nORC|NW|EMR-ORD-789|...\nOBR|1|EMR-ORD-789||GLU^Glucose^L|R|...`}
          style={{
            width: '100%', minHeight: 180,
            padding: 8, fontSize: 11.5,
            fontFamily: 'var(--font-mono)', color: 'var(--ink-900)',
            border: '1px solid var(--line)', borderRadius: 4,
            background: 'var(--ivory-50)', resize: 'vertical', outline: 'none',
          }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span className="field-label">Attach to client</span>
          <select className="input" value={clientId || ''} onChange={e => setClientId(e.target.value || null)}
            style={{ height: 28, flex: 1, maxWidth: 280 }}>
            <option value="">— No client —</option>
            {clients.filter(c => c.active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" onClick={parse} disabled={!canParse}>Parse</button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={ingest} disabled={!canIngest || committing}>
            {committing ? 'Ingesting…' : 'Ingest order'}
          </button>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Parser preview</div>
        {!parsed ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
            Paste an HL7 ORM-O01 message and click Parse. The parsed entities preview here; click Ingest order to create them in the system.
          </div>
        ) : (
          <div style={{ fontSize: 12 }}>
            {parsed.errors.length > 0 && (
              <div style={{ padding: 8, background: 'var(--rust-soft)', color: 'var(--err-700)', borderRadius: 4, marginBottom: 8, fontSize: 11.5 }}>
                {parsed.errors.join(' · ')}
              </div>
            )}
            <div style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Patient</div>
              {parsed.patient ? (
                <div>
                  <span className="mono">{parsed.patient.mrn}</span>{' '}
                  {parsed.patient.lastName}{parsed.patient.firstName ? ', ' + parsed.patient.firstName : ''}
                  {parsed.patient.dob && <span style={{ marginLeft: 8, color: 'var(--ink-400)' }}>DOB {parsed.patient.dob}</span>}
                  {parsed.patient.sex && <span style={{ marginLeft: 8, color: 'var(--ink-400)' }}>{parsed.patient.sex}</span>}
                </div>
              ) : <span style={{ color: 'var(--ink-400)' }}>—</span>}
            </div>
            <div style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Order</div>
              {parsed.order ? (
                <div>
                  <span style={{ color: 'var(--ink-400)' }}>placer</span> <span className="mono">{parsed.order.placerOrderNumber || '—'}</span>
                  <span style={{ marginLeft: 12, color: 'var(--ink-400)' }}>filler</span> <span className="mono">{parsed.order.fillerOrderNumber || '—'}</span>
                  <span style={{ marginLeft: 12 }}><PriorityPill p={parsed.order.priority}/></span>
                  {parsed.order.orderingProvider && <span style={{ marginLeft: 12, color: 'var(--ink-500)' }}>{parsed.order.orderingProvider}</span>}
                </div>
              ) : <span style={{ color: 'var(--ink-400)' }}>—</span>}
            </div>
            <div>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Tests ({parsed.tests.length})</div>
              {parsed.tests.length === 0 ? <span style={{ color: 'var(--ink-400)' }}>—</span> : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {parsed.tests.map((t, i) => (
                    <span key={i} className="pill" data-tone="ghost" style={{ height: 22, padding: '0 8px' }}>
                      <span className="mono">{t.code}</span>
                      {t.name && <span style={{ marginLeft: 6 }}>{t.name}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {result && (
              <div style={{
                padding: 10, marginTop: 10, fontSize: 12,
                background: result.ok ? 'var(--sage-50)' : 'var(--rust-soft)',
                color: result.ok ? 'var(--sage-900)' : 'var(--err-700)',
                borderRadius: 4,
              }}>
                {result.ok ? (
                  <>Created order <span className="mono">{result.orderNumber}</span> for MRN <span className="mono">{result.patientMrn}</span> with {result.testCount} test{result.testCount === 1 ? '' : 's'}.</>
                ) : (
                  <>Failed: {result.error}</>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ===== Reports = Activity Log =====
// Repurposed: full audit-event timeline with filters. The "reports" sense
// (operational/regulatory) lands later — for now this is the most useful
// thing we can show given the audit data we collect.
const ReportsPage = () => {
  const events = window.useEntities('audit_events');
  const [q, setQ] = useStateOS('');
  const [filter, setFilter] = useStateOS('all');
  const [eventType, setEventType] = useStateOS('');     // exact event type, '' = any
  const [actor, setActor] = useStateOS('');             // exact actor, '' = any
  const [entityType, setEntityType] = useStateOS('');   // exact entity type, '' = any
  const [timeWindow, setTimeWindow] = useStateOS('all'); // '1h'|'6h'|'24h'|'7d'|'all'

  // Build dropdown options from the live data.
  const distinctEventTypes = useMemoOS(() => {
    return [...new Set(events.map(e => e.type).filter(Boolean))].sort();
  }, [events]);
  const distinctActors = useMemoOS(() => {
    return [...new Set(events.map(e => e.actor).filter(Boolean))].sort();
  }, [events]);
  const distinctEntityTypes = useMemoOS(() => {
    return [...new Set(events.map(e => e.entityType).filter(Boolean))].sort();
  }, [events]);

  const windowMs = useMemoOS(() => {
    if (timeWindow === '1h')  return 60 * 60 * 1000;
    if (timeWindow === '6h')  return 6 * 60 * 60 * 1000;
    if (timeWindow === '24h') return 24 * 60 * 60 * 1000;
    if (timeWindow === '7d')  return 7 * 24 * 60 * 60 * 1000;
    return null;
  }, [timeWindow]);

  const filtered = useMemoOS(() => {
    const cutoff = windowMs ? (Date.now() - windowMs) : 0;
    return [...events]
      .filter(e => {
        if (filter === 'all') return true;
        if (filter === 'rules')   return e.type === 'rule.fired' || e.type === 'rule.audit';
        if (filter === 'orders')  return e.type && e.type.startsWith('order.');
        if (filter === 'specs')   return e.type && e.type.startsWith('specimen.');
        if (filter === 'results') return e.type && e.type.startsWith('result.');
        if (filter === 'critical') return e.type === 'result.critical' || e.type === 'result.critical.escalated';
        if (filter === 'qc')      return e.type && e.type.startsWith('qc.');
        if (filter === 'lifecycle') return e.type === 'lifecycle.transition';
        if (filter === 'notif')   return e.type === 'notification';
        return true;
      })
      .filter(e => !eventType || e.type === eventType)
      .filter(e => !actor || e.actor === actor)
      .filter(e => !entityType || e.entityType === entityType)
      .filter(e => !cutoff || (e.ts || 0) >= cutoff)
      .filter(e => {
        if (!q) return true;
        const blob = [e.type, e.actor, JSON.stringify(e.payload || {})].join(' ').toLowerCase();
        return blob.includes(q.toLowerCase());
      })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 500);
  }, [events, q, filter, eventType, actor, entityType, windowMs]);

  const resetFilters = () => {
    setQ(''); setFilter('all'); setEventType(''); setActor(''); setEntityType(''); setTimeWindow('all');
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const csvEsc = (v) => {
      if (v == null) return '';
      let s = String(v);
      if (/^[=+\-@]/.test(s.trimStart())) s = "'" + s;
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [
      ['ts_iso', 'ts_epoch', 'type', 'actor', 'entityType', 'entityId', 'payload'],
      ...filtered.map(e => [
        e.ts ? new Date(e.ts).toISOString() : '',
        e.ts || '',
        e.type || '',
        e.actor || '',
        e.entityType || '',
        e.entityId || '',
        JSON.stringify(e.payload || {}),
      ]),
    ];
    const csv = rows.map(r => r.map(csvEsc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url; a.download = `audit-events-${ts}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const activeFilterCount = (filter !== 'all' ? 1 : 0)
    + (eventType ? 1 : 0) + (actor ? 1 : 0) + (entityType ? 1 : 0)
    + (timeWindow !== 'all' ? 1 : 0) + (q ? 1 : 0);

  return (
    <Page label="Activity Log">
      <PageHeader title="Activity Log" sub="Append-only audit of every lifecycle event and rule firing."
        actions={[
          <button key="x" className="btn" data-size="sm" onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>,
          <button key="d" className="btn" data-size="sm" data-variant="ghost"
            onClick={async () => {
              const ask = await safetyConfirm({
                id: 'admin.audit.clear',
                tone: 'danger',
                title: 'Clear audit log',
                message: 'This erases existing audit events. A fresh safety-confirmed event will be recorded after the clear.',
                facts: [safetyFact('visible events', filtered.length), safetyFact('total events', events.length)],
                requireTypedText: 'CLEAR',
                confirmLabel: 'Clear log',
                audit: false,
              });
              if (!ask.confirmed) return;
              await window.db.clear('audit_events');
              if (window.events) {
                window.events.publish('operator.safety.confirmed', {
                  actor: currentActorId(),
                  actionId: 'admin.audit.clear',
                  entityType: 'audit_events',
                  entityId: 'all',
                  typedText: ask.typedText,
                });
              }
            }}>Clear log</button>,
        ]}/>
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 80px)' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Free-text search type, actor, or payload…" style={{ height: 28, flex: 1, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <SegSelect
              options={[
                {id:'all',label:'All'},
                {id:'orders',label:'Orders'},
                {id:'specs',label:'Specimens'},
                {id:'results',label:'Results'},
                {id:'critical',label:'Critical'},
                {id:'rules',label:'Rules'},
                {id:'qc',label:'QC'},
                {id:'lifecycle',label:'Lifecycle'},
                {id:'notif',label:'Notify'},
              ]}
              value={filter} onChange={setFilter}/>
            <div style={{ flex: 1 }}/>
            {activeFilterCount > 0 && (
              <button className="btn" data-size="xs" data-variant="ghost" onClick={resetFilters}>
                Reset {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </button>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {events.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" value={eventType} onChange={e => setEventType(e.target.value)} style={{ height: 26, fontSize: 11.5, maxWidth: 220 }}>
              <option value="">Any event type ({distinctEventTypes.length})</option>
              {distinctEventTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="input" value={actor} onChange={e => setActor(e.target.value)} style={{ height: 26, fontSize: 11.5, maxWidth: 200 }}>
              <option value="">Any actor ({distinctActors.length})</option>
              {distinctActors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="input" value={entityType} onChange={e => setEntityType(e.target.value)} style={{ height: 26, fontSize: 11.5, maxWidth: 180 }}>
              <option value="">Any entity ({distinctEntityTypes.length})</option>
              {distinctEntityTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="input" value={timeWindow} onChange={e => setTimeWindow(e.target.value)} style={{ height: 26, fontSize: 11.5, maxWidth: 140 }}>
              <option value="all">All time</option>
              <option value="1h">Last 1h</option>
              <option value="6h">Last 6h</option>
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
            </select>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: '40px 24px' }}>
              <div className="empty-sub">{events.length === 0 ? 'No events yet.' : 'No events match the filter.'}</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Time</th>
                  <th style={{ width: 160 }}>Type</th>
                  <th style={{ width: 90 }}>Actor</th>
                  <th>Detail</th>
                  <th style={{ width: 100 }}>Entity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  // The entity column becomes a click-through to the entity drawer
                  // when both entityType and entityId are present and the drawer
                  // supports that kind. Otherwise the raw id is shown un-linked.
                  const drawerKind = ({
                    order: 'order', specimen: 'specimen', patient: 'patient', result: 'result',
                  })[e.entityType];
                  const canOpen = drawerKind && e.entityId;
                  const onRowClick = canOpen
                    ? () => window.openEntity && window.openEntity(drawerKind, e.entityId)
                    : null;
                  return (
                    <tr key={e.id}
                        style={canOpen ? { cursor: 'pointer' } : {}}
                        onClick={onRowClick}
                        title={canOpen ? `Open ${e.entityType} drawer` : undefined}>
                      <td><span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{formatDateTime(e.ts)}</span></td>
                      <td><span className="pill" data-tone={EVENT_TONE[e.type] || 'ghost'}>{EVENT_LABEL[e.type] || e.type}</span></td>
                      <td><span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{e.actor || 'system'}</span></td>
                      <td><span style={{ fontSize: 11.5, color: 'var(--ink-700)' }}>{summarizeEvent(e)}</span></td>
                      <td>
                        {e.entityId ? (
                          <span className="mono" style={{ fontSize: 10.5, color: canOpen ? 'var(--sage-700)' : 'var(--ink-400)', textDecoration: canOpen ? 'underline' : 'none' }}>
                            {String(e.entityId).slice(-8)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--ink-300)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Page>
  );
};

// ===== Test Catalog =====
const TestCatalogPage = ({ onBack }) => {
  const tests = window.useEntities('tests');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...tests]
      .filter(t => !needle || [t.code, t.name, t.shortName, t.loinc].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [tests, q]);

  const startNew = () => {
    setEditingId(null);
    setDraft({ code: '', name: '', shortName: '', loinc: '', units: '', refRangeLow: '', refRangeHigh: '', turnaroundMinutes: '', referenceRanges: [], criticalEscalationT1Sec: '', criticalEscalationT2Sec: '', active: true });
  };
  const startEdit = (t) => {
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
      active: t.active !== false,
    });
  };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
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
    const fresh = await window.db.get('tests', t.id);
    if (!fresh) return;
    await window.db.delete('tests', t.id);
    if (editingId === t.id) cancel();
  };

  const toggleActive = async (t) => {
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
    const fresh = await window.db.get('tests', t.id);
    if (!fresh) return;
    await window.db.put('tests', { ...fresh, active: nextActive });
  };

  return (
    <Page label="Test Catalog">
      <PageHeader title="Test Catalog" sub="Manage test definitions: codes, LOINC, units, default reference ranges."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}><IconPlus size={13}/> New test</button>,
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
                  {filtered.map(t => (
                    <tr key={t.id} style={{ opacity: t.active === false ? 0.5 : 1, background: editingId === t.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(t)} style={{ cursor: 'pointer' }} title={t.active === false ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
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

              <CatalogField label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                  <input type="checkbox" checked={draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })}/>
                  Available for ordering
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

  const startNew = () => {
    setEditingId(null);
    setDraft({ code: '', name: '', type: 'CLINIC', contactName: '', phone: '', fax: '', email: '', deliveryChannel: 'fax', deliveryEndpoint: '', billType: 'CLIENT', active: true });
  };
  const startEdit = (c) => { setEditingId(c.id); setDraft({ ...c }); };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
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
    const fresh = await window.db.get('clients', c.id);
    if (!fresh) return;
    await window.db.delete('clients', c.id);
    if (editingId === c.id) cancel();
  };

  const toggleActive = async (c) => {
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
    const fresh = await window.db.get('clients', c.id);
    if (!fresh) return;
    await window.db.put('clients', { ...fresh, active: nextActive });
  };

  return (
    <Page label="Clients">
      <PageHeader title="Clients" sub="Referring clinics and outreach customers — orders pin a client at intake."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}><IconPlus size={13}/> New client</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 380px' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search code, name, contact…" style={{ height: 28, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {clients.length}</span>
          </div>
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
                  {filtered.map(c => (
                    <tr key={c.id} style={{ opacity: c.active === false ? 0.5 : 1, background: editingId === c.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(c)} style={{ cursor: 'pointer' }} title={c.active === false ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
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
                          <button className="btn" data-size="xs" onClick={() => startEdit(c)}>Edit</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(c)}>Delete</button>
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
              <button className="btn" data-variant="primary" data-size="sm" onClick={save} disabled={!draft.code || !draft.name}>
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

  const startNew = () => {
    setEditingId(null);
    setDraft({ code: '', name: '', type: 'LAB', parentId: '', phone: '', hours: '', departments: [], notes: '', active: true });
  };
  const startEdit = (l) => {
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
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}><IconPlus size={13}/> New location</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 380px' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" placeholder="Search by code, name, type, notes…" style={{ height: 28, maxWidth: 360 }}
              value={q} onChange={e => setQ(e.target.value)}/>
            <div style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {all.length}</span>
          </div>
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
                  {filtered.map(l => (
                    <tr key={l.id} style={{ opacity: l.active === false ? 0.5 : 1, background: editingId === l.id ? 'var(--sage-50)' : undefined }}>
                      <td onClick={() => toggleActive(l)} style={{ cursor: 'pointer' }} title={l.active === false ? 'Inactive — click to activate' : 'Active — click to deactivate'}>
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
                          <button className="btn" data-size="xs" onClick={() => startEdit(l)}>Edit</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(l)}>Delete</button>
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
              <button className="btn" data-variant="primary" data-size="sm" onClick={save} disabled={!draft.code || !draft.name}>
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
const SPECIMEN_TYPE_OPTIONS = ['', 'serum', 'plasma', 'whole_blood', 'urine', 'csf', 'swab', 'tissue', 'other'];
const DEFAULT_ZPL_BODY = '^XA\n^MMT\n^PW406\n^LL203\n^LH0,0\n^FT8,28^A0N,28,28^FD{patient_line}^FS\n^FT8,60^A0N,18,18^FDMRN: {mrn}^FS\n^FT8,84^A0N,16,16^FDDOB {dob} {sex} {age}y^FS\n^FT8,108^A0N,16,16^FD{type}/{container}^FS\n^FT8,132^A0N,16,16^FDTests: {tests}^FS\n^FT8,156^A0N,16,16^FDOrder {order_number}^FS\n^BY2,2,60\n^FT8,196^BCN,60,Y,N,N\n^FD{accession}^FS\n^XZ';

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
const MappersPage = ({ onBack }) => {
  const all = window.useEntities('mappers');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...all]
      .filter(m => !needle || (m.name + ' ' + (m.text || '')).toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [all, q]);

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
    setEditingId(null);
    setDraft({ id: 'mapper_' + Date.now().toString(36), name: 'Untitled Mapper', text: TEMPLATE, active: true, builtin: false });
  };
  const startEdit = (m) => { setEditingId(m.id); setDraft({ ...m }); };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = async () => {
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
    const fresh = await window.db.get('mappers', m.id);
    if (!fresh) return;
    await window.db.delete('mappers', m.id);
    if (editingId === m.id) cancel();
  };

  const toggleActive = async (m) => {
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
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}><IconPlus size={13}/> New mapper</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '320px 1fr' : '1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="Search…" style={{ height: 28 }}
              value={q} onChange={e => setQ(e.target.value)}/>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">No mappers</div>
                <div className="empty-sub">Click "New mapper" to start.</div>
              </div>
            ) : filtered.map(m => {
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
                <button className="btn" data-variant="danger" data-size="xs" onClick={() => remove(draft)}>Delete</button>
              )}
              {editingId && (
                <button className="btn" data-size="xs" onClick={() => toggleActive(draft)}>
                  {draft.active === false ? 'Activate' : 'Deactivate'}
                </button>
              )}
              <button className="btn" data-variant="ghost" data-size="xs" onClick={cancel}>Cancel</button>
              <button className="btn" data-variant="primary" data-size="xs" onClick={save}>Save</button>
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
const LeveyJenningsChart = ({ results }) => {
  const W = 740, H = 240, P_L = 28, P_R = 12, P_T = 14, P_B = 22;
  const innerW = W - P_L - P_R;
  const innerH = H - P_T - P_B;
  const Z_RANGE = 4;            // y axis: -4..+4 SD
  const yToPx = (z) => P_T + innerH * (1 - (z + Z_RANGE) / (2 * Z_RANGE));

  const n = results.length;
  if (n === 0) return null;
  const xToPx = (i) => P_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const bands = [
    { z: 3, color: 'var(--rust-soft)' },
    { z: 2, color: 'var(--amber-soft)' },
    { z: 1, color: 'var(--sage-100)' },
  ];

  const points = results.map((r, i) => ({
    x: xToPx(i),
    y: yToPx(Math.max(-Z_RANGE, Math.min(Z_RANGE, r.zScore || 0))),
    z: r.zScore,
    status: r.status,
    id: r.id,
    ranAt: r.ranAt,
    flagged: Math.abs(r.zScore || 0) > Z_RANGE,
  }));

  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', font: '10px var(--font-mono)' }}>
      {/* Bands (drawn from outermost to innermost so the centre is the lightest tint) */}
      {bands.map(b => (
        <rect key={b.z}
          x={P_L} y={yToPx(b.z)} width={innerW} height={yToPx(-b.z) - yToPx(b.z)}
          fill={b.color} opacity={0.35}/>
      ))}
      {/* Gridlines at ±1/2/3 SD */}
      {[3, 2, 1, 0, -1, -2, -3].map(z => (
        <g key={z}>
          <line x1={P_L} y1={yToPx(z)} x2={W - P_R} y2={yToPx(z)}
            stroke={z === 0 ? 'var(--ink-500)' : 'var(--line)'}
            strokeWidth={z === 0 ? 1.5 : 1}
            strokeDasharray={z === 0 ? '' : (Math.abs(z) === 3 ? '4,3' : '2,3')}/>
          <text x={P_L - 6} y={yToPx(z) + 3} textAnchor="end" fill="var(--ink-400)">
            {z > 0 ? '+' : ''}{z}
          </text>
        </g>
      ))}
      {/* Connecting line */}
      <path d={linePath} fill="none" stroke="var(--ink-300)" strokeWidth={1.2}/>
      {/* Points */}
      {points.map(p => {
        const fill = p.status === 'out_of_control' ? 'var(--rust)'
          : p.status === 'warn' ? 'var(--amber)'
          : p.status === 'in_control' ? 'var(--sage-700)'
          : 'var(--ink-400)';
        return (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={p.flagged ? 5 : 3.5} fill={fill}
              stroke="#fff" strokeWidth={1.2}>
              <title>{`${(p.z != null ? p.z.toFixed(2) : '—')} SD · ${p.status} · ${new Date(p.ranAt).toISOString().slice(0,16).replace('T',' ')}`}</title>
            </circle>
          </g>
        );
      })}
      {/* X-axis labels: first / last */}
      {n > 0 && (
        <>
          <text x={P_L} y={H - 6} textAnchor="start" fill="var(--ink-400)">
            {new Date(points[0].ranAt).toISOString().slice(5,16).replace('T',' ')}
          </text>
          {n > 1 && (
            <text x={W - P_R} y={H - 6} textAnchor="end" fill="var(--ink-400)">
              {new Date(points[n - 1].ranAt).toISOString().slice(5,16).replace('T',' ')}
            </text>
          )}
        </>
      )}
    </svg>
  );
};

// Each rule's purpose, in plain language, so operators can decide what to disable.
// Sources: Westgard JO. Multi-rule QC procedures. CLSI EP23-Ed2.
const WESTGARD_RULE_INFO = {
  '1-2s': { severity: 'warn',   summary: 'One control >2 SD. Warning, not rejection.', advisory: true },
  '1-3s': { severity: 'reject', summary: 'One control >3 SD. Rejection.',                advisory: false },
  '2-2s': { severity: 'reject', summary: 'Two consecutive same-side, both >2 SD.',       advisory: false },
  'R-4s': { severity: 'reject', summary: 'Two consecutive span >4 SD (range rule).',     advisory: false },
  '4-1s': { severity: 'reject', summary: 'Four consecutive same-side, all >1 SD.',       advisory: false },
  '10-x': { severity: 'reject', summary: 'Ten consecutive same-side of mean. No SD.',    advisory: false },
};

// Westgard rule selection — toggle which of the 6 classic rules fire violations
// at this installation. Persists to the singleton `lab_config` row. Defaults
// to all rules enabled (qcDisabledRules = []).
const WestgardRulesPanel = () => {
  const cfg = window.useEntity('lab_config', window.schema.LAB_CONFIG_ID);
  const disabledSet = useMemoOS(
    () => new Set((cfg && Array.isArray(cfg.qcDisabledRules)) ? cfg.qcDisabledRules : []),
    [cfg]
  );
  const ruleIds = window.westgard ? window.westgard.RULES : Object.keys(WESTGARD_RULE_INFO);

  const toggle = async (ruleId) => {
    const currentlyEnabled = !disabledSet.has(ruleId);
    const nextEnabled = !currentlyEnabled;
    const info = WESTGARD_RULE_INFO[ruleId] || { severity: 'reject', summary: '' };
    const ask = await confirmConfigChange({
      id: nextEnabled ? 'qc.westgard_rule.enable' : 'qc.westgard_rule.disable',
      tone: nextEnabled ? 'warning' : 'danger',
      title: nextEnabled ? 'Enable Westgard rule' : 'Disable Westgard rule',
      message: nextEnabled
        ? 'This rule will create future QC violations and may block result release.'
        : 'This stops this Westgard rule from creating future QC violations and lockouts.',
      facts: [
        safetyFact('rule', ruleId),
        safetyFact('severity', info.severity),
        safetyFact('impact', info.summary),
        safetyFact('next state', nextEnabled ? 'enabled' : 'disabled'),
      ],
      entityType: 'lab_config',
      entityId: window.schema.LAB_CONFIG_ID,
      confirmLabel: nextEnabled ? 'Enable rule' : 'Disable rule',
    });
    if (!ask.confirmed) return;
    const next = new Set(disabledSet);
    if (next.has(ruleId)) next.delete(ruleId);
    else next.add(ruleId);
    const fresh = await window.db.get('lab_config', window.schema.LAB_CONFIG_ID);
    const merged = window.schema.newLabConfig({
      ...(fresh || cfg || {}),
      qcDisabledRules: Array.from(next),
    });
    await window.db.put('lab_config', merged);
  };

  const enabledCount = ruleIds.length - disabledSet.size;

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span className="section-title" style={{ fontSize: 9.5 }}>Westgard rules — installation</span>
        <span style={{ flex: 1 }}/>
        <span className="pill" data-tone={enabledCount === ruleIds.length ? 'sage' : 'amber'} style={{ fontSize: 10 }}>
          {enabledCount} of {ruleIds.length} enabled
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {ruleIds.map(id => {
          const info = WESTGARD_RULE_INFO[id] || { severity: 'reject', summary: '', advisory: false };
          const enabled = !disabledSet.has(id);
          return (
            <label key={id} title={info.summary}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: '6px 8px',
                background: enabled ? '#fff' : 'var(--ivory-100)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                cursor: 'pointer',
                opacity: enabled ? 1 : 0.7,
              }}>
              <input type="checkbox" checked={enabled} onChange={() => toggle(id)} style={{ marginTop: 2 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{id}</span>
                  <span className="pill" data-tone={info.severity === 'reject' ? 'rust' : 'amber'} style={{ fontSize: 9.5 }}>
                    {info.severity}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 2 }}>{info.summary}</div>
              </div>
            </label>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-400)' }}>
        Disabled rules don't fire violations on new QC results. Existing violations are preserved — clear them via the Acknowledge button on the level's violations table. Some labs disable 1-2s as advisory-only.
      </div>
    </div>
  );
};

const QcPage = ({ onBack }) => {
  const tests = window.useEntities('tests');
  const instruments = window.useEntities('instruments');
  const levels = window.useEntities('qc_levels');
  const allResults = window.useEntities('qc_results');
  const allViolations = window.useEntities('qc_violations');

  const [activeLevelId, setActiveLevelId] = useStateOS(null);
  const [levelDraft, setLevelDraft] = useStateOS(null); // editing/new
  const [entryValue, setEntryValue] = useStateOS('');
  const [entryInstrumentId, setEntryInstrumentId] = useStateOS('');
  const [chartInstrumentId, setChartInstrumentId] = useStateOS('__all');

  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  const instrumentById = useMemoOS(() => Object.fromEntries(instruments.map(i => [i.id, i])), [instruments]);
  const activeLevel = activeLevelId ? levels.find(l => l.id === activeLevelId) : null;

  const levelResults = useMemoOS(() => {
    if (!activeLevel) return [];
    return allResults
      .filter(r => r.qcLevelId === activeLevel.id)
      .filter(r => chartInstrumentId === '__all'
        || (chartInstrumentId === '__none' ? !r.instrumentId : r.instrumentId === chartInstrumentId))
      .sort((a, b) => (b.ranAt || 0) - (a.ranAt || 0))
      .slice(0, 30);
  }, [allResults, activeLevel, chartInstrumentId]);

  const levelViolations = useMemoOS(() => {
    if (!activeLevel) return [];
    return allViolations
      .filter(v => v.qcLevelId === activeLevel.id)
      .filter(v => chartInstrumentId === '__all'
        || (chartInstrumentId === '__none' ? !v.instrumentId : v.instrumentId === chartInstrumentId))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 20);
  }, [allViolations, activeLevel, chartInstrumentId]);

  const instrumentOptions = useMemoOS(() => {
    const ids = new Set();
    if (activeLevel && activeLevel.instrumentId) ids.add(activeLevel.instrumentId);
    allResults.filter(r => activeLevel && r.qcLevelId === activeLevel.id && r.instrumentId).forEach(r => ids.add(r.instrumentId));
    allViolations.filter(v => activeLevel && v.qcLevelId === activeLevel.id && v.instrumentId).forEach(v => ids.add(v.instrumentId));
    return [...ids].sort();
  }, [activeLevel, allResults, allViolations]);

  useEffectOS(() => { setChartInstrumentId('__all'); }, [activeLevelId]);

  const startNewLevel = () => {
    setLevelDraft({ testId: '', level: 'L1', material: '', lotNumber: '', lotExpiresAt: '', mean: '', sd: '', units: '', active: true });
  };
  const startEditLevel = (l) => {
    setLevelDraft({ id: l.id, testId: l.testId || '', level: l.level || 'L1', material: l.material || '',
      lotNumber: l.lotNumber || '',
      lotExpiresAt: l.lotExpiresAt ? new Date(l.lotExpiresAt).toISOString().slice(0, 10) : '',
      mean: l.mean == null ? '' : l.mean, sd: l.sd == null ? '' : l.sd,
      units: l.units || '', active: l.active !== false });
  };
  const cancelLevel = () => setLevelDraft(null);
  const saveLevel = async () => {
    if (!levelDraft || !levelDraft.testId || levelDraft.mean === '' || levelDraft.sd === '') return;
    // Convert YYYY-MM-DD date to epoch ms (end of day local) — matches what schema expects.
    const lotExpiresAt = levelDraft.lotExpiresAt
      ? (new Date(levelDraft.lotExpiresAt + 'T23:59:59').getTime() || null)
      : null;
    const init = { ...levelDraft, mean: Number(levelDraft.mean), sd: Number(levelDraft.sd), lotExpiresAt };
    if (levelDraft.id) {
      const existing = levels.find(l => l.id === levelDraft.id);
      if (existing) await window.db.put('qc_levels', { ...existing, ...init });
    } else {
      const l = window.schema.newQcLevel(init);
      await window.db.put('qc_levels', l);
      setActiveLevelId(l.id);
    }
    cancelLevel();
  };
  const removeLevel = async (l) => {
    const test = testById[l.testId];
    const ask = await safetyConfirm({
      id: 'admin.qc_level.delete',
      tone: 'danger',
      title: 'Delete QC level',
      message: 'This removes the QC level definition. Historical QC results and violations remain in the database.',
      facts: [
        safetyFact('qc level id', l.id),
        safetyFact('test', test ? ((test.code || '') + ' ' + (test.name || '')).trim() : l.testId),
        safetyFact('level', l.level),
        safetyFact('material', l.material),
        safetyFact('lot', l.lotNumber),
      ],
      entityType: 'qc_level',
      entityId: l.id,
      confirmLabel: 'Delete QC level',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('qc_levels', l.id);
    if (!fresh) return;
    await window.db.delete('qc_levels', l.id);
    if (activeLevelId === l.id) setActiveLevelId(null);
  };


  const recordResult = async () => {
    if (!activeLevel || entryValue === '') return;
    const value = Number(entryValue);
    if (Number.isNaN(value)) {
      await safetyNotice({ tone: 'warning', title: 'QC value blocked', message: 'Enter a numeric value.' });
      return;
    }
    const z = window.westgard.zScore(value, activeLevel);
    const r = window.schema.newQcResult({
      qcLevelId: activeLevel.id, testId: activeLevel.testId,
      value, zScore: z,
      instrumentId: entryInstrumentId || activeLevel.instrumentId || null,
      status: 'pending', enteredManually: true,
      enteredBy: window.currentUser ? window.currentUser.id : 'unknown',
      ranAt: Date.now(),
    });
    await window.db.put('qc_results', r);
    setEntryValue('');
  };

  const ackViolation = async (v) => {
    const level = levels.find(l => l.id === v.qcLevelId) || activeLevel;
    const test = v.testId ? testById[v.testId] : (level && testById[level.testId]);
    const ask = await safetyConfirm({
      id: 'qc.violation.resolve',
      tone: 'danger',
      title: 'Acknowledge QC violation',
      message: 'This resolves the violation and may remove a QC release lockout for the affected test.',
      facts: [
        safetyFact('violation id', v.id),
        safetyFact('test', test ? ((test.code || '') + ' ' + (test.name || '')).trim() : v.testId),
        safetyFact('level', level ? level.level : v.qcLevelId),
        safetyFact('rule', v.rule),
        safetyFact('severity', v.severity),
        safetyFact('lockout impact', v.severity === 'reject' ? 'release blocked until resolved or passing QC rerun' : 'advisory only'),
      ],
      requireReason: true,
      reasonLabel: 'Resolution reason',
      reasonPlaceholder: 'why this can be resolved',
      entityType: 'qc_violation',
      entityId: v.id,
      confirmLabel: 'Resolve violation',
    });
    if (!ask.confirmed) return;
    await window.qcGate.acknowledgeViolation(v.id, { actor: currentActorId(), reason: ask.reason });
  };

  // Lot expiry status — used to render a per-row pill.
  // Returns null when the level has no lotExpiresAt set.
  const lotStatus = (level) => {
    if (!level || !level.lotExpiresAt) return null;
    const days = Math.ceil((level.lotExpiresAt - Date.now()) / (24 * 60 * 60 * 1000));
    if (days < 0)  return { label: 'Lot EXPIRED ' + (-days) + 'd ago', tone: 'rust',  days };
    if (days === 0) return { label: 'Lot expires today',                tone: 'rust',  days };
    if (days <= 14) return { label: 'Expires in ' + days + 'd',         tone: 'amber', days };
    return null;
  };

  return (
    <Page label="QC">
      <PageHeader title="QC (Westgard)" sub="Define control levels, record runs, monitor rule violations. Out-of-control levels block result release on those tests."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNewLevel}><IconPlus size={13}/> New QC level</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        {/* Levels list */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-500)' }}>
            {levels.length} level{levels.length === 1 ? '' : 's'} defined
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {levels.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">No QC levels yet</div>
                <div className="empty-sub">Click "New QC level" to define a control material.</div>
              </div>
            ) : levels.map(l => {
              const t = testById[l.testId];
              const isSel = activeLevelId === l.id;
              const recent = allResults.filter(r => r.qcLevelId === l.id).sort((a,b)=>(b.ranAt||0)-(a.ranAt||0))[0];
              const tone = recent ? (recent.status === 'out_of_control' ? 'err' : recent.status === 'warn' ? 'warn' : 'ok') : 'idle';
              const lot = lotStatus(l);
              return (
                <button key={l.id} type="button" onClick={() => setActiveLevelId(l.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 12px', border: 0,
                    background: isSel ? 'var(--sage-50)' : 'transparent',
                    borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
                    opacity: l.active === false ? 0.5 : 1,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="dot" data-tone={tone}/>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{(t ? t.code : '?')} · {l.level}</span>
                    <span style={{ flex: 1 }}/>
                    <span className="mono tnum" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{l.mean}±{l.sd}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 2, paddingLeft: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{l.material || '—'}{l.lotNumber ? ' · lot ' + l.lotNumber : ''}</span>
                    {lot && <span className="pill" data-tone={lot.tone} style={{ fontSize: 9.5 }}>{lot.label}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <WestgardRulesPanel/>
          {levelDraft && (
            <div className="panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 10 }}>{levelDraft.id ? 'Edit QC level' : 'New QC level'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Test" required>
                  <select className="input" value={levelDraft.testId} onChange={e => setLevelDraft({ ...levelDraft, testId: e.target.value })}>
                    <option value="">—</option>
                    {tests.filter(t => t.active !== false).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                  </select>
                </CatalogField>
                <CatalogField label="Level">
                  <input className="input mono" value={levelDraft.level} onChange={e => setLevelDraft({ ...levelDraft, level: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Material">
                  <input className="input" value={levelDraft.material} onChange={e => setLevelDraft({ ...levelDraft, material: e.target.value })} placeholder="BioRad Lyphochek 1 …"/>
                </CatalogField>
                <CatalogField label="Lot number">
                  <input className="input mono" value={levelDraft.lotNumber} onChange={e => setLevelDraft({ ...levelDraft, lotNumber: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Lot expires">
                  <input className="input mono" type="date" value={levelDraft.lotExpiresAt} onChange={e => setLevelDraft({ ...levelDraft, lotExpiresAt: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Mean" required>
                  <input className="input mono tnum" value={levelDraft.mean} onChange={e => setLevelDraft({ ...levelDraft, mean: e.target.value })}/>
                </CatalogField>
                <CatalogField label="SD" required>
                  <input className="input mono tnum" value={levelDraft.sd} onChange={e => setLevelDraft({ ...levelDraft, sd: e.target.value })}/>
                </CatalogField>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button className="btn" data-size="sm" onClick={cancelLevel}>Cancel</button>
                <button className="btn" data-variant="primary" data-size="sm" onClick={saveLevel}>{levelDraft.id ? 'Save' : 'Create'}</button>
              </div>
            </div>
          )}

          {activeLevel ? (
            <>
              {/* Header with delete */}
              <div className="panel" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{(testById[activeLevel.testId] || {}).code || '?'} · {activeLevel.level}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                    Mean <span className="mono tnum">{activeLevel.mean}</span> · SD <span className="mono tnum">{activeLevel.sd}</span> · units {activeLevel.units || (testById[activeLevel.testId] || {}).units || '—'}
                  </div>
                </div>
                <button className="btn" data-size="xs" onClick={() => startEditLevel(activeLevel)}>Edit</button>
                <button className="btn" data-variant="danger" data-size="xs" onClick={() => removeLevel(activeLevel)}>Delete</button>
              </div>

              <div className="panel" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="field-label">Trend instrument</span>
                <select className="input" value={chartInstrumentId}
                  onChange={e => setChartInstrumentId(e.target.value)}
                  style={{ height: 28, maxWidth: 300 }}>
                  <option value="__all">All instruments</option>
                  <option value="__none">No instrument</option>
                  {instrumentOptions.map(id => {
                    const ins = instrumentById[id];
                    return <option key={id} value={id}>{ins ? `${ins.name || ins.id} · ${ins.model || ins.vendor || id}` : id}</option>;
                  })}
                </select>
                <span style={{ flex: 1 }}/>
                <span className="mono tnum" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{levelResults.length} run{levelResults.length === 1 ? '' : 's'}</span>
              </div>

              {/* Manual QC entry */}
              <div className="panel" style={{ padding: 12 }}>
                <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Record QC run</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input mono tnum" placeholder="value" value={entryValue}
                    onChange={e => setEntryValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') recordResult(); }}
                    style={{ width: 140 }}/>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                    {entryValue !== '' && !Number.isNaN(Number(entryValue))
                      ? `z = ${window.westgard.zScore(Number(entryValue), activeLevel) != null ? window.westgard.zScore(Number(entryValue), activeLevel).toFixed(2) : '—'}`
                      : 'z = —'}
                  </span>
                  <input className="input mono" placeholder="instrument id (optional)" value={entryInstrumentId}
                    onChange={e => setEntryInstrumentId(e.target.value)} style={{ flex: 1 }}/>
                  <button className="btn" data-variant="primary" data-size="sm" onClick={recordResult}
                    disabled={entryValue === ''}>Record</button>
                </div>
              </div>

              {/* Levey-Jennings chart */}
              {levelResults.length > 0 && (
                <div className="panel" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>Levey-Jennings — z-score over time (oldest → newest)</div>
                  <div style={{ padding: 12 }}>
                    <LeveyJenningsChart results={[...levelResults].reverse()}/>
                  </div>
                </div>
              )}

              {/* Recent results */}
              <div className="panel" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>Recent results ({levelResults.length})</div>
                {levelResults.length === 0 ? (
                  <div className="empty" style={{ padding: '24px' }}>
                    <div className="empty-sub">No QC runs yet for this level.</div>
                  </div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr><th>Ran at</th><th>Instrument</th><th>Value</th><th>z-score</th><th>Status</th><th>Violations</th></tr>
                    </thead>
                    <tbody>
                      {levelResults.map(r => (
                        <tr key={r.id}>
                          <td className="mono" style={{ fontSize: 11 }}>{new Date(r.ranAt).toISOString().slice(0,16).replace('T', ' ')}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.instrumentId ? ((instrumentById[r.instrumentId] && (instrumentById[r.instrumentId].name || instrumentById[r.instrumentId].id)) || r.instrumentId) : '—'}</td>
                          <td className="mono tnum">{r.value}</td>
                          <td className="mono tnum" style={{ color: Math.abs(r.zScore || 0) > 2 ? 'var(--err-700)' : 'var(--ink-700)' }}>{r.zScore != null ? r.zScore.toFixed(2) : '—'}</td>
                          <td>
                            <span className="pill" data-tone={r.status === 'out_of_control' ? 'rust' : r.status === 'warn' ? 'amber' : r.status === 'in_control' ? 'sage' : 'ghost'}>
                              {r.status}
                            </span>
                          </td>
                          <td style={{ fontSize: 11 }}>{(r.violations || []).map(v => v.rule).join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Violations */}
              {levelViolations.length > 0 && (
                <div className="panel" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>Violations ({levelViolations.length})</div>
                  <table className="tbl">
                    <thead>
                      <tr><th>When</th><th>Instrument</th><th>Rule</th><th>Severity</th><th>Affected</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {levelViolations.map(v => (
                        <tr key={v.id}>
                          <td className="mono" style={{ fontSize: 11 }}>{new Date(v.createdAt).toISOString().slice(0,16).replace('T', ' ')}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{v.instrumentId ? ((instrumentById[v.instrumentId] && (instrumentById[v.instrumentId].name || instrumentById[v.instrumentId].id)) || v.instrumentId) : '—'}</td>
                          <td className="mono">{v.rule}</td>
                          <td>
                            <span className="pill" data-tone={v.severity === 'reject' ? 'rust' : 'amber'}>{v.severity}</span>
                          </td>
                          <td>{(v.affectedQcResultIds || []).length}</td>
                          <td>
                            {v.resolvedAt
                              ? <span className="pill" data-tone="sage">resolved</span>
                              : <span className="pill" data-tone="rust">open</span>}
                          </td>
                          <td>
                            {!v.resolvedAt && v.severity === 'reject' && (
                              <button className="btn" data-size="xs" onClick={() => ackViolation(v)}>Acknowledge</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="panel" style={{ padding: 30 }}>
              <div className="empty">
                <div className="empty-title">Select a QC level</div>
                <div className="empty-sub">Or click "New QC level" to define one.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
};

// ===== Notifications & TAT =====
//
// Single admin surface for the lab's notification rules. Today this is
// turnaround-time monitoring (the watcher in `tat-watcher.js` reads thresholds
// here and publishes both audit events and `notification` payloads). Future
// channels (delivery-failure escalation knobs, TAT-by-test overrides, custom
// rule routing) will land on this same page so operators have one place to
// reason about "who gets paged, when, and why."
//
// Design choice: thresholds are stored on the `lab_config` singleton (same row
// as Westgard rule selection). Editing here causes the watcher to re-scan
// immediately via the existing `db.subscribe('lab_config', …)` hook — no extra
// plumbing.
const TAT_PRIORITIES = [
  { id: 'stat',    label: 'STAT',    tone: 'rust',  hint: 'Critical priority — emergency / time-sensitive workflows.' },
  { id: 'asap',    label: 'ASAP',    tone: 'amber', hint: 'Elevated priority — urgent but not emergent.' },
  { id: 'routine', label: 'Routine', tone: 'sage',  hint: 'Standard priority — daily ambulatory workflows.' },
];

const TAT_RECIPIENT_ROLES = [
  'LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST',
  'LAB_ASSISTANT', 'PATHOLOGIST', 'IT_ADMIN',
];

const formatMinutes = (m) => {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 60) return Math.round(m) + 'm';
  const h = m / 60;
  if (h < 24) return h.toFixed(1).replace(/\.0$/, '') + 'h';
  const d = h / 24;
  return d.toFixed(1).replace(/\.0$/, '') + 'd';
};

const NotificationsPage = ({ onBack }) => {
  const cfg = window.useEntity('lab_config', window.schema.LAB_CONFIG_ID);
  const orders = window.useEntities('orders');
  const patients = window.useEntities('patients');
  const events = window.useEntities('audit_events');

  // Local draft mirrors persisted config so input typing isn't gated on the
  // db round-trip. Saved on blur / Enter / explicit Save. We seed the draft
  // from cfg the moment it lands.
  const [draft, setDraft] = useStateOS(null);
  useEffectOS(() => {
    if (!cfg) return;
    setDraft({
      tatThresholds: { ...(cfg.tatThresholds || window.schema.TAT_THRESHOLD_DEFAULTS) },
      tatWarnAtPercent: Number.isFinite(cfg.tatWarnAtPercent) ? cfg.tatWarnAtPercent : 80,
      tatRecipients: Array.isArray(cfg.tatRecipients) && cfg.tatRecipients.length
        ? [...cfg.tatRecipients] : [...(window.schema.TAT_RECIPIENTS_DEFAULT || ['LAB_SUPERVISOR'])],
    });
  }, [cfg]);

  // Per-priority threshold setters. Keep the input fully controlled while
  // letting the user clear the field temporarily (we coerce to a number on
  // save; empty strings / NaN are filtered).
  const setThreshold = (pri, raw) => {
    setDraft(d => ({ ...d, tatThresholds: { ...d.tatThresholds, [pri]: raw } }));
  };
  const setWarnPct = (raw) => setDraft(d => ({ ...d, tatWarnAtPercent: raw }));
  const toggleRecipient = (role) => {
    setDraft(d => {
      const has = d.tatRecipients.includes(role);
      const next = has ? d.tatRecipients.filter(r => r !== role) : [...d.tatRecipients, role];
      return { ...d, tatRecipients: next.length ? next : [role] };  // never let it empty
    });
  };

  const dirty = useMemoOS(() => {
    if (!cfg || !draft) return false;
    const a = cfg.tatThresholds || {};
    const b = draft.tatThresholds || {};
    for (const p of ['stat','asap','routine']) {
      if (Number(a[p]) !== Number(b[p])) return true;
    }
    if (Number(cfg.tatWarnAtPercent) !== Number(draft.tatWarnAtPercent)) return true;
    const aR = (cfg.tatRecipients || []).slice().sort().join(',');
    const bR = (draft.tatRecipients || []).slice().sort().join(',');
    if (aR !== bR) return true;
    return false;
  }, [cfg, draft]);

  const save = async () => {
    if (!draft || !cfg) return;
    const ask = await confirmConfigChange({
      id: 'admin.tat_config.save',
      title: 'Save TAT controls',
      message: 'This changes overdue classification and escalation recipients.',
      facts: [
        safetyFact('stat minutes', draft.tatThresholds && draft.tatThresholds.stat),
        safetyFact('asap minutes', draft.tatThresholds && draft.tatThresholds.asap),
        safetyFact('routine minutes', draft.tatThresholds && draft.tatThresholds.routine),
        safetyFact('warning percent', draft.tatWarnAtPercent),
        safetyFact('recipients', (draft.tatRecipients || []).join(', ') || 'none'),
      ],
      entityType: 'lab_config',
      entityId: window.schema.LAB_CONFIG_ID,
      confirmLabel: 'Save TAT controls',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('lab_config', window.schema.LAB_CONFIG_ID);
    const merged = window.schema.newLabConfig({
      ...(fresh || cfg),
      tatThresholds: draft.tatThresholds,
      tatWarnAtPercent: draft.tatWarnAtPercent,
      tatRecipients: draft.tatRecipients,
    });
    await window.db.put('lab_config', merged);
  };

  const revert = () => {
    if (!cfg) return;
    setDraft({
      tatThresholds: { ...(cfg.tatThresholds || window.schema.TAT_THRESHOLD_DEFAULTS) },
      tatWarnAtPercent: Number.isFinite(cfg.tatWarnAtPercent) ? cfg.tatWarnAtPercent : 80,
      tatRecipients: Array.isArray(cfg.tatRecipients) && cfg.tatRecipients.length
        ? [...cfg.tatRecipients] : [...(window.schema.TAT_RECIPIENTS_DEFAULT || ['LAB_SUPERVISOR'])],
    });
  };

  const runScanNow = async () => {
    if (!window.tatWatcher) {
      await safetyNotice({ tone: 'danger', title: 'TAT watcher unavailable', message: 'TAT watcher not loaded.' });
      return;
    }
    await window.tatWatcher.scan();
  };

  // Live counts: how many active orders are warn vs breach right now.
  const activeStats = useMemoOS(() => {
    const s = { ok: 0, warn: 0, breach: 0, total: 0 };
    for (const o of orders) {
      if (o.status === 'completed' || o.status === 'cancelled') continue;
      const lvl = o.tatBreachLevel || 'ok';
      s[lvl] = (s[lvl] || 0) + 1;
      s.total++;
    }
    return s;
  }, [orders]);

  // Recent breach/warn audit trail. We pull from audit_events (canonical state-
  // history) and resolve each to the order's current state for nav.
  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const orderById = useMemoOS(() => Object.fromEntries(orders.map(o => [o.id, o])), [orders]);
  const recent = useMemoOS(() => {
    return [...events]
      .filter(e => e.type === 'order.tat.breached' || e.type === 'order.tat.warned')
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 25);
  }, [events]);

  if (!cfg || !draft) {
    return <Page label="Notifications"><PageHeader title="Notifications"/></Page>;
  }

  return (
    <Page label="Notifications">
      <PageHeader title="Notifications" sub="TAT thresholds, alert routing, and recent breaches."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="scan" className="btn" data-size="sm" onClick={runScanNow} title="Re-scan all active orders against current thresholds">Run scan now</button>,
          <button key="rv" className="btn" data-size="sm" onClick={revert} disabled={!dirty}>Revert</button>,
          <button key="sv" className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!dirty}>Save</button>,
        ]}/>

      {/* Status strip — at-a-glance count of in-flight breach / warn orders */}
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {[
          { l: 'Active orders', v: activeStats.total, tone: 'slate' },
          { l: 'On time',       v: activeStats.ok,    tone: 'sage'  },
          { l: 'Warn',          v: activeStats.warn,  tone: 'amber' },
          { l: 'Breach',        v: activeStats.breach,tone: 'rust'  },
        ].map((s, i) => (
          <div key={s.l} style={{ padding: '12px 16px', borderRight: i < 3 ? '1px solid var(--line)' : 'none' }}>
            <div className="section-title" style={{ fontSize: 10 }}>{s.l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <span className="mono tnum" style={{ fontSize: 22, fontWeight: 500, color: s.v ? 'var(--ink-900)' : 'var(--ink-300)' }}>{s.v}</span>
              <span className="pill" data-tone={s.tone} style={{ fontSize: 10 }}>{s.l.toLowerCase().replace('active orders','active')}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

        {/* TAT thresholds editor */}
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>Turnaround time targets</span>
            <span style={{ flex: 1 }}/>
            <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>Minutes from order creation</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TAT_PRIORITIES.map(p => (
              <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px', gap: 10, alignItems: 'center' }}>
                <span className="pill" data-tone={p.tone} style={{ justifyContent: 'center' }}>{p.label}</span>
                <input className="input" type="number" min="1" step="1"
                  value={draft.tatThresholds[p.id] ?? ''}
                  onChange={e => setThreshold(p.id, e.target.value)}
                  onBlur={e => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v) || v <= 0) {
                      setThreshold(p.id, window.schema.TAT_THRESHOLD_DEFAULTS[p.id]);
                    } else {
                      setThreshold(p.id, Math.round(v));
                    }
                  }}
                  title={p.hint}/>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-400)', textAlign: 'right' }}>
                  {formatMinutes(Number(draft.tatThresholds[p.id]))}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-700)' }}>Warn at</span>
              <span style={{ flex: 1 }}/>
              <span className="mono tnum" style={{ fontSize: 11.5, color: 'var(--ink-700)' }}>{Math.round(Number(draft.tatWarnAtPercent) || 0)}% of target</span>
            </div>
            <input type="range" min="50" max="95" step="5"
              value={draft.tatWarnAtPercent}
              onChange={e => setWarnPct(Number(e.target.value))}
              style={{ width: '100%' }}/>
            <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 4 }}>
              Orders crossing this percent trigger a warn-level notification. Crossing 100% triggers a breach.
            </div>
          </div>
        </div>

        {/* Recipients */}
        <div className="panel" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>Alert routing</span>
            <span style={{ flex: 1 }}/>
            <span className="pill" data-tone="ghost" style={{ fontSize: 10 }}>{draft.tatRecipients.length} role{draft.tatRecipients.length === 1 ? '' : 's'}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {TAT_RECIPIENT_ROLES.map(role => {
              const enabled = draft.tatRecipients.includes(role);
              return (
                <label key={role}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 8px',
                    background: enabled ? '#fff' : 'var(--ivory-100)',
                    border: '1px solid var(--line)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    opacity: enabled ? 1 : 0.7,
                  }}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleRecipient(role)}/>
                  <span className="mono" style={{ fontSize: 11.5 }}>{role.replace(/_/g, ' ')}</span>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 8 }}>
            Each TAT crossing fires one notification per role above. Toasts and the bell drawer surface these alongside critical-result notifications.
          </div>
        </div>
      </div>

      {/* Recent breach/warn table */}
      <div className="panel">
        <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Recent TAT events</span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{recent.length} most recent</span>
        </div>
        {recent.length === 0 ? (
          <div className="empty" style={{ padding: '36px 24px' }}>
            <div className="empty-icon"><IconBell size={16}/></div>
            <div className="empty-title">No TAT events yet</div>
            <div className="empty-sub">Warn / breach events will land here as the watcher scans active orders.</div>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 130 }}>When</th>
                <th style={{ width: 100 }}>Type</th>
                <th>Order</th>
                <th>Patient</th>
                <th style={{ width: 70 }}>Priority</th>
                <th style={{ width: 90, textAlign: 'right' }}>Elapsed</th>
                <th style={{ width: 80, textAlign: 'right' }}>% of target</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(ev => {
                const o = ev.entityId ? orderById[ev.entityId] : null;
                const p = o && o.patientId ? patientById[o.patientId] : null;
                const payload = ev.payload || {};
                const isBreach = ev.type === 'order.tat.breached';
                return (
                  <tr key={ev.id}
                    style={{ cursor: o ? 'pointer' : 'default' }}
                    onClick={() => o && window.openEntity && window.openEntity('order', o.id)}>
                    <td className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
                      {formatDateTime(ev.ts)}
                    </td>
                    <td>
                      <span className="pill" data-tone={isBreach ? 'rust' : 'amber'} style={{ fontSize: 10.5 }}>
                        {isBreach ? 'Breach' : 'Warn'}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {payload.orderNumber || (o && o.orderNumber) || '—'}
                    </td>
                    <td>{p ? `${p.lastName}, ${p.firstName}` : <span style={{ color: 'var(--ink-300)' }}>—</span>}</td>
                    <td><PriorityPill p={payload.priority || (o && o.priority) || 'routine'}/></td>
                    <td className="mono tnum" style={{ textAlign: 'right' }}>{formatMinutes(payload.elapsedMin)}</td>
                    <td className="mono tnum" style={{ textAlign: 'right', color: isBreach ? 'var(--err-700)' : 'var(--warn-700)' }}>
                      {payload.pctOfTarget != null ? payload.pctOfTarget + '%' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
};

// ===== Admin =====
const AdminPage = ({ onNav }) => {
  const tiles = [
    { id: 'users',        label: 'Users & Roles',     desc: 'Manage users, roles, permissions',           icon: 'IconUser' },
    { id: 'clients',      label: 'Clients',           desc: 'Referring clinics, delivery preferences',    icon: 'IconMap', go: 'clients' },
    { id: 'locations',    label: 'Locations',         desc: 'Facilities, departments, sites',             icon: 'IconMap', go: 'locations' },
    { id: 'instruments',  label: 'Instruments',       desc: 'Configure devices and connectivity',         icon: 'IconInstrument', go: 'instruments' },
    { id: 'interfaces',   label: 'Interfaces',        desc: 'HL7 integrations and endpoints',             icon: 'IconInterface', go: 'interfaces' },
    { id: 'tests',        label: 'Test Catalog',      desc: 'Tests, panels, analytes, LOINC',             icon: 'IconBeaker', go: 'tests' },
    { id: 'mappers',      label: 'Mappers (LML)',     desc: 'Inbound/outbound format scripts',            icon: 'IconBranch', go: 'mappers' },
    { id: 'qc',           label: 'QC (Westgard)',     desc: 'Control levels, runs, rule violations',      icon: 'IconBeaker', go: 'qc' },
    { id: 'rules',        label: 'Rules Engine',      desc: 'Order routing, validation, reflex logic',    icon: 'IconRules', go: 'rules' },
    { id: 'ranges',       label: 'Reference Ranges',  desc: 'Ranges by test, age, sex, population',       icon: 'IconReports', go: 'tests' },
    { id: 'notifications',label: 'Notifications',     desc: 'TAT thresholds, alert routing, recent breaches', icon: 'IconBell', go: 'notifications' },
    { id: 'labels',       label: 'Labels & Printing', desc: 'Label templates, printers, formats',         icon: 'IconLabel', go: 'labels' },
    { id: 'audit',        label: 'Audit & Compliance',desc: 'Audit log, retention, access reviews',       icon: 'IconShield', go: 'reports' },
  ];

  const exportSnapshot = async () => {
    const snap = await window.db.exportAll();
    const json = JSON.stringify(snap, null, 2);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lattice-lis-${ts}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const [importPreview, setImportPreview] = useStateOS(null);

  // Test hook so a non-file-dialog code path can drive the modal (for E2E tests).
  // The file-input flow is the user's normal entry point; this exists because
  // synthetic click events on detached <input type=file> can't carry a File.
  useEffectOS(() => {
    window.__previewImport = async (snap) => {
      try {
        const diff = await window.db.diffSnapshot(snap);
        setImportPreview({ snap, diff, fileName: '(programmatic)' });
      } catch (e) {
        await safetyNotice({ tone: 'danger', title: 'Restore blocked', message: e.message });
      }
    };
    return () => { delete window.__previewImport; };
  }, []);

  const importSnapshot = async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      let snap;
      try { snap = JSON.parse(text); }
      catch (e) {
        await safetyNotice({ tone: 'danger', title: 'Invalid JSON', message: e.message });
        return;
      }
      try {
        const diff = await window.db.diffSnapshot(snap);
        setImportPreview({ snap, diff, fileName: file.name });
      } catch (e) {
        await safetyNotice({ tone: 'danger', title: 'Restore blocked', message: e.message });
      }
    };
    input.click();
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    const totalAdded = Object.values(importPreview.diff.collections || {}).reduce((n, c) => n + (c.added || 0), 0);
    const totalRemoved = Object.values(importPreview.diff.collections || {}).reduce((n, c) => n + (c.removed || 0), 0);
    const totalModified = Object.values(importPreview.diff.collections || {}).reduce((n, c) => n + (c.modified || 0), 0);
    const ask = await safetyConfirm({
      id: 'admin.database.restore',
      tone: 'danger',
      title: 'Restore database',
      message: 'This wipes the current browser database, re-checks the snapshot diff, then restores the selected file.',
      facts: [
        safetyFact('file', importPreview.fileName),
        safetyFact('added', totalAdded),
        safetyFact('removed', totalRemoved),
        safetyFact('modified', totalModified),
        safetyFact('records', importPreview.diff.validation ? importPreview.diff.validation.totalRecords : '-'),
        safetyFact('bytes', importPreview.diff.validation ? importPreview.diff.validation.totalBytes : '-'),
        safetyFact('warnings', importPreview.diff.validation && importPreview.diff.validation.warnings.length ? importPreview.diff.validation.warnings.join('; ') : 'none'),
        safetyFact('snapshot version', importPreview.snap.version),
      ],
      requireTypedText: 'RESTORE',
      entityType: 'database',
      entityId: 'all',
      confirmLabel: 'Restore database',
    });
    if (!ask.confirmed) return;
    try {
      const freshDiff = await window.db.diffSnapshot(importPreview.snap);
      setImportPreview({ ...importPreview, diff: freshDiff });
      const r = await window.db.importAll(importPreview.snap, { allowVersionSkew: true });
      setImportPreview(null);
      await safetyNotice({
        tone: 'info',
        title: 'Restore complete',
        message: `Restored ${r.restored} records (${r.skipped} unknown collections skipped).`,
      });
    } catch (e) {
      await safetyNotice({ tone: 'danger', title: 'Import failed', message: e.message });
    }
  };

  const resetDb = async () => {
    const snap = await window.db.exportAll();
    const counts = Object.entries(snap.collections || {}).map(([name, rows]) => `${name}:${(rows || []).length}`).join(' ');
    const ask = await safetyConfirm({
      id: 'admin.database.reset',
      tone: 'danger',
      title: 'Reset database',
      message: 'This wipes every collection in the browser database. Export first if anything matters.',
      facts: [safetyFact('collections', counts || 'empty'), safetyFact('version', snap.version)],
      requireTypedText: 'RESET',
      entityType: 'database',
      entityId: 'all',
      confirmLabel: 'Reset database',
      audit: false,
    });
    if (!ask.confirmed) return;
    await window.db.dropAll();
    if (window.events) {
      window.events.publish('operator.safety.confirmed', {
        actor: currentActorId(),
        actionId: 'admin.database.reset',
        entityType: 'database',
        entityId: 'all',
        typedText: ask.typedText,
      });
    }
    await safetyNotice({ tone: 'info', title: 'Database reset', message: 'Database cleared.' });
  };

  const [seeding, setSeeding] = useStateOS(false);
  const seedDemo = async () => {
    if (!window.seed) { await safetyNotice({ tone: 'danger', title: 'Seed unavailable', message: 'Seed module not loaded.' }); return; }
    const ask = await safetyConfirm({
      id: 'admin.demo.seed',
      tone: 'warning',
      title: 'Seed demo data',
      message: 'This clears prior __demo_ records, then generates realistic demo patients, orders, specimens, results, QC chains, and audit history. Non-demo data is left alone.',
      facts: [safetyFact('scope', '__demo_ records only'), safetyFact('non-demo data', 'preserved')],
      entityType: 'database',
      entityId: 'demo',
      confirmLabel: 'Seed demo',
    });
    if (!ask.confirmed) return;
    setSeeding(true);
    try {
      const summary = await window.seed.demo();
      await safetyNotice({
        tone: 'info',
        title: 'Demo data seeded',
        message: Object.entries(summary).map(([k,v]) => k + ': ' + v).join(' | '),
      });
    } catch (e) {
      console.error('[admin] seed failed', e);
      await safetyNotice({ tone: 'danger', title: 'Seed failed', message: e.message });
    } finally {
      setSeeding(false);
    }
  };
  const clearDemo = async () => {
    if (!window.seed) { await safetyNotice({ tone: 'danger', title: 'Seed unavailable', message: 'Seed module not loaded.' }); return; }
    const ask = await safetyConfirm({
      id: 'admin.demo.clear',
      tone: 'danger',
      title: 'Clear demo data',
      message: 'This removes all records marked with the __demo_ prefix.',
      facts: [safetyFact('scope', '__demo_ records')],
      entityType: 'database',
      entityId: 'demo',
      confirmLabel: 'Clear demo',
    });
    if (!ask.confirmed) return;
    const removed = await window.seed.clear();
    await safetyNotice({ tone: 'info', title: 'Demo data cleared', message: 'Removed ' + removed + ' demo records.' });
  };

  return (
    <Page label="Admin">
      <PageHeader title="Admin" sub="System configuration and governance."
        actions={[
          <button key="seed" className="btn" data-size="sm" data-variant="primary" onClick={seedDemo} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed demo'}
          </button>,
          <button key="seedClr" className="btn" data-size="sm" onClick={clearDemo} disabled={seeding}>Clear demo</button>,
          <button key="exp" className="btn" data-size="sm" onClick={exportSnapshot}>Export</button>,
          <button key="imp" className="btn" data-size="sm" onClick={importSnapshot}>Import</button>,
          <button key="rst" className="btn" data-size="sm" data-variant="danger" onClick={resetDb}>Reset</button>,
        ]}/>
      {/* Environment strip — honest about prototype status. The amber dot
          signals "this is not production"; the tooltip explains where to
          find the actual capability roster (the Build Ledger). */}
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {[
          { l: 'Environment', v: (
            <span title="Pre-production prototype. Tier 6 items (real MLLP transport, auth/MFA, FHIR R4, real Zebra-over-TCP) are deferred. See Build Ledger for what ships vs. defers.">
              <span className="dot" data-tone="warn" style={{ marginRight: 6 }}/>Prototype
            </span>
          ) },
          { l: 'Build', v: <span className="mono" title="Cache-bust build identifier">{(window.__LIS_VERSION || '0.x') + ''}</span> },
          { l: 'Database', v: <><span className="dot" data-tone="ok" style={{ marginRight: 6 }}/>IndexedDB</> },
          { l: 'System time', v: new Date().toISOString().slice(0,16).replace('T', ' ') + ' UTC' },
        ].map((s, i) => (
          <div key={s.l} style={{ padding: '12px 16px', borderRight: i < 3 ? '1px solid var(--line)' : 'none' }}>
            <div className="section-title" style={{ fontSize: 10 }}>{s.l}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-900)', marginTop: 2, display: 'flex', alignItems: 'center' }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {tiles.map(t => {
          const Ico = window[t.icon];
          return (
            <button key={t.id} onClick={() => t.go && onNav(t.go)}
              className="panel lift"
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', textAlign: 'left',
                cursor: 'pointer', background: '#fff',
                transition: 'background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--ivory-100)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--line)'; }}>
              <div style={{
                width: 32, height: 32, borderRadius: 6,
                background: 'var(--ivory-100)',
                display: 'grid', placeItems: 'center',
                color: 'var(--ink-500)', flexShrink: 0,
              }}>
                <Ico size={16}/>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-900)' }}>{t.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>{t.desc}</div>
              </div>
              <IconChevRight size={13} style={{ color: 'var(--ink-300)' }}/>
            </button>
          );
        })}
      </div>

      {importPreview && (
        <ImportPreviewModal preview={importPreview}
          onConfirm={confirmImport}
          onCancel={() => setImportPreview(null)}/>
      )}
    </Page>
  );
};

// Modal showing the diff before import-wipe-restore. Counts only — per-record
// drill-down would be a future iteration.
const ImportPreviewModal = ({ preview, onConfirm, onCancel }) => {
  const { snap, diff, fileName } = preview;
  const collEntries = useMemoOS(() => {
    return Object.entries(diff.collections)
      .filter(([, c]) => c.added || c.removed || c.modified || c.currentCount || c.incomingCount)
      .sort((a, b) => {
        const aChanges = a[1].added + a[1].removed + a[1].modified;
        const bChanges = b[1].added + b[1].removed + b[1].modified;
        return bChanges - aChanges;
      });
  }, [diff]);
  const totalAdded   = collEntries.reduce((n, [, c]) => n + c.added, 0);
  const totalRemoved = collEntries.reduce((n, [, c]) => n + c.removed, 0);
  const totalModified= collEntries.reduce((n, [, c]) => n + c.modified, 0);
  const validation = diff.validation || { warnings: [], totalRecords: null };

  return (
    <div onClick={onCancel} className="backdrop-in" style={{
      position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} className="scale-in" style={{
        background: '#fff', borderRadius: 8, width: 720, maxWidth: '90vw',
        maxHeight: '85vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Restore preview</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>
            {fileName} · version {snap.version}
            {!diff.versionMatch && <span style={{ color: 'var(--err-700)', marginLeft: 6 }}>(current is {diff.currentVersion} — version skew override required)</span>}
            {snap.exportedAt && <span> · exported {new Date(snap.exportedAt).toISOString().slice(0,16).replace('T',' ')}</span>}
          </div>
        </div>

        <div style={{ padding: '10px 16px', background: 'var(--ivory-50)', borderBottom: '1px solid var(--line)', display: 'flex', gap: 16 }}>
          <div><span className="section-title" style={{ fontSize: 9 }}>Added</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--ok-700)', fontWeight: 500 }}>+{totalAdded}</span></div>
          <div><span className="section-title" style={{ fontSize: 9 }}>Removed</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--err-700)', fontWeight: 500 }}>−{totalRemoved}</span></div>
          <div><span className="section-title" style={{ fontSize: 9 }}>Modified</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--warn-700)', fontWeight: 500 }}>~{totalModified}</span></div>
          {validation.totalRecords != null && (
            <div><span className="section-title" style={{ fontSize: 9 }}>Records</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--ink-500)', fontWeight: 500 }}>{validation.totalRecords}</span></div>
          )}
          {diff.unknownInSnapshot.length > 0 && (
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-500)' }}>
              <span className="pill" data-tone="amber">{diff.unknownInSnapshot.length}</span> unknown collection(s) will be skipped: {diff.unknownInSnapshot.join(', ')}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
          {validation.warnings && validation.warnings.length > 0 && (
            <div style={{ margin: '10px 8px', padding: '8px 10px', border: '1px solid var(--warn-200)', background: 'var(--warn-50)', borderRadius: 6, color: 'var(--warn-800)', fontSize: 11.5 }}>
              {validation.warnings.join('; ')}
            </div>
          )}
          {collEntries.length === 0 ? (
            <div className="empty" style={{ padding: 40 }}>
              <div className="empty-title">Snapshot matches current state</div>
              <div className="empty-sub">Nothing would change.</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th style={{ width: 80 }}>Current</th>
                  <th style={{ width: 80 }}>Incoming</th>
                  <th style={{ width: 70 }}>Added</th>
                  <th style={{ width: 70 }}>Removed</th>
                  <th style={{ width: 80 }}>Modified</th>
                  <th style={{ width: 80 }}>Unchanged</th>
                </tr>
              </thead>
              <tbody>
                {collEntries.map(([name, c]) => (
                  <tr key={name}>
                    <td><span className="mono">{name}</span></td>
                    <td className="mono tnum" style={{ color: 'var(--ink-500)' }}>{c.currentCount}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-500)' }}>{c.incomingCount}</td>
                    <td className="mono tnum" style={{ color: c.added ? 'var(--ok-700)' : 'var(--ink-300)' }}>{c.added ? '+' + c.added : '—'}</td>
                    <td className="mono tnum" style={{ color: c.removed ? 'var(--err-700)' : 'var(--ink-300)' }}>{c.removed ? '−' + c.removed : '—'}</td>
                    <td className="mono tnum" style={{ color: c.modified ? 'var(--warn-700)' : 'var(--ink-300)' }}>{c.modified ? '~' + c.modified : '—'}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-300)' }}>{c.unchanged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--err-700)' }}>This wipes the current database before restoring.</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" onClick={onCancel}>Cancel</button>
          <button className="btn" data-size="sm" data-variant="primary" onClick={onConfirm}>Restore now</button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  DashboardPage, OrdersPage, SpecimensPage, ResultsPage, PatientsPage,
  WorklistsPage, InstrumentsPage, InterfacesPage, ReportsPage, AdminPage,
  TestCatalogPage, ClientsPage, LocationsPage, LabelsPage, MappersPage, QcPage,
  NotificationsPage,
  PageHeader, Page, EmptyTable,
  TatPill,
});
