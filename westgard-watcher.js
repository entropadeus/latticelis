// westgard-watcher.js — Reacts to QC result writes by running the Westgard
// evaluator and persisting violations + an audit event.
//
// Subscribes to db writes on `qc_results`. On each new result, scopes the
// history to the same {qcLevelId, instrumentId} dimension, runs westgard.evaluate,
// then:
//   1. stamps `status` and `violations` onto the QC result
//   2. inserts a row into `qc_violations` for each new finding
//   3. publishes a synthetic event `qc.violation` for each rejection so the
//      rules-runtime / lockout layer can react.
//
// Idempotent against re-fires: violations are only inserted if a row with the
// same (rule, triggerQcResultId) doesn't already exist.

(function () {

  let __wired = false;
  // Track which QC result IDs we've already evaluated so we don't loop on our
  // own writes (we put the result back to stamp status — that re-fires the
  // subscriber).
  const __seen = new Set();

  // History MUST only include results that came strictly before the trigger.
  // Without this guard, async subscriber races let future results leak into
  // past evaluations and 10-x mistakenly stamps everything.
  const __scopedHistory = async (qcResult) => {
    const triggerRanAt = qcResult.ranAt || 0;
    const all = await window.db.list('qc_results',
      r => r.qcLevelId === qcResult.qcLevelId
        && (qcResult.instrumentId ? r.instrumentId === qcResult.instrumentId : true)
        && r.id !== qcResult.id
        && (r.ranAt || 0) < triggerRanAt);
    return all.sort((a, b) => (a.ranAt || 0) - (b.ranAt || 0));
  };

  const __existingViolation = async (rule, triggerId) => {
    const matches = await window.db.list('qc_violations',
      v => v.rule === rule && v.triggerQcResultId === triggerId);
    return matches[0] || null;
  };

  // Read installation-level Westgard rule selection. Single-row collection;
  // missing row = no rules disabled = baseline behavior. Cached briefly to
  // avoid an extra db.get per QC write during a burst, but invalidated on
  // any lab_config write so toggle takes effect within the next tick.
  let __cfgCache = null;
  let __cfgCacheAt = 0;
  const __readDisabledRules = async () => {
    const now = Date.now();
    if (__cfgCache && now - __cfgCacheAt < 1000) return __cfgCache;
    const row = await window.db.get('lab_config', 'lab_config').catch(() => null);
    __cfgCache = (row && Array.isArray(row.qcDisabledRules)) ? row.qcDisabledRules : [];
    __cfgCacheAt = now;
    return __cfgCache;
  };

  const __evaluateOne = async (qcResult) => {
    if (__seen.has(qcResult.id) && qcResult.status && qcResult.status !== 'pending') return;
    if (qcResult.zScore == null) return;
    const history = await __scopedHistory(qcResult);
    const disabledRules = await __readDisabledRules();
    const findings = window.westgard.evaluate({ trigger: qcResult, history, disabledRules });
    const status = window.westgard.statusFromFindings(findings);

    // Persist violations (idempotent).
    for (const f of findings) {
      const existing = await __existingViolation(f.rule, qcResult.id);
      if (existing) continue;
      const v = window.schema.newQcRuleViolation({
        qcLevelId: qcResult.qcLevelId,
        testId: qcResult.testId,
        instrumentId: qcResult.instrumentId,
        rule: f.rule,
        severity: f.severity,
        triggerQcResultId: qcResult.id,
        affectedQcResultIds: f.affected,
      });
      await window.db.put('qc_violations', v);
      // Surface to the wider event bus so rules-runtime / future lockout can listen.
      if (window.events && window.EVENTS) {
        window.events.publish('qc.violation', {
          entityType: 'qc_violation', entityId: v.id,
          violation: v, qcResult, severity: f.severity, rule: f.rule,
        });
      }
    }

    // Stamp status + findings onto the QC result if they changed.
    const compactFindings = findings.map(f => ({ rule: f.rule, severity: f.severity }));
    const changed = qcResult.status !== status
      || JSON.stringify(qcResult.violations || []) !== JSON.stringify(compactFindings);
    if (changed) {
      __seen.add(qcResult.id);
      await window.db.put('qc_results', { ...qcResult, status, violations: compactFindings });
    } else {
      __seen.add(qcResult.id);
    }
  };

  // Public hook the watcher exposes so the QC entry UI can force a re-evaluation
  // (useful when correcting a value).
  const evaluateNow = async (qcResultId) => {
    const r = await window.db.get('qc_results', qcResultId);
    if (r) await __evaluateOne(r);
  };

  // Serialize the drain so concurrent subscriber fires don't trample each
  // other while we're updating __seen + writing back qc_results.
  let __draining = null;
  const __drain = async () => {
    if (__draining) return __draining;
    __draining = (async () => {
      // Loop until there's nothing left to do — each pass picks up rows
      // that subscribers fired during the previous pass.
      let pass = 0;
      while (pass++ < 4) {
        const rows = await window.db.list('qc_results',
          r => r.status === 'pending' || (r.zScore != null && !__seen.has(r.id)));
        if (rows.length === 0) break;
        // Evaluate oldest first so each Westgard pass sees a consistent history.
        rows.sort((a, b) => (a.ranAt || 0) - (b.ranAt || 0));
        for (const r of rows) {
          try { await __evaluateOne(r); }
          catch (e) { console.error('[westgard] evaluate failed', r.id, e); }
        }
      }
    })();
    try { await __draining; } finally { __draining = null; }
  };

  const start = () => {
    if (__wired) return;
    if (!window.db || !window.westgard || !window.schema) {
      setTimeout(start, 0);
      return;
    }
    __wired = true;
    window.db.subscribe('qc_results', () => { __drain(); });
    // Invalidate the lab_config cache as soon as it changes so the next QC
    // evaluation picks up new rule selections without a 1s lag.
    window.db.subscribe('lab_config', () => { __cfgCache = null; __cfgCacheAt = 0; });
  };

  window.westgardWatcher = { start, evaluateNow };
  start();

})();
