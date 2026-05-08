// critical-alerts.jsx — Sticky top-right banner stack for unacknowledged
// critical results. Reads results.flag in (LL, HH, A, AA) where !criticalAckedAt.
// Persisted on the result entity itself so reloads don't drop pending alerts.

const { useMemo: useMemoCA, useEffect: useEffectCA, useState: useStateCA } = React;

const CRITICAL_FLAGS = ['LL', 'HH', 'A', 'AA'];

const caSafetyFact = (label, value) => ({
  label,
  value: value == null || value === '' ? '-' : String(value),
});

const caPatientName = (patient) => {
  if (!patient) return 'no patient';
  const name = [patient.lastName, patient.firstName].filter(Boolean).join(', ');
  return [patient.mrn, name].filter(Boolean).join(' - ') || patient.id;
};

const caConfirm = (options) => {
  if (!window.safetyConfirm) return Promise.resolve({ confirmed: false, reason: '', typedText: '' });
  return window.safetyConfirm(options);
};

const CriticalAlerts = () => {
  const results = window.useEntities('results');
  const specimens = window.useEntities('specimens');
  const patients = window.useEntities('patients');
  const tests = window.useEntities('tests');

  const specimenById = useMemoCA(() => Object.fromEntries(specimens.map(s => [s.id, s])), [specimens]);
  const patientById = useMemoCA(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const testById = useMemoCA(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  const canAckCritical = hasPermission('ACK_CRITICAL');

  const unacked = useMemoCA(() => {
    return results
      .filter(r => CRITICAL_FLAGS.includes(r.flag) && !r.criticalAckedAt)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [results]);

  const [collapsed, setCollapsed] = useStateCA(false);

  const ack = async (r) => {
    if (!hasPermission('ACK_CRITICAL')) return;
    const spec = r.specimenId ? specimenById[r.specimenId] : null;
    const pat = spec && spec.patientId ? patientById[spec.patientId] : null;
    const test = r.testId ? testById[r.testId] : null;
    const ask = await caConfirm({
      id: 'critical.ack',
      tone: 'danger',
      title: 'Acknowledge critical result',
      message: 'Document the callback note before removing this from critical follow-up.',
      facts: [
        caSafetyFact('result id', r.id),
        caSafetyFact('patient', caPatientName(pat)),
        caSafetyFact('accession', spec ? (spec.accessionNumber || spec.id) : r.specimenId),
        caSafetyFact('test', test ? `${test.code || ''} ${test.name || ''}`.trim() : r.testId),
        caSafetyFact('critical value', `${r.value == null ? '-' : r.value} ${r.units || ''}`.trim()),
        caSafetyFact('flag', r.flag),
      ],
      requireReason: true,
      reasonLabel: 'Callback note',
      reasonPlaceholder: 'who was reached, readback, or follow-up note',
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Acknowledge',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('ACK_CRITICAL')) return;
    const fresh = await window.db.get('results', r.id);
    if (!fresh || fresh.criticalAckedAt) return;
    const actor = window.currentUser ? window.currentUser.id : 'unknown';
    const updated = { ...fresh, criticalAckedAt: Date.now(), criticalAckedBy: actor, criticalAckNote: ask.reason };
    await window.db.put('results', updated);
    window.events.publish('rule.audit', {
      entityType: 'result', entityId: r.id, actor,
      payload: { message: 'Critical acknowledged', note: ask.reason },
    });
  };

  const ackAll = async () => {
    if (!hasPermission('ACK_CRITICAL')) return;
    const ask = await caConfirm({
      id: 'critical.ack.batch',
      tone: 'danger',
      title: 'Acknowledge critical batch',
      message: 'This documents the same callback note on each currently visible unacknowledged critical.',
      facts: [
        caSafetyFact('critical count', unacked.length),
        caSafetyFact('first results', unacked.slice(0, 6).map(r => {
          const spec = r.specimenId ? specimenById[r.specimenId] : null;
          const test = r.testId ? testById[r.testId] : null;
          return `${spec ? (spec.accessionNumber || spec.id.slice(-6)) : r.id.slice(-6)} ${test ? test.code : r.testId || ''}`.trim();
        }).join(', ')),
      ],
      requireReason: true,
      reasonLabel: 'Callback note',
      reasonPlaceholder: 'who was reached, readback, or follow-up note',
      entityType: 'result',
      entityId: 'batch',
      confirmLabel: 'Acknowledge all',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('ACK_CRITICAL')) return;
    const actor = window.currentUser ? window.currentUser.id : 'unknown';
    for (const r of unacked) {
      const fresh = await window.db.get('results', r.id);
      if (!fresh || fresh.criticalAckedAt) continue;
      const updated = { ...fresh, criticalAckedAt: Date.now(), criticalAckedBy: actor, criticalAckNote: ask.reason };
      await window.db.put('results', updated);
      window.events.publish('rule.audit', {
        entityType: 'result', entityId: fresh.id, actor,
        payload: { message: 'Critical acknowledged', note: ask.reason, batch: true },
      });
    }
  };

  if (unacked.length === 0) return null;

  if (collapsed) {
    return (
      <button onClick={() => setCollapsed(false)} className="slide-down" style={{
        position: 'fixed', top: 12, right: 12, zIndex: 800,
        height: 36, padding: '0 14px',
        background: 'var(--rust)', color: '#fff',
        border: '1px solid var(--err-700)', borderRadius: 6,
        fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
        boxShadow: 'var(--shadow-pop)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span className="dot" data-tone="err" style={{ width: 8, height: 8, background: '#fff' }}/>
        {unacked.length} critical {unacked.length === 1 ? 'result' : 'results'}
      </button>
    );
  }

  return (
    <div className="slide-down" style={{
      position: 'fixed', top: 12, right: 12, width: 380, zIndex: 800,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px',
        background: 'var(--rust)', color: '#fff',
        borderRadius: 6, fontSize: 11.5, fontWeight: 500,
        boxShadow: 'var(--shadow-md)',
      }}>
        <span style={{ flex: 1 }}>
          {unacked.length} critical {unacked.length === 1 ? 'result' : 'results'} pending
        </span>
        {unacked.length > 1 && (
          <button onClick={ackAll}
            disabled={!canAckCritical}
            title={permissionTitle(canAckCritical, 'Acknowledge all critical results', 'acknowledge critical results')}
            style={{
            background: 'rgba(255,255,255,0.18)', color: '#fff',
            border: 0, borderRadius: 4, height: 22, padding: '0 8px',
            fontSize: 11, cursor: canAckCritical ? 'pointer' : 'not-allowed',
            opacity: canAckCritical ? 1 : 0.55,
          }}>Ack all</button>
        )}
        <button onClick={() => setCollapsed(true)} style={{
          background: 'transparent', color: '#fff', border: 0, padding: '0 4px',
          fontSize: 14, cursor: 'pointer', lineHeight: 1,
        }} title="Collapse">−</button>
      </div>

      {unacked.slice(0, 6).map(r => {
        const spec = r.specimenId ? specimenById[r.specimenId] : null;
        const pat = spec && spec.patientId ? patientById[spec.patientId] : null;
        const test = r.testId ? testById[r.testId] : null;
        return (
          <div key={r.id} style={{
            background: '#fff',
            border: '1px solid var(--rust)',
            borderLeft: '3px solid var(--rust)',
            borderRadius: 6, padding: 10,
            boxShadow: 'var(--shadow-md)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
              <span className="pill" data-tone="rust" style={{ flexShrink: 0 }}>
                {r.flag} CRITICAL
              </span>
              {r.criticalEscalationTier > 0 && (
                <span className="pill" data-tone="rust" style={{
                  flexShrink: 0, background: 'var(--err-700)', color: '#fff',
                  fontWeight: 600, animation: 'fadeIn 200ms ease-out',
                }} title={`Escalated to T${r.criticalEscalationTier} — unacknowledged past threshold`}>
                  T{r.criticalEscalationTier} ESC
                </span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-900)', fontWeight: 500 }}>
                  {test ? <><span className="mono">{test.code}</span> <span style={{ marginLeft: 4, color: 'var(--ink-700)' }}>{test.name}</span></> : 'Result'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>
                  {pat ? (pat.mrn + ' · ' + ([pat.lastName, pat.firstName].filter(Boolean).join(', ') || '—')) : 'No patient'}
                  {spec && <span> · {spec.accessionNumber || spec.id.slice(-6)}</span>}
                </div>
                {r.criticalEscalatedAt && (
                  <div style={{ fontSize: 10.5, color: 'var(--err-700)', marginTop: 3, fontWeight: 500 }}>
                    Escalated {Math.round((Date.now() - r.criticalEscalatedAt) / 1000)}s ago
                  </div>
                )}
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '6px 8px', borderRadius: 4,
              background: 'var(--rust-soft)',
              marginBottom: 8,
            }}>
              <span className="mono tnum" style={{ fontSize: 18, fontWeight: 500, color: 'var(--err-700)' }}>
                {r.value}
              </span>
              <span style={{ fontSize: 11, color: 'var(--err-700)' }}>{r.units}</span>
              <div style={{ flex: 1 }}/>
              <span style={{ fontSize: 10.5, color: 'var(--err-700)' }}>
                ref {r.refRangeLow != null ? r.refRangeLow : '—'}–{r.refRangeHigh != null ? r.refRangeHigh : '—'}
              </span>
            </div>
            {r.comments && (
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 8, lineHeight: 1.4 }}>
                {r.comments}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn" data-variant="primary" data-size="xs" onClick={() => ack(r)}
                disabled={!canAckCritical}
                title={permissionTitle(canAckCritical, 'Acknowledge critical result', 'acknowledge critical results')}
                style={{ flex: 1 }}>
                Acknowledge
              </button>
              <button className="btn" data-size="xs" onClick={() => {
                // Navigate to results page (best-effort)
                if (window.__navTo) window.__navTo('results');
              }}>View</button>
            </div>
          </div>
        );
      })}

      {unacked.length > 6 && (
        <div style={{
          fontSize: 11, color: 'var(--ink-500)', textAlign: 'center',
          padding: 6, background: '#fff', borderRadius: 4,
          border: '1px solid var(--line)',
        }}>
          + {unacked.length - 6} more on Results page
        </div>
      )}
    </div>
  );
};

Object.assign(window, { CriticalAlerts });
