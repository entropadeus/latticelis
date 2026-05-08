// tat-watcher.js — Turnaround time monitor.
//
// Polls active (non-terminal) orders every 60s and compares elapsed time
// (now − orderedAt) against per-priority thresholds stored in `lab_config`.
// Each order carries three TAT fields managed exclusively by this module:
//   - tatBreachLevel     'ok' | 'warn' | 'breach'
//   - tatNotifiedLevel   'ok' | 'warn' | 'breach' — highest level fired so far
//   - tatBreachedAt      ms timestamp of the first breach transition
//
// Why a poller, not an event subscriber: TAT is *time-driven*, not write-
// driven. An order can sit untouched and still cross a threshold five
// minutes later. Subscribing to db writes would miss this. The 60s tick is
// granular enough for hospital lab targets (smallest default is 60min STAT).
//
// Idempotency:
//   - tatNotifiedLevel guards re-fires within a single run of the watcher.
//   - When thresholds are edited downward (warn=70% → 60%, or stat=60 → 30),
//     orders may suddenly find themselves over the new threshold; the watcher
//     re-classifies and notifies once per crossing.
//   - When thresholds are edited *upward*, an order that previously breached
//     may drop back below — we reset tatNotifiedLevel so the next genuine
//     crossing surfaces fresh.
//
// Terminal orders (status: 'completed' | 'cancelled') are never re-evaluated.

