// notifications-drawer.jsx — Right-side drawer that lists all persisted
// notifications (newest first) with kind chip, target, message, ctx-open
// affordance, and per-row Acknowledge. Topbar bell shows unread count.
//
// Mount once at the app root next to <NotificationToasts/>. The bell exposes
// itself via window.openNotifications() so any caller (palette, keyboard
// shortcut) can open the drawer without prop-drilling.

const { useState: useStateND, useEffect: useEffectND, useMemo: useMemoND } = React;

const NotificationsBell = () => {
  const all = window.useEntities('notifications');
  const [open, setOpen] = useStateND(false);
  const [filter, setFilter] = useStateND('unread');  // 'unread' | 'all'

  useEffectND(() => {
    window.openNotifications = () => setOpen(true);
    return () => { delete window.openNotifications; };
  }, []);

  const unread = useMemoND(() => all.filter(n => !n.acknowledgedAt), [all]);
  const visible = useMemoND(() => {
    const list = filter === 'unread' ? unread : all;
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 200);
  }, [all, unread, filter]);

  const ackOne = async (n) => {
    const actor = window.currentUser ? window.currentUser.id : 'unknown';
    await window.db.put('notifications', { ...n, acknowledgedAt: Date.now(), acknowledgedBy: actor });
  };
  const ackAll = async () => {
    const actor = window.currentUser ? window.currentUser.id : 'unknown';
    const ts = Date.now();
    for (const n of unread) {
      await window.db.put('notifications', { ...n, acknowledgedAt: ts, acknowledgedBy: actor });
    }
  };
  const openCtx = (ctx) => {
    if (!window.openEntity) return;
    if (ctx.resultId) window.openEntity('result', ctx.resultId);
    else if (ctx.specimenId) window.openEntity('specimen', ctx.specimenId);
    else if (ctx.orderId) window.openEntity('order', ctx.orderId);
  };

  const KIND_TONE = {
    user: 'info', role: 'amber', provider: 'sage', system: 'ghost',
  };

  return (
    <>
      <button onClick={() => setOpen(true)} title="Notifications"
        style={{
          position: 'relative', border: 0, background: 'transparent', cursor: 'pointer',
          padding: 6, color: 'var(--ink-500)', display: 'inline-flex', alignItems: 'center',
        }}>
        <window.IconBell size={16}/>
        {unread.length > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            minWidth: 14, height: 14, padding: '0 4px',
            borderRadius: 999, background: 'var(--rust)', color: '#fff',
            fontSize: 9, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}>{unread.length > 99 ? '99+' : unread.length}</span>
        )}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} className="backdrop-in" style={{
          position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.3)', zIndex: 1050,
        }}>
          <div onClick={e => e.stopPropagation()} className="drawer-in" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
            background: '#fff', boxShadow: 'var(--shadow-pop)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>Notifications</span>
              <span className="pill" data-tone={unread.length > 0 ? 'rust' : 'ghost'}>{unread.length} unread</span>
              <div style={{ flex: 1 }}/>
              <button className="btn" data-size="xs" onClick={() => setFilter(filter === 'unread' ? 'all' : 'unread')}>
                {filter === 'unread' ? 'Show all' : 'Show unread'}
              </button>
              <button className="btn" data-size="xs" data-variant="ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', background: 'var(--ivory-50)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn" data-size="xs" onClick={ackAll} disabled={unread.length === 0}>
                Mark all read ({unread.length})
              </button>
              <div style={{ flex: 1 }}/>
              <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{visible.length} shown</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {visible.length === 0 ? (
                <div className="empty" style={{ padding: '40px 24px' }}>
                  <div className="empty-title">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</div>
                  <div className="empty-sub">{filter === 'unread' ? 'You’re all caught up.' : 'Rule actions and system events appear here.'}</div>
                </div>
              ) : visible.map(n => {
                const tone = KIND_TONE[n.kind] || 'ghost';
                const hasCtx = n.ctx && (n.ctx.orderId || n.ctx.specimenId || n.ctx.resultId);
                return (
                  <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-soft)', opacity: n.acknowledgedAt ? 0.6 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span className="pill" data-tone={tone}>{n.kind}</span>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{n.target || '—'}</span>
                      <div style={{ flex: 1 }}/>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                        {new Date(n.createdAt).toISOString().slice(11, 16)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-700)', lineHeight: 1.5 }}>{n.msg || '(no message)'}</div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {hasCtx && (
                        <button className="btn" data-size="xs" onClick={() => { openCtx(n.ctx); setOpen(false); }}>Open</button>
                      )}
                      {!n.acknowledgedAt && (
                        <button className="btn" data-size="xs" data-variant="ghost" onClick={() => ackOne(n)}>Mark read</button>
                      )}
                      {n.acknowledgedAt && (
                        <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                          read {new Date(n.acknowledgedAt).toISOString().slice(11, 16)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

window.NotificationsBell = NotificationsBell;
