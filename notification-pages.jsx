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
