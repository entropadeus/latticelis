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
    // `zeroCaption` overrides the default "No data" foot-text when the KPI
    // is zero. Counters where zero is the *good* state (criticals, interface
    // alerts, review queue) get reassuring copy; counters where zero is just
    // "nothing yet today" get neutral copy. `zeroIsGood` lights the value
    // sage instead of muted ink so the dashboard reads as healthy at a glance.
    return [
      { l: 'Orders today',         v: ordersToday,         i: 'IconOrder',
        zeroCaption: 'No orders yet today' },
      { l: 'Specimens in transit', v: specimensInTransit,  i: 'IconTube',
        zeroCaption: 'None in transit' },
      { l: 'Results to verify',    v: resultsToVerify,     i: 'IconResults',
        zeroCaption: 'Queue is clear', zeroIsGood: true },
      { l: 'Critical results',     v: criticalResults,     i: 'IconFlag',
        tone: criticalResults > 0 ? 'rust' : null,
        zeroCaption: 'All clear', zeroIsGood: true },
      { l: 'Interface alerts',     v: interfaceAlerts,     i: 'IconInterface',
        tone: interfaceAlerts > 0 ? 'amber' : null,
        zeroCaption: 'All systems healthy', zeroIsGood: true },
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
        const valueColor = isZero
          ? (k.zeroIsGood ? 'var(--sage-600)' : 'var(--ink-300)')
          : k.tone === 'rust'  ? 'var(--err-700)'
          : k.tone === 'amber' ? 'var(--warn-700)'
          : 'var(--ink-900)';
        const captionColor = isZero && k.zeroIsGood ? 'var(--sage-700)' : 'var(--ink-300)';
        const caption = isZero ? (k.zeroCaption || 'No data') : 'Live';
        return (
          <div key={k.l} className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
              <span className="section-title" style={{ fontSize: 10 }}>{k.l}</span>
              <Ico size={14} style={{ color: 'var(--ink-300)' }}/>
            </div>
            <div className="mono tnum" style={{ fontSize: 26, color: valueColor, fontWeight: 400, letterSpacing: '-0.02em' }}>{isZero ? '0' : k.v}</div>
            <div style={{ fontSize: 11, color: captionColor, marginTop: 2 }}>{caption}</div>
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
                className="dashboard-bar-row"
                style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr 60px 60px',
                  gap: 8, alignItems: 'center', fontSize: 12,
                  padding: '4px 6px', borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'background 80ms linear',
                }}>
                <span className="mono" style={{ color: 'var(--sage-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.client.code}
                </span>
                <div style={{ height: 10, background: 'var(--sage-50)', borderRadius: 999, position: 'relative', overflow: 'hidden' }}>
                  <div className="dashboard-bar-fill" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: widthPct + '%', background: 'var(--sage-600)', borderRadius: 999, transition: 'background 120ms linear, width 240ms var(--ease-out)' }}/>
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
        <span style={{ fontSize: 10.5, color: 'var(--ink-300)' }}>
          {window.currentUserApi ? window.currentUserApi.displayName(ev.actor) : ev.actor}
        </span>
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

