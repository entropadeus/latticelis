// westgard.js — Westgard multi-rule QC evaluator (pure functions).
//
// Six classic rules. We evaluate the most-recent QC result against a window
// of recent history and return all rules that fire, with severity:
//
//   1-2s   warn    one control >2 SD from mean (warning, not rejection)
//   1-3s   reject  one control >3 SD from mean
//   2-2s   reject  two consecutive same-side, both >2 SD
//   R-4s   reject  two consecutive in same run, range >4 SD apart
//                  ("range" = absolute difference of zScores)
//   4-1s   reject  four consecutive same-side, all >1 SD
//   10-x   reject  ten consecutive same-side of mean (no SD threshold)
//
// All rules are evaluated against the chain ending at the trigger result.
// "Same-side" = sign of zScore agrees (treat 0 as either side / neutral —
// effectively excluded from same-side runs to be defensive).
//
// The runtime caller passes:
//   evaluate({trigger, history, disabledRules})
//     - trigger:        the just-recorded QcResult ({zScore, ...})
//     - history:        the prior QcResults in chronological order, oldest → newest
//                       (NOT including trigger). Caller is responsible for scoping
//                       to the same {qcLevelId, testId, instrumentId} dimension.
//     - disabledRules:  optional array of rule IDs to skip. Some labs disable 1-2s
//                       (treat as advisory only) or 4-1s for specific workflows.
//                       Unknown IDs are silently ignored. Empty / missing = all rules
//                       active (default behavior).
//
// Returns: array of { rule, severity, affected: [resultIds] }
//
// Pure: no side effects, no DB access. The watcher persists violations.

(function () {

  const sign = (z) => (z > 0 ? 1 : (z < 0 ? -1 : 0));

  // 1-2s — single result > 2 SD. Warning.
  const rule_1_2s = (trigger) => {
    if (trigger.zScore == null) return null;
    if (Math.abs(trigger.zScore) > 2) {
      return { rule: '1-2s', severity: 'warn', affected: [trigger.id] };
    }
    return null;
  };

  // 1-3s — single result > 3 SD. Rejection.
  const rule_1_3s = (trigger) => {
    if (trigger.zScore == null) return null;
    if (Math.abs(trigger.zScore) > 3) {
      return { rule: '1-3s', severity: 'reject', affected: [trigger.id] };
    }
    return null;
  };

  // 2-2s — trigger AND previous both >2 SD AND same side. Rejection.
  const rule_2_2s = (trigger, history) => {
    if (trigger.zScore == null || history.length < 1) return null;
    const prev = history[history.length - 1];
    if (prev.zScore == null) return null;
    const sT = sign(trigger.zScore), sP = sign(prev.zScore);
    if (sT === 0 || sT !== sP) return null;
    if (Math.abs(trigger.zScore) > 2 && Math.abs(prev.zScore) > 2) {
      return { rule: '2-2s', severity: 'reject', affected: [prev.id, trigger.id] };
    }
    return null;
  };

  // R-4s — trigger and previous span >4 SD (regardless of side). Rejection.
  // "Range" semantics: |z1 - z2| > 4. Most authors require the two readings
  // to be within the same run; we approximate this as "the immediately prior
  // QC result on the same level" since the caller already scopes history.
  const rule_R_4s = (trigger, history) => {
    if (trigger.zScore == null || history.length < 1) return null;
    const prev = history[history.length - 1];
    if (prev.zScore == null) return null;
    if (Math.abs(trigger.zScore - prev.zScore) > 4) {
      return { rule: 'R-4s', severity: 'reject', affected: [prev.id, trigger.id] };
    }
    return null;
  };

  // 4-1s — trigger + 3 most recent (4 total) all same side, all |z|>1. Rejection.
  const rule_4_1s = (trigger, history) => {
    if (trigger.zScore == null || history.length < 3) return null;
    const window = [...history.slice(-3), trigger];
    const sT = sign(trigger.zScore);
    if (sT === 0) return null;
    for (const r of window) {
      if (r.zScore == null) return null;
      if (sign(r.zScore) !== sT) return null;
      if (Math.abs(r.zScore) <= 1) return null;
    }
    return { rule: '4-1s', severity: 'reject', affected: window.map(r => r.id) };
  };

  // 10-x — trigger + 9 most recent (10 total) all on same side of mean. Rejection.
  // No SD threshold (unlike 4-1s).
  const rule_10_x = (trigger, history) => {
    if (trigger.zScore == null || history.length < 9) return null;
    const window = [...history.slice(-9), trigger];
    const sT = sign(trigger.zScore);
    if (sT === 0) return null;
    for (const r of window) {
      if (r.zScore == null) return null;
      if (sign(r.zScore) !== sT) return null;
    }
    return { rule: '10-x', severity: 'reject', affected: window.map(r => r.id) };
  };

  // Map keyed by rule ID so we can skip via disabledRules without scanning
  // an array. Order of evaluation is preserved by RULE_ORDER below.
  const RULE_FNS = {
    '1-3s': rule_1_3s,
    '2-2s': rule_2_2s,
    'R-4s': rule_R_4s,
    '4-1s': rule_4_1s,
    '10-x': rule_10_x,
    '1-2s': rule_1_2s,
  };
  // Note: 1-2s is evaluated last so it doesn't shadow stronger findings — but
  // we always return ALL that fire. Order only matters for human readability.
  const RULE_ORDER = ['1-3s', '2-2s', 'R-4s', '4-1s', '10-x', '1-2s'];

  const evaluate = ({ trigger, history, disabledRules }) => {
    if (!trigger || trigger.zScore == null) return [];
    const safeHistory = Array.isArray(history) ? history : [];
    // Defensive: accept any array-ish, drop non-strings, dedupe.
    const skip = new Set(
      Array.isArray(disabledRules)
        ? disabledRules.filter(r => typeof r === 'string')
        : []
    );
    const findings = [];
    for (const id of RULE_ORDER) {
      if (skip.has(id)) continue;
      const out = RULE_FNS[id](trigger, safeHistory);
      if (out) findings.push(out);
    }
    return findings;
  };

  // Status from a set of findings. Used by the watcher to decide what to
  // stamp on the QcResult itself.
  //   'in_control'      — no findings
  //   'warn'            — only warnings (1-2s alone)
  //   'out_of_control'  — at least one rejection
  const statusFromFindings = (findings) => {
    if (!findings || findings.length === 0) return 'in_control';
    if (findings.some(f => f.severity === 'reject')) return 'out_of_control';
    return 'warn';
  };

  // Helper: compute z-score from raw value + qcLevel. Caller-side convenience.
  const zScore = (value, qcLevel) => {
    if (value == null || !qcLevel || qcLevel.mean == null || !qcLevel.sd) return null;
    if (qcLevel.sd === 0) return null;
    return (Number(value) - Number(qcLevel.mean)) / Number(qcLevel.sd);
  };

  window.westgard = {
    evaluate,
    statusFromFindings,
    zScore,
    RULES: ['1-2s', '1-3s', '2-2s', 'R-4s', '4-1s', '10-x'],
  };

})();
