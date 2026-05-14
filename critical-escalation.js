// critical-escalation.js — Auto-escalates critical results that remain
// unacknowledged past per-tier thresholds.
//
// Tiers:
//   T0  Released / detected (no escalation yet) — initial state
//   T1  Supervisor — fires after T1 threshold unacknowledged
//   T2  Director / oncall — fires after T2 threshold unacknowledged
//
// Thresholds:
//   • Defaults are short (45s / 90s) so the prod-pilot demo is observable.
//   • Per-test override via test.criticalEscalationT1Sec / T2Sec (set in the
//     Test Catalog). Non-finite, ≤0, or T2 ≤ T1 values fall back to defaults.
//
// On each escalation fire we:
//   1. Stamp `criticalEscalatedAt` + `criticalEscalationTier` on the result.
//   2. Publish a `notification` event (kind 'role', target = current tier role).
//   3. Audit-log via `result.critical.escalated`.
//
// The watcher polls every CHECK_MS and processes anything that's overdue. Polling
// is fine here — escalation thresholds are minute-scale and the result set is
// small. If we ever hit thousands of pending criticals, bind it to the result
// writer instead.

(function () {

  const CRITICAL_FLAGS = ['LL', 'HH', 'A', 'AA'];
  const TIER1_MS = 45 * 1000;
  const TIER2_MS = 90 * 1000;
  const CHECK_MS = 10 * 1000;

  let __started = false;
  let __timer = null;

  // Per-test threshold resolver. Returns { t1Ms, t2Ms, source } where
  // source ∈ 'test' | 'default' | 'partial'. Defensive against:
  //   • null / undefined fields (no override set)
  //   • NaN / Infinity / non-numeric strings (Number.isFinite guard)
  //   • Zero or negative seconds (would fire instantly / never)
  //   • T2 ≤ T1 (would skip the supervisor tier or invert the chain)
  // When ONLY one tier has a valid override, the other falls back to its
  // global default. If the resulting pair would still violate T1 < T2, we
  // log and revert that tier to the default.
  const resolveThresholds = (test) => {
    const valid = (n) => Number.isFinite(n) && n > 0;
    const rawT1 = test ? Number(test.criticalEscalationT1Sec) : NaN;
    const rawT2 = test ? Number(test.criticalEscalationT2Sec) : NaN;
    let t1Ms = valid(rawT1) ? rawT1 * 1000 : TIER1_MS;
    let t2Ms = valid(rawT2) ? rawT2 * 1000 : TIER2_MS;
    let source = 'default';
    if (valid(rawT1) && valid(rawT2)) source = 'test';
    else if (valid(rawT1) || valid(rawT2)) source = 'partial';
    if (t2Ms <= t1Ms) {
      console.warn('[critical-escalation] test', test && test.code,
        'has T2 ≤ T1 (T1=' + t1Ms + 'ms, T2=' + t2Ms + 'ms); reverting to defaults');
      t1Ms = TIER1_MS;
      t2Ms = TIER2_MS;
      source = 'default';
    }
    return { t1Ms, t2Ms, source };
  };

  const escalate = async (result, tier, ctx) => {
    const now = Date.now();
    const updated = {
      ...result,
      criticalEscalatedAt: now,
      criticalEscalationTier: tier,
    };
    await window.db.put('results', updated);

    const target = tier === 1 ? 'LAB_SUPERVISOR' : 'LAB_DIRECTOR';
    const test = ctx && ctx.test;
    const accession = result.specimenId
      ? (await window.db.get('specimens', result.specimenId).catch(() => null))
      : null;

    const summary = (test ? test.code : 'Critical')
      + ' ' + (result.value != null ? result.value : '—')
      + ' ' + (result.units || '')
      + ' (flag ' + result.flag + ')';

    if (window.events) {
      window.events.publish('notification', {
        kind: 'role',
        target,
        msg: `T${tier} ESCALATION — ${summary} unacknowledged. ${accession ? 'Accession ' + accession.accessionNumber : ''}`.trim(),
        ctx: { resultId: result.id, specimenId: result.specimenId },
        viaEscalation: true,
      });
      window.events.publish('result.critical.escalated', {
        entityType: 'result', entityId: result.id, result: updated,
        tier, target, summary,
        thresholdMs: tier === 1 ? (ctx && ctx.t1Ms) : (ctx && ctx.t2Ms),
        thresholdSource: ctx && ctx.source,
      });
    }
    console.warn('[critical-escalation] tier ' + tier + ' fired:', summary,
      '(threshold ' + (tier === 1 ? ctx && ctx.t1Ms : ctx && ctx.t2Ms) + 'ms, source ' + (ctx && ctx.source) + ')');
  };

  const tick = async () => {
    if (!window.db) return;
    const now = Date.now();
    const pending = await window.db.list('results', r =>
      CRITICAL_FLAGS.includes(r.flag) && !r.criticalAckedAt
    );
    // Cache test lookups within a tick — the same test may have many pending
    // results (e.g. a lab in trouble). Avoids N db.get calls.
    const testCache = new Map();
    for (const r of pending) {
      // Reference time is the result's release/result moment. Prefer releasedAt
      // (when the clinic was meant to receive it), else resultedAt, else createdAt.
      const since = r.releasedAt || r.resultedAt || r.createdAt || 0;
      const elapsed = now - since;
      const currentTier = r.criticalEscalationTier || 0;
      if (currentTier >= 2) continue;

      let test = null;
      if (r.testId) {
        if (testCache.has(r.testId)) {
          test = testCache.get(r.testId);
        } else {
          test = await window.db.get('tests', r.testId).catch(() => null);
          testCache.set(r.testId, test);
        }
      }
      const { t1Ms, t2Ms, source } = resolveThresholds(test);
      const ctx = { test, t1Ms, t2Ms, source };

      if (currentTier < 2 && elapsed >= t2Ms) {
        await escalate(r, 2, ctx);
      } else if (currentTier < 1 && elapsed >= t1Ms) {
        await escalate(r, 1, ctx);
      }
    }
  };

  const start = () => {
    if (__started) return;
    if (!window.db || !window.events) {
      setTimeout(start, 0);
      return;
    }
    __started = true;
    __timer = setInterval(() => {
      tick().catch(e => console.error('[critical-escalation] tick failed', e));
    }, CHECK_MS);
    console.info('[critical-escalation] watcher started (T1 ' + TIER1_MS / 1000 + 's, T2 ' + TIER2_MS / 1000 + 's)');
  };

  const stop = () => {
    if (__timer) clearInterval(__timer);
    __timer = null;
    __started = false;
  };

  // Exposed for testing — run a tick on demand.
  const tickNow = () => tick();

  window.criticalEscalation = { start, stop, tickNow, TIER1_MS, TIER2_MS, resolveThresholds };
  start();
})();
