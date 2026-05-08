// instrument-sim.js — Lattice LIS analyzer simulator
//
// Until real ASTM/HL7 instrument interfaces are wired (Tier 3), this stands in
// for the analyzer hardware. Subscribes to `specimen.routed` and synthesizes
// results for each test on the routed specimen's order.
//
// Behavior:
//   - 80% of values inside the test's reference range, 20% outside (random side)
//   - Reference flag (L / H) computed from value vs. range
//   - Status = 'preliminary' so verification / autoverification rules can promote
//   - Each result publishes `result.received` (drives the result-side rule chain)
//   - When all results land, specimen state advances `in_analysis → completed`
//
// Public surface (window.instrumentSim):
//   start()             — idempotent, called automatically on script load
//   setEnabled(bool)    — disable to pause simulation while keeping the runtime alive
//   isEnabled()         — current state
//   subscribe(fn)       — receive simulator activity ({ kind, specimenId, ... })
//   getRecent(n=20)     — recent activity log for UI

(function () {

  const SIM_NORMAL_PROBABILITY = 0.8;
  const SIM_DELAY_MIN_MS = 1500;
  const SIM_DELAY_MAX_MS = 3500;
  const ACTIVITY_BUFFER  = 50;

  let __enabled = true;
  let __started = false;
  const __pending = new Map();    // specimenId → setTimeout handle
  const __subs = new Set();       // activity subscribers
  const __activity = [];          // ring of recent events

  const log = (...args) => console.info('[instrument-sim]', ...args);

  // ── Random value generation ────────────────────────────────────────────

  const flagFromValue = (v, low, high) => {
    if (low == null || high == null) return '';
    if (v < low) return 'L';
    if (v > high) return 'H';
    return '';
  };

  const randomValueAround = (low, high) => {
    // No reference range → arbitrary 0–100. Caller still gets a valid number.
    if (low == null || high == null) return Number((Math.random() * 100).toFixed(2));
    const span = high - low;
    if (Math.random() < SIM_NORMAL_PROBABILITY) {
      // Inside the range, slightly biased away from the bounds
      return Number((low + Math.random() * span).toFixed(2));
    }
    // Out-of-range: 20–80% of span past one bound
    const side = Math.random() < 0.5 ? -1 : 1;
    const offset = span * (0.2 + Math.random() * 0.6);
    return Number(((side > 0 ? high : low) + side * offset).toFixed(2));
  };

  // ── Activity buffer / subscribers ──────────────────────────────────────

  const notify = (msg) => {
    const evt = { ...msg, ts: Date.now() };
    __activity.unshift(evt);
    if (__activity.length > ACTIVITY_BUFFER) __activity.length = ACTIVITY_BUFFER;
    __subs.forEach(fn => { try { fn(evt); } catch (e) { console.error('[instrument-sim] subscriber threw', e); } });
  };

  // ── Completion helper ──────────────────────────────────────────────────
  //
  // Used both at the end of the result-generation timer AND as the early
  // exit of runSpecimenWork when there's nothing to generate but the
  // specimen might still need to transition. Without this, a specimen
  // stuck at `in_analysis` with all results already in (post-reload, or
  // catch-up scenario) would never reach `completed` because the simulator
  // only checked completion after writing a new result.
  const maybeCompleteSpecimen = async (specimenId) => {
    const cur = await window.db.get('specimens', specimenId);
    if (!cur || !cur.orderId) return false;
    if (cur.state !== 'in_analysis') return false;
    const curOrder = await window.db.get('orders', cur.orderId);
    if (!curOrder || !curOrder.testIds || curOrder.testIds.length === 0) return false;
    const finalResults = await window.db.list('results', r => r.specimenId === cur.id);
    const finalTestIds = new Set(finalResults.map(r => r.testId));
    const allDone = curOrder.testIds.every(tid => finalTestIds.has(tid));
    if (!allDone) return false;
    let completed;
    try {
      completed = await window.lifecycle.transition('specimens', cur, 'completed',
        { actor: 'sim', reason: 'all results posted (catch-up completion)' });
    } catch (e) {
      console.warn('[sim] lifecycle.transition refused; falling back', e);
      completed = { ...cur, state: 'completed' };
      await window.db.put('specimens', completed);
    }
    window.events.publish('specimen.completed', {
      entityType: 'specimen', entityId: completed.id, specimen: completed,
      via: 'instrument-sim',
    });
    return true;
  };

  // ── Routed-specimen handler ────────────────────────────────────────────

  // Generate results for whichever tests on this specimen don't have one yet.
  // Idempotent across calls — used by both initial routing and reflex updates.
  const runSpecimenWork = async (specimenId, sourceLabel) => {
    if (!__enabled) return;

    const specimen = await window.db.get('specimens', specimenId);
    if (!specimen || !specimen.orderId) return;
    if (specimen.state === 'rejected') return;
    const order = await window.db.get('orders', specimen.orderId);
    if (!order || !order.testIds || order.testIds.length === 0) return;

    // Which tests on this specimen still need a result?
    const existingResults = await window.db.list('results', r => r.specimenId === specimen.id);
    const resultedTestIds = new Set(existingResults.map(r => r.testId));
    const pendingTestIds = order.testIds.filter(tid => !resultedTestIds.has(tid));
    if (pendingTestIds.length === 0) {
      // Nothing to generate, but the specimen might be stuck at `in_analysis`
      // with results already in. Run the completion check so catch-up scans
      // can rescue these.
      await maybeCompleteSpecimen(specimen.id);
      return;
    }

    // De-dupe scheduling per specimen — if we already have work pending,
    // cancel it and re-schedule with the latest pending set.
    if (__pending.has(specimen.id)) clearTimeout(__pending.get(specimen.id));

    const delay = SIM_DELAY_MIN_MS + Math.random() * (SIM_DELAY_MAX_MS - SIM_DELAY_MIN_MS);
    notify({
      kind: 'scheduled', specimenId: specimen.id,
      accession: specimen.accessionNumber, instrument: specimen.routedTo,
      tests: pendingTestIds.length,
      source: sourceLabel,
      eta: Date.now() + delay,
    });

    const handle = setTimeout(async () => {
      __pending.delete(specimen.id);
      try {
        // Re-fetch in case state changed (e.g., specimen rejected during the wait).
        const cur = await window.db.get('specimens', specimen.id);
        if (!cur || cur.state === 'rejected') return;
        const curOrder = await window.db.get('orders', cur.orderId);
        if (!curOrder) return;

        // Re-derive pending list at fire time so reflex tests added during the
        // delay window are also covered.
        const liveResults = await window.db.list('results', r => r.specimenId === cur.id);
        const liveResultedTestIds = new Set(liveResults.map(r => r.testId));
        const finalPending = curOrder.testIds.filter(tid => !liveResultedTestIds.has(tid));

        // Resolve patient demographics once for range picking on this specimen.
        const patient = curOrder.patientId ? await window.db.get('patients', curOrder.patientId) : null;
        for (const testId of finalPending) {
          const test = await window.db.get('tests', testId);
          if (!test) continue;
          // Pick a demographic-aware reference range and snapshot it onto the result
          // so the range used at result time is preserved even if the test catalog
          // is later edited.
          const picked = window.referenceRanges
            ? window.referenceRanges.pick(test, { patient, asOf: Date.now() })
            : { low: test.refRangeLow, high: test.refRangeHigh, units: test.units || '', source: 'fallback' };
          const value = randomValueAround(picked.low, picked.high);
          const flag = flagFromValue(value, picked.low, picked.high);
          const result = window.schema.newResult({
            specimenId: cur.id, testId: test.id,
            value, units: picked.units || test.units || '',
            refRangeLow: picked.low, refRangeHigh: picked.high,
            refRangeSource: picked.source,                       // 'matched' | 'default' | 'none'
            refRangeId: picked.matchedRange ? picked.matchedRange.id : null,
            flag, status: 'preliminary',
            instrumentId: cur.routedTo || null,
          });
          await window.db.put('results', result);
          window.events.publish(window.EVENTS.RESULT_RECEIVED, {
            entityType: 'result', entityId: result.id,
            result, specimen: cur, test, fromSimulator: true,
          });
          notify({
            kind: 'result', specimenId: cur.id,
            accession: cur.accessionNumber, instrument: cur.routedTo,
            test: test.code, name: test.name, value, units: test.units, flag,
            source: sourceLabel,
          });
        }

        // Re-evaluate completion via the shared helper so both the result-
        // generation path and the catch-up early-exit path use one rule.
        await maybeCompleteSpecimen(cur.id);
      } catch (e) {
        console.error('[instrument-sim] result generation failed', e);
        notify({ kind: 'error', specimenId: specimen.id, accession: specimen.accessionNumber, error: e.message || String(e) });
      }
    }, delay);

    __pending.set(specimen.id, handle);
  };

  const onSpecimenRouted = async (evt) => {
    const specimenId = evt.payload && evt.payload.entityId;
    if (specimenId) await runSpecimenWork(specimenId, 'routed');
  };

  // When an order changes (e.g., reflex adds a test), find any of its routed
  // specimens that now have unfilled tests and queue work for them.
  const onOrderChanged = async (evt) => {
    if (!__enabled) return;
    const orderId = evt.payload && evt.payload.entityId;
    if (!orderId) return;
    const specs = await window.db.list('specimens',
      s => s.orderId === orderId && (s.state === 'in_analysis' || s.state === 'completed')
    );
    for (const s of specs) {
      // If a previously completed specimen has new pending tests, drop it back to in_analysis
      // so the lifecycle stays honest.
      if (s.state === 'completed') {
        const existing = await window.db.list('results', r => r.specimenId === s.id);
        const resultedIds = new Set(existing.map(r => r.testId));
        const order = await window.db.get('orders', orderId);
        const hasPending = order && order.testIds.some(tid => !resultedIds.has(tid));
        if (hasPending) {
          try {
            await window.lifecycle.transition('specimens', s, 'in_analysis',
              { actor: 'sim', reason: 'reflex test added — re-routing' });
          } catch (e) {
            console.warn('[sim] reflex reopen via lifecycle failed', e);
            await window.db.put('specimens', { ...s, state: 'in_analysis' });
          }
        }
      }
      await runSpecimenWork(s.id, 'order-updated');
    }
  };

  // ── Catch-up scan ──────────────────────────────────────────────────────
  //
  // The simulator is event-driven: it queues work in response to
  // `specimen.routed` and `order.updated` events. That works fine for live
  // routing — the event fires, we schedule, results land. But it has two
  // failure modes that the user actually hits:
  //
  //   (a) Page reload while specimens are in flight. The events fired before
  //       the reload, are gone from the bus, and any in-progress timers were
  //       lost when the JS context died. The specimens sit at `in_analysis`
  //       with no instrument processing them.
  //
  //   (b) Stuck specimens — anything that landed at `in_analysis` without
  //       going through the canonical route flow (manual db edits, earlier
  //       iteration bugs, snapshot imports). Same outcome: the simulator
  //       never heard about them, never queues work.
  //
  // Catch-up scans every specimen at `in_analysis` that has unfilled tests
  // and queues `runSpecimenWork` for it. `runSpecimenWork` is already
  // idempotent (de-dupes per-specimen pending timers), so a catch-up call
  // that overlaps with a freshly-fired routed event is a no-op.
  //
  // The scan runs on:
  //   - start() — once at boot
  //   - setEnabled(true) — when the operator re-enables the sim after
  //     having disabled it (any specimens routed during the off-window
  //     have been waiting).
  //
  // Specimens at `received` are deliberately NOT picked up here — those
  // haven't been routed yet, and auto-routing without an instrument target
  // would silently skip the operator's choice. They surface in the
  // Worklists "Unrouted" bucket where the operator picks an analyzer.
  const catchUp = async (sourceLabel = 'catch-up') => {
    if (!__enabled) return;
    if (!window.db) return;
    try {
      const candidates = await window.db.list('specimens',
        s => s.state === 'in_analysis' && s.orderId);
      if (candidates.length === 0) return;
      log('catch-up scan: ' + candidates.length + ' specimen(s) in flight');
      // Run sequentially so each runSpecimenWork sees a consistent db view
      // (the function reads orders/results during scheduling).
      for (const s of candidates) {
        await runSpecimenWork(s.id, sourceLabel);
      }
    } catch (e) {
      console.error('[instrument-sim] catch-up failed', e);
    }
  };

  // ── Public surface ─────────────────────────────────────────────────────

  const start = () => {
    if (__started) return;
    if (!window.events || !window.db || !window.schema) { setTimeout(start, 0); return; }
    __started = true;
    window.events.subscribe(window.EVENTS.SPECIMEN_ROUTED, onSpecimenRouted);
    // Order changes fan out to any routed specimens — handles reflex-add-test.
    window.events.subscribe(window.EVENTS.ORDER_UPDATED, onOrderChanged);
    log('started — listening for specimen.routed + order.updated');
    // Defer catch-up so the rest of the boot finishes (schema + db settled,
    // page mounted, no surprise modal during the very first paint).
    setTimeout(() => catchUp('boot'), 1500);
  };

  window.instrumentSim = {
    start,
    setEnabled: (on) => {
      const wasEnabled = __enabled;
      __enabled = !!on;
      log('enabled =', __enabled);
      // Operator just turned the sim back on — any work queued while it was
      // off has been waiting. Run a catch-up so they don't have to manually
      // re-route every specimen.
      if (!wasEnabled && __enabled) setTimeout(() => catchUp('re-enable'), 100);
    },
    isEnabled:  () => __enabled,
    subscribe:  (fn) => { __subs.add(fn); return () => __subs.delete(fn); },
    getRecent:  (n) => __activity.slice(0, n || 20),
    // Exposed for the InstrumentManager admin "Re-scan" button and tests.
    catchUp,
  };

  start();
})();
