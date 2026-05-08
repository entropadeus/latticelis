// qc-gate.js — Single source of truth for "is this test locked out by QC?"
//
// Result writers / release callers ask this BEFORE publishing result.released.
// If locked, they refuse the release and surface the reason to the user.
//
//   await window.qcGate.isLocked(testId, opts)
//     opts: { instrumentId?, asOf? }
//     returns: { locked: bool, reason: string, violation: qcRuleViolation | null }
//
//   await window.qcGate.acknowledgeViolation(violationId, { actor, reason })
//     marks a violation acknowledged + resolved with audit; unblocks release
//
// Lock policy (v1):
//   A test is locked iff there's at least one UNRESOLVED rejection-severity
//   violation against any QC level for that test (scoped to instrumentId if
//   provided), AND the most-recent QC result for that level is still
//   out_of_control. We require BOTH so that:
//     - Acknowledging a single violation clears the lock
//     - A subsequent in-control QC also clears the lock (the lab "ran QC again
//       and it passed" case)

(function () {

  const isLocked = async (testId, opts = {}) => {
    if (!testId) return { locked: false, reason: '', violation: null };
    const { instrumentId } = opts;

    // Pull all unresolved rejections for this test.
    const violations = await window.db.list('qc_violations',
      v => v.testId === testId
        && v.severity === 'reject'
        && !v.resolvedAt
        && (instrumentId ? !v.instrumentId || v.instrumentId === instrumentId : true));
    if (violations.length === 0) return { locked: false, reason: '', violation: null };

    // For each violating QC level, check the most-recent QC result for that
    // level — if the latest is back in control, treat the lock as cleared
    // even before someone acknowledges (so re-running QC unblocks).
    const byLevel = {};
    for (const v of violations) {
      if (!byLevel[v.qcLevelId]) byLevel[v.qcLevelId] = [];
      byLevel[v.qcLevelId].push(v);
    }

    let firstActive = null;
    for (const levelId of Object.keys(byLevel)) {
      const recent = await window.db.list('qc_results',
        r => r.qcLevelId === levelId
          && (instrumentId ? !r.instrumentId || r.instrumentId === instrumentId : true));
      recent.sort((a, b) => (b.ranAt || 0) - (a.ranAt || 0));
      if (recent.length === 0) continue;
      const latest = recent[0];
      if (latest.status === 'out_of_control') {
        firstActive = byLevel[levelId][0];
        break;
      }
    }
    if (!firstActive) return { locked: false, reason: '', violation: null };

    return {
      locked: true,
      reason: `QC ${firstActive.rule} on level ${firstActive.qcLevelId} (unresolved rejection)`,
      violation: firstActive,
    };
  };

  const acknowledgeViolation = async (violationId, opts = {}) => {
    if (!violationId) throw new Error('[qc-gate] violationId required');
    const v = await window.db.get('qc_violations', violationId);
    if (!v) throw new Error('[qc-gate] violation not found: ' + violationId);
    const updated = {
      ...v,
      acknowledgedAt: Date.now(),
      acknowledgedBy: opts.actor || (window.currentUser ? window.currentUser.id : 'unknown'),
      resolvedAt: Date.now(),
      notes: opts.reason ? (v.notes ? v.notes + ' | ' + opts.reason : opts.reason) : v.notes,
    };
    await window.db.put('qc_violations', updated);
    if (window.events) {
      window.events.publish('qc.violation_resolved', {
        entityType: 'qc_violation', entityId: updated.id,
        violation: updated, actor: updated.acknowledgedBy,
      });
    }
    return updated;
  };

  // Convenience: does THIS specific result's test currently allow release?
  const canRelease = async (result) => {
    if (!result || !result.testId) return { ok: true, locked: false };
    const r = await isLocked(result.testId, { instrumentId: result.instrumentId });
    return { ok: !r.locked, locked: r.locked, reason: r.reason, violation: r.violation };
  };

  window.qcGate = { isLocked, acknowledgeViolation, canRelease };

})();
