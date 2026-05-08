// notification-toasts.jsx — Bottom-right stack of dismissible toasts that
// listens for `notification` events. Used by rule actions (`notify.user`,
// `notify.role`, `notify.provider`) and any future caller that wants a
// non-blocking nudge.
//
// Mount once at the app root. Subscribes on mount, unsubscribes on unmount.
// Toasts auto-dismiss after 8 seconds; up to 5 visible at a time (older ones drop).

const { useState: useStateNT, useEffect: useEffectNT } = React;

const KIND_TONE = {
  user:     { tone: 'info',  label: 'User' },
  role:     { tone: 'amber', label: 'Role' },
  provider: { tone: 'sage',  label: 'Provider' },
  system:   { tone: 'ghost', label: 'System' },
};

const ntSafetyFact = (label, value) => ({
  label,
  value: value == null || value === '' ? '-' : String(value),
});

const ntConfirm = (options) => {
  if (!window.safetyConfirm) return Promise.resolve({ confirmed: false, reason: '', typedText: '' });
  return window.safetyConfirm(options);
};

const NotificationToasts = () => {
  const [toasts, setToasts] = useStateNT([]);

  useEffectNT(() => {
    const onEvent = async (evt) => {
      const p = evt.payload || {};
      // Persist to the notifications collection so the history drawer has a record.
      const persisted = window.schema && window.db
        ? window.schema.newNotification({ kind: p.kind, target: p.target, msg: p.msg, ctx: p.ctx, createdAt: evt.ts || Date.now() })
        : { id: 'tst_' + Date.now().toString(36), kind: p.kind, target: p.target, msg: p.msg, ctx: p.ctx };
      try { if (window.db) await window.db.put('notifications', persisted); }
      catch (e) { console.warn('[toasts] persist failed', e); }
      setToasts(prev => {
        const next = [persisted, ...prev];
        return next.length > 5 ? next.slice(0, 5) : next;
      });
      setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== persisted.id));
      }, 8000);
    };
    if (!window.events) return;
    return window.events.subscribe('notification', onEvent);
  }, []);

  const dismiss = (id) => setToasts(prev => prev.filter(t => t.id !== id));
  const openCtx = (ctx) => {
    if (!window.openEntity) return;
    if (ctx.resultId) window.openEntity('result', ctx.resultId);
    else if (ctx.specimenId) window.openEntity('specimen', ctx.specimenId);
    else if (ctx.orderId) window.openEntity('order', ctx.orderId);
  };
  // If the toast points at a critical-flag result that's still unacknowledged,
  // we offer an inline Ack so the operator doesn't have to navigate. Same write
  // shape as critical-alerts.jsx for consistency.
  const ackCritical = async (t) => {
    if (!t.ctx || !t.ctx.resultId) return;
    const r = await window.db.get('results', t.ctx.resultId);
    if (!r || r.criticalAckedAt) return;
    const ask = await ntConfirm({
      id: 'critical.ack.toast',
      tone: 'danger',
      title: 'Acknowledge critical result',
      message: 'Document the callback note before removing this toast from critical follow-up.',
      facts: [
        ntSafetyFact('result id', r.id),
        ntSafetyFact('specimen', r.specimenId),
        ntSafetyFact('test', r.testId),
        ntSafetyFact('critical value', `${r.value == null ? '-' : r.value} ${r.units || ''}`.trim()),
        ntSafetyFact('flag', r.flag),
      ],
      requireReason: true,
      reasonLabel: 'Callback note',
      reasonPlaceholder: 'who was reached, readback, or follow-up note',
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Acknowledge',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('results', r.id);
    if (!fresh || fresh.criticalAckedAt) return;
    const actor = window.currentUser ? window.currentUser.id : 'unknown';
    await window.db.put('results', { ...fresh, criticalAckedAt: Date.now(), criticalAckedBy: actor, criticalAckNote: ask.reason });
    if (window.events) {
      window.events.publish('rule.audit', {
        entityType: 'result', entityId: fresh.id, actor,
        payload: { message: 'Critical acknowledged from toast', note: ask.reason },
      });
    }
    dismiss(t.id);
  };

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 1100,
      display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => {
        const meta = KIND_TONE[t.kind] || KIND_TONE.system;
        const hasCtx = t.ctx && (t.ctx.resultId || t.ctx.specimenId || t.ctx.orderId);
        const isCriticalEsc = t.ctx && t.ctx.resultId && (t.msg || '').toUpperCase().includes('ESCALATION');
        return (
          <div key={t.id} className="panel slide-up" style={{
            padding: '10px 12px', boxShadow: 'var(--shadow-pop)',
            background: '#fff', pointerEvents: 'auto',
            borderLeft: isCriticalEsc ? '3px solid var(--rust)' : '1px solid var(--line)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="pill" data-tone={meta.tone}>{meta.label}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-700)', fontWeight: 500 }}>
                {t.target || '—'}
              </span>
              <div style={{ flex: 1 }}/>
              <button onClick={() => dismiss(t.id)}
                style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-400)', padding: 0, fontSize: 14, lineHeight: 1 }}
                title="Dismiss">×</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-700)', lineHeight: 1.4 }}>
              {t.msg || '(no message)'}
            </div>
            {/* When a role-targeted notification resolves to specific users,
                surface the names so operators see who actually got paged.
                Truncated past the third name to keep toasts compact. */}
            {t.kind === 'role' && t.ctx && Array.isArray(t.ctx.resolvedUserNames) && t.ctx.resolvedUserNames.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 4 }}>
                paged: {t.ctx.resolvedUserNames.length <= 3
                  ? t.ctx.resolvedUserNames.join(', ')
                  : `${t.ctx.resolvedUserNames.slice(0, 3).join(', ')} +${t.ctx.resolvedUserNames.length - 3}`}
              </div>
            )}
            {t.kind === 'role' && t.ctx && Array.isArray(t.ctx.resolvedUserIds) && t.ctx.resolvedUserIds.length === 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--warn-700)', marginTop: 4 }}>
                no users currently hold this role — paging nobody
              </div>
            )}
            {(hasCtx || isCriticalEsc) && (
              <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
                {isCriticalEsc && (
                  <button className="btn" data-size="xs" data-variant="primary"
                    onClick={() => ackCritical(t)}>
                    Acknowledge
                  </button>
                )}
                {hasCtx && (
                  <button className="btn" data-size="xs" onClick={() => openCtx(t.ctx)}>
                    Open
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

window.NotificationToasts = NotificationToasts;
