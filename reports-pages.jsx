const ReportsPage = () => {
  const events = window.useEntities('audit_events');
  const [q, setQ] = useStateOS('');
  const [filter, setFilter] = useStateOS('all');
  const [eventType, setEventType] = useStateOS('');     // exact event type, '' = any
  const [actor, setActor] = useStateOS('');             // exact actor, '' = any
  const [entityType, setEntityType] = useStateOS('');   // exact entity type, '' = any
  const [timeWindow, setTimeWindow] = useStateOS('all'); // '1h'|'6h'|'24h'|'7d'|'all'
  const animateNew = window.useDeferredEnter();

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

  const pager = usePagination(filtered);

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
          {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
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
              <tbody className="stagger-children">
                {pager.slice.map(e => {
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
                        className={animateNew ? 'slide-up' : ''}
                        style={canOpen ? { cursor: 'pointer' } : {}}
                        onClick={onRowClick}
                        title={canOpen ? `Open ${e.entityType} drawer` : undefined}>
                      <td><span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{formatDateTime(e.ts)}</span></td>
                      <td><span className="pill" data-tone={EVENT_TONE[e.type] || 'ghost'}>{EVENT_LABEL[e.type] || e.type}</span></td>
                      <td>
                        <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
                          {window.currentUserApi ? window.currentUserApi.displayName(e.actor) : (e.actor || 'system')}
                        </span>
                        {/* Frozen role snapshot — shows what the actor was authorized as
                            at the moment of the event, not what they're authorized as now. */}
                        {Array.isArray(e.actorRoles) && e.actorRoles.length > 0 && (() => {
                          const primary = e.actorRoles[0];
                          const meta = (window.schema && window.schema.ROLE_BY_ID && window.schema.ROLE_BY_ID[primary])
                            || { tone: 'ghost', label: primary };
                          return (
                            <span className="pill" data-tone={meta.tone}
                              style={{ fontSize: 9.5, marginLeft: 4 }}
                              title={e.actorRoles.length > 1 ? `+${e.actorRoles.length - 1} more: ${e.actorRoles.slice(1).join(', ')}` : meta.description}>
                              {meta.label}
                            </span>
                          );
                        })()}
                      </td>
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
          {filtered.length > 0 && <TablePagination {...pager}/>}
        </div>
      </div>
    </Page>
  );
};

// ===== Test Catalog =====
