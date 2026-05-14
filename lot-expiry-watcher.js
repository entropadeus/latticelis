// lot-expiry-watcher.js — once-per-boot scan of QC levels for expired or
// expiring-soon (≤14 days) lots. Each affected level produces a `notification`
// event so the toast + drawer surface the alert; persisted to the
// `notifications` collection by the toast subscriber.
//
// Spam guard: localStorage tracks (qcLevelId, ymd) so we only fire one
// notification per level per UTC day regardless of reloads. The watcher
// intentionally does NOT poll — boot-time scan is sufficient since lot dates
// only change when a level is edited (and the UI already shows the per-row
// pill in real time).

(function () {

  const DEFAULT_SOON_DAYS = 14;
  const KEY = 'lattice.lotExpiryNotified';

  // Per-test override: `test.lotExpirationAmberDays`, in days. Only finite
  // positive values win — null / undefined / 0 / NaN / negative all fall back
  // to DEFAULT_SOON_DAYS. Same defensive shape as critical-escalation
  // resolveThresholds, deliberately, so the two per-test override surfaces
  // read identically when scanning the codebase.
  const __resolveSoonDays = (test) => {
    if (!test) return DEFAULT_SOON_DAYS;
    const n = Number(test.lotExpirationAmberDays);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SOON_DAYS;
  };

  let __started = false;

  const todayUtcYmd = () => new Date().toISOString().slice(0, 10);

  const __readSeen = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
    catch { return {}; }
  };
  const __writeSeen = (obj) => {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
  };

  const scan = async () => {
    if (!window.db || !window.events) return;
    // Explicit Number.isFinite guard. The previous `&& l.lotExpiresAt`
    // truthy check rejected null/undefined/0 by accident but accepted NaN
    // (which then propagated through the `Math.ceil` math below as NaN days
    // and silently failed the `> SOON_DAYS` filter — no fire, no warn).
    const levels = await window.db.list('qc_levels',
      l => l.active !== false && Number.isFinite(l.lotExpiresAt));
    if (levels.length === 0) return;

    const ymd = todayUtcYmd();
    const seen = __readSeen();
    // Compact yesterday's keys so localStorage doesn't grow forever.
    const compact = {};
    for (const [k, v] of Object.entries(seen)) {
      if (v === ymd) compact[k] = v;
    }

    const tests = await window.db.list('tests');
    const testById = Object.fromEntries(tests.map(t => [t.id, t]));

    let fired = 0;
    for (const l of levels) {
      const days = Math.ceil((l.lotExpiresAt - Date.now()) / 86400000);
      const t = testById[l.testId];
      const soonDays = __resolveSoonDays(t);
      if (days > soonDays) continue;

      const seenKey = l.id + '|' + ymd;
      if (seen[seenKey] === ymd) {
        compact[seenKey] = ymd;  // preserve so we don't re-fire after reload
        continue;
      }

      const testCode = t ? t.code : '?';
      const lotLabel = l.lotNumber ? ('lot ' + l.lotNumber) : 'this lot';
      const msg = days < 0
        ? `QC ${testCode} ${l.level}: ${lotLabel} EXPIRED ${-days}d ago — replace before next QC run.`
        : days === 0
          ? `QC ${testCode} ${l.level}: ${lotLabel} expires today — replace before next QC run.`
          : `QC ${testCode} ${l.level}: ${lotLabel} expires in ${days} day${days === 1 ? '' : 's'}.`;

      window.events.publish('notification', {
        kind: 'role',
        target: 'LAB_SUPERVISOR',
        msg,
        ctx: {
          qcLevelId: l.id,
          testId: l.testId,
          // Surface which threshold fired so audit trail can distinguish
          // "tight per-test override" from "lab-wide default" in retrospect.
          thresholdDays: soonDays,
          thresholdSource: soonDays === DEFAULT_SOON_DAYS ? 'default' : 'test',
        },
        viaLotExpiry: true,
      });
      compact[seenKey] = ymd;
      fired++;
    }

    __writeSeen(compact);
    if (fired > 0) console.info('[lot-expiry-watcher] fired ' + fired + ' notification(s) for ' + ymd);
  };

  const start = () => {
    if (__started) return;
    if (!window.db || !window.events) {
      setTimeout(start, 0);
      return;
    }
    __started = true;
    // Defer the scan so the rest of the boot finishes (toast subscriber must
    // be wired before we publish, otherwise the notification is lost).
    setTimeout(() => {
      scan().catch(e => console.error('[lot-expiry-watcher] scan failed', e));
    }, 1500);
  };

  // Exposed for testing.
  const scanNow = () => scan();
  const resetSeen = () => { try { localStorage.removeItem(KEY); } catch {} };

  window.lotExpiryWatcher = {
    start, scanNow, resetSeen,
    resolveSoonDays: __resolveSoonDays,
    DEFAULT_SOON_DAYS,
  };
  start();
})();