(function () {

  const TICK_MS = 60_000;             // 60s scan cadence
  const TICK_FIRST_DELAY_MS = 2_500;  // let the rest of boot finish first

  let __interval = null;
  let __started = false;
  let __scanning = false;             // single-flight guard

  const __readConfig = async () => {
    if (!window.db) return null;
    const row = await window.db.get('lab_config', 'lab_config').catch(() => null);
    if (row) return row;
    // Lazy seed — first install will see no row. Write the singleton with
    // defaults so the Notifications admin renders editable values immediately.
    if (!window.schema || !window.schema.newLabConfig) return null;
    const seeded = window.schema.newLabConfig({});
    await window.db.put('lab_config', seeded).catch(() => {});
    return seeded;
  };

  const resolveThreshold = (order, cfg, testsById = {}) => {
    const candidates = ((order && order.testIds) || [])
      .map(id => testsById[id])
      .filter(Boolean)
      .map(t => ({ test: t, min: Number(t.turnaroundMinutes) }))
      .filter(x => Number.isFinite(x.min) && x.min > 0)
      .sort((a, b) => a.min - b.min);
    if (candidates.length > 0) {
      return {
        thresholdMin: candidates[0].min,
        thresholdSource: 'test',
        thresholdTestId: candidates[0].test.id,
      };
    }
    const thresholds = (cfg && cfg.tatThresholds) || window.schema.TAT_THRESHOLD_DEFAULTS;
    const pri = (order && order.priority) || 'routine';
    const thresholdMin = Number(thresholds[pri]);
    return Number.isFinite(thresholdMin) && thresholdMin > 0
      ? { thresholdMin, thresholdSource: 'priority', thresholdTestId: null }
      : { thresholdMin: null, thresholdSource: 'none', thresholdTestId: null };
  };

  const pauseMs = (order, now) => {
    const stored = Math.max(0, Number(order && order.tatPausedMs) || 0);
    const started = Number(order && order.tatPauseStartedAt);
    return stored + (Number.isFinite(started) && started > 0 ? Math.max(0, now - started) : 0);
  };

  // Pure: classify a single order against thresholds. Returns the new level
  // ('ok' | 'warn' | 'breach') and the elapsed minutes. Exported for tests
  // and for the Dashboard panel so they don't reimplement the math.
  const classify = (order, cfg, now = Date.now(), testsById = {}) => {
    if (!order || !order.orderedAt) return { level: 'ok', elapsedMin: 0, thresholdMin: null };
    if (order.status === 'completed' || order.status === 'cancelled') {
      return { level: 'ok', elapsedMin: 0, thresholdMin: null, terminal: true };
    }
    const warnPct = (cfg && Number.isFinite(cfg.tatWarnAtPercent)) ? cfg.tatWarnAtPercent : 80;
    const { thresholdMin, thresholdSource, thresholdTestId } = resolveThreshold(order, cfg, testsById);
    if (!Number.isFinite(thresholdMin) || thresholdMin <= 0) {
      return { level: 'ok', elapsedMin: 0, thresholdMin: null };
    }
    const rawElapsedMin = Math.max(0, (now - order.orderedAt) / 60000);
    const pausedMin = pauseMs(order, now) / 60000;
    const elapsedMin = Math.max(0, rawElapsedMin - pausedMin);
    let level = 'ok';
    if (elapsedMin >= thresholdMin) level = 'breach';
    else if (elapsedMin >= (thresholdMin * warnPct / 100)) level = 'warn';
    return {
      level, elapsedMin, rawElapsedMin, pausedMin,
      thresholdMin, thresholdSource, thresholdTestId,
      warnAtMin: thresholdMin * warnPct / 100,
      paused: !!order.tatPauseStartedAt,
    };
  };

  // Severity ranking so we can compare levels.
  const __rank = (l) => l === 'breach' ? 2 : l === 'warn' ? 1 : 0;

  const __notify = (order, level, verdict, recipients) => {
    if (!window.events) return;
    const { elapsedMin, rawElapsedMin, pausedMin, thresholdMin, thresholdSource, thresholdTestId } = verdict;
    const overBy = Math.max(0, Math.round(elapsedMin - thresholdMin));
    const pct = thresholdMin > 0 ? Math.round((elapsedMin / thresholdMin) * 100) : 0;
    const pri = (order.priority || 'routine').toUpperCase();
    const ord = order.orderNumber || order.id;
    const msg = level === 'breach'
      ? `TAT BREACH · ${pri} order ${ord} — ${overBy}m over (${pct}% of ${Math.round(thresholdMin)}m target).`
      : `TAT WARN · ${pri} order ${ord} — ${pct}% of ${Math.round(thresholdMin)}m target.`;

    // Semantic event for the audit log + any future subscribers (rules-runtime
    // can add a primitive that listens to these for custom escalation flows).
    window.events.publish(level === 'breach' ? 'order.tat.breached' : 'order.tat.warned', {
      entityType: 'order',
      entityId: order.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      priority: order.priority,
      elapsedMin: Math.round(elapsedMin),
      rawElapsedMin: Math.round(rawElapsedMin || elapsedMin),
      pausedMin: Math.round(pausedMin || 0),
      thresholdMin: Math.round(thresholdMin),
      thresholdSource,
      thresholdTestId,
      pctOfTarget: pct,
      level,
    });

    // Surface to operators via the existing notification rail. Fire one
    // notification per recipient role so the toast `target` chip shows the
    // role and the drawer history records who was paged.
    for (const role of recipients) {
      window.events.publish('notification', {
        kind: 'role',
        target: role,
        msg,
        ctx: { orderId: order.id },
        viaTat: true,
        level,
        thresholdSource,
      });
    }
  };

  const reconcilePause = async (order, specs, auditEvents, now) => {
    const rejected = specs.filter(s => s.state === 'rejected');
    if (rejected.length === 0) return {};
    const rejectedIds = new Set(rejected.map(s => s.id));
    const rejectEvents = auditEvents
      .filter(e => e.type === 'specimen.rejected' && rejectedIds.has(e.entityId))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const latestRejectTs = (rejectEvents[0] && rejectEvents[0].ts)
      || Math.max(...rejected.map(s => s.updatedAt || s.createdAt || 0));
    if (!Number.isFinite(latestRejectTs) || latestRejectTs <= 0) return {};

    const hasReplacementAfterReject = specs.some(s =>
      s.state !== 'rejected' && ((s.createdAt || 0) > latestRejectTs || (s.receivedAt || 0) > latestRejectTs));
    const pauseStart = Number(order.tatPauseStartedAt) || null;
    const alreadyPaused = Math.max(0, Number(order.tatPausedMs) || 0);

    if (!hasReplacementAfterReject && !pauseStart) {
      return { tatPauseStartedAt: latestRejectTs, tatPauseReason: 'specimen rejected - awaiting recollect' };
    }
    if (hasReplacementAfterReject && pauseStart) {
      return {
        tatPausedMs: alreadyPaused + Math.max(0, now - pauseStart),
        tatPauseStartedAt: null,
        tatPauseReason: '',
      };
    }
    return {};
  };

  const scan = async () => {
    if (__scanning) return;
    __scanning = true;
    try {
      if (!window.db || !window.schema) return;
      const cfg = await __readConfig();
      if (!cfg) return;
      const recipients = Array.isArray(cfg.tatRecipients) && cfg.tatRecipients.length
        ? cfg.tatRecipients
        : (window.schema.TAT_RECIPIENTS_DEFAULT || ['LAB_SUPERVISOR']);

      const orders = await window.db.list('orders',
        o => o.status !== 'completed' && o.status !== 'cancelled');
      const tests = await window.db.list('tests');
      const testsById = Object.fromEntries(tests.map(t => [t.id, t]));
      const specimens = await window.db.list('specimens');
      const auditEvents = await window.db.list('audit_events',
        e => e.type === 'specimen.rejected');
      const specsByOrder = specimens.reduce((acc, s) => {
        if (!s.orderId) return acc;
        (acc[s.orderId] = acc[s.orderId] || []).push(s);
        return acc;
      }, {});
      const now = Date.now();

      for (const o of orders) {
        const pausePatch = await reconcilePause(o, specsByOrder[o.id] || [], auditEvents, now);
        const workingOrder = Object.keys(pausePatch).length ? { ...o, ...pausePatch } : o;
        const verdict = classify(workingOrder, cfg, now, testsById);
        const { level, thresholdMin, thresholdSource, thresholdTestId } = verdict;
        if (thresholdMin == null) continue;

        const prevLevel = o.tatBreachLevel || 'ok';
        // Discovery mode: an order without a tatNotifiedLevel field is one we've
        // never scanned before (old record predating the TAT schema, or a snapshot
        // import). We catch its current level up silently — stamping the breach
        // state for UI surfaces but skipping the notification fire-hose. New
        // orders created via schema.newOrder always get tatNotifiedLevel='ok' so
        // they fall through the normal climbed/dropped path on first crossing.
        const isDiscovery = o.tatNotifiedLevel === undefined;
        const prevNotified = isDiscovery ? level : (o.tatNotifiedLevel || 'ok');

        // Decide whether to write back. We only write when something actually
        // changes — minimizes db churn and prevents subscriber storms.
        const levelChanged = level !== prevLevel;
        const climbed = !isDiscovery && __rank(level) > __rank(prevNotified);
        const dropped = !isDiscovery && __rank(level) < __rank(prevNotified);
        const summaryChanged = Math.round(Number(o.tatThresholdMin) || 0) !== Math.round(thresholdMin)
          || (o.tatThresholdSource || '') !== thresholdSource
          || (o.tatThresholdTestId || null) !== (thresholdTestId || null)
          || Math.round(Number(o.tatPausedMs) || 0) !== Math.round(Number(workingOrder.tatPausedMs) || 0)
          || (o.tatPauseStartedAt || null) !== (workingOrder.tatPauseStartedAt || null)
          || (o.tatPauseReason || '') !== (workingOrder.tatPauseReason || '');

        if (!levelChanged && !climbed && !dropped && !isDiscovery && !summaryChanged) continue;

        const next = { ...workingOrder };
        next.tatThresholdMin = thresholdMin;
        next.tatThresholdSource = thresholdSource;
        next.tatThresholdTestId = thresholdTestId || null;
        if (levelChanged || isDiscovery) {
          next.tatBreachLevel = level;
          if (level === 'breach' && !next.tatBreachedAt) next.tatBreachedAt = now;
          if (level === 'ok') { next.tatBreachedAt = null; }
        }
        if (isDiscovery) {
          // Stamp current level as "already notified" so the next genuine
          // climb (e.g. warn → breach) fires fresh.
          next.tatNotifiedLevel = level;
        } else if (climbed) {
          next.tatNotifiedLevel = level;
        } else if (dropped) {
          // Thresholds widened (or order otherwise dropped back) — reset the
          // notified-level so a future re-crossing surfaces fresh.
          next.tatNotifiedLevel = level;
        }
        await window.db.put('orders', next);

        if (climbed && level !== 'ok') {
          __notify(next, level, verdict, recipients);
        }
      }
    } catch (e) {
      console.error('[tat-watcher] scan failed', e);
    } finally {
      __scanning = false;
    }
  };

  const start = () => {
    if (__started) return;
    if (!window.db || !window.events || !window.schema) {
      setTimeout(start, 0);
      return;
    }
    __started = true;
    setTimeout(() => {
      scan();
      __interval = setInterval(scan, TICK_MS);
    }, TICK_FIRST_DELAY_MS);

    // Re-scan immediately when thresholds change so edits surface alerts
    // without waiting for the next tick.
    window.db.subscribe('lab_config', () => { scan(); });
  };

  const stop = () => {
    if (__interval) { clearInterval(__interval); __interval = null; }
    __started = false;
  };

  // Expose for tests / admin manual-trigger / rules primitives.
  window.tatWatcher = { start, stop, scan, classify, resolveThreshold, TICK_MS };
  start();
})();
