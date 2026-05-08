// lifecycle.js — Entity state transitions + completion cascade.
//
// Without a central place, every writer (Accessioning, rules-runtime route.* actions,
// the instrument simulator, Results verification) reaches into the db and sets state
// imperatively. That works in isolation but the system can't enforce invariants —
// nothing prevents an entity from skipping states, and nothing observes that
// completing a result should ripple up to the specimen and order.
//
// This module owns:
//   1. Canonical transition graphs (SPEC_TRANSITIONS / ORDER_TRANSITIONS / RESULT_TRANSITIONS)
//      so any writer can call lifecycle.canTransition() to check legality.
//   2. A single completion watcher that listens to result.verified and walks the chain:
//        result.verified  →  if all results for specimen are final  →  specimen.completed
//                          →  if all specimens for order are completed/rejected  →  order.completed
//      No page or feature has to know this rule — they just verify a result and the
//      system propagates the consequences.
//
// Keep this file pure-JS so it loads with the persistence pipeline before any UI script.

(function () {

  // ── Canonical transition graphs ──────────────────────────────────────────
  // From-state → list of allowed target states. Idempotent transitions
  // (state X → X) are always permitted by canTransition().

  const SPEC_TRANSITIONS = {
    pending:     ['in_transit', 'received', 'rejected'],
    in_transit:  ['received', 'rejected'],
    received:    ['in_analysis', 'rejected', 'completed'],
    in_analysis: ['completed', 'rejected'],
    // `completed → in_analysis` is the reflex-reopen path: a rule fired after
    // the specimen completed and added a new test, so we need to run more work.
    // Without it, the simulator would have to bypass the graph.
    completed:   ['in_analysis'],
    rejected:    [],
  };

  const ORDER_TRANSITIONS = {
    open:        ['in_progress', 'cancelled', 'completed'],
    in_progress: ['completed', 'cancelled'],
    completed:   [],
    cancelled:   [],
  };

  const RESULT_TRANSITIONS = {
    pending:           ['preliminary', 'cancelled'],
    preliminary:       ['final', 'cancelled', 'entered_in_error'],
    final:             ['corrected', 'cancelled'],
    corrected:         ['final', 'cancelled'],
    cancelled:         [],
    entered_in_error:  [],
  };

  const canTransition = (graph, from, to) => {
    if (from === to) return true;
    return (graph[from] || []).includes(to);
  };

  // ── Specimen "all tests resulted" check ───────────────────────────────────
  // Independent of result status — used for sanity probes and the watcher's
  // pre-condition. The simulator (or future instrument interface) is the
  // authoritative writer that flips specimen.state to 'completed'; this just
  // tells you whether there's enough data to do so.

  const specimenHasAllResults = async (specimen) => {
    if (!specimen || !specimen.orderId) return false;
    const order = await window.db.get('orders', specimen.orderId);
    if (!order || !order.testIds || order.testIds.length === 0) return false;
    const results = await window.db.list('results', r => r.specimenId === specimen.id);
    const haveTestIds = new Set(results.map(r => r.testId));
    return order.testIds.every(tid => haveTestIds.has(tid));
  };

  // ── Order completion check ────────────────────────────────────────────────
  // An order completes when:
  //   (a) at least one specimen exists for it, AND
  //   (b) every specimen is in a terminal state (completed or rejected), AND
  //   (c) every result attached to those specimens is at least final
  //       (preliminary results block completion — they're still pending review).
  //
  // Rejected specimens count toward (b): the specimen is clinically resolved
  // (sample bad), and a rejected specimen has no results to gate (c).

  const isOrderComplete = async (order) => {
    if (!order) return false;
    const specs = await window.db.list('specimens', s => s.orderId === order.id);
    if (specs.length === 0) return false;
    if (!specs.every(s => s.state === 'completed' || s.state === 'rejected')) return false;
    const specIds = new Set(specs.map(s => s.id));
    const results = await window.db.list('results', r => specIds.has(r.specimenId));
    return results.every(r => r.status === 'final' || r.status === 'corrected' || r.status === 'cancelled');
  };

  // ── Completion watcher ────────────────────────────────────────────────────
  // Single responsibility: when a relevant event fires, check whether the
  // parent order can complete. Specimen completion is owned by writers
  // (simulator, accessioning, manual) — this watcher just propagates upward.

  let __started = false;

  const checkOrderCompletion = async (orderId) => {
    if (!orderId) return false;
    const order = await window.db.get('orders', orderId);
    if (!order || order.status === 'completed' || order.status === 'cancelled') return false;
    if (!await isOrderComplete(order)) return false;
    // Eat our own dog food: go through transition() so the move is audited.
    let updated;
    try {
      updated = await transition('orders', order, 'completed',
        { actor: 'completion-watcher', reason: 'all specimens terminal + all results final' });
    } catch (e) {
      console.warn('[lifecycle] order completion via transition refused', e);
      return false;
    }
    window.events.publish(window.EVENTS.ORDER_UPDATED, {
      entityType: 'order', entityId: updated.id, order: updated,
      via: 'completion-watcher',
    });
    return true;
  };

  const onResultEvent = async (evt) => {
    try {
      const result = evt.payload && evt.payload.result;
      if (!result || !result.specimenId) return;
      const spec = await window.db.get('specimens', result.specimenId);
      if (spec && spec.orderId) await checkOrderCompletion(spec.orderId);
    } catch (e) {
      console.error('[lifecycle] result-event watcher failed', e);
    }
  };

  const onSpecimenCompleted = async (evt) => {
    try {
      const spec = evt.payload && evt.payload.specimen;
      if (spec && spec.orderId) await checkOrderCompletion(spec.orderId);
    } catch (e) {
      console.error('[lifecycle] spec-event watcher failed', e);
    }
  };

  const start = () => {
    if (__started) return;
    if (!window.events || !window.db) { setTimeout(start, 0); return; }
    __started = true;
    // Three triggers cover the cascade paths: a result becomes final, a result
    // gets released, or a specimen reaches its terminal state.
    window.events.subscribe(window.EVENTS.RESULT_VERIFIED, onResultEvent);
    window.events.subscribe(window.EVENTS.RESULT_RELEASED, onResultEvent);
    window.events.subscribe('specimen.completed',           onSpecimenCompleted);
    window.events.subscribe(window.EVENTS.SPECIMEN_REJECTED, onSpecimenCompleted);
    console.info('[lifecycle] completion watcher subscribed (4 triggers)');
  };

  // ── Guarded transition writer ────────────────────────────────────────────
  // The canonical way to change an entity's state. Validates the move against
  // the appropriate graph, writes through db.put, and emits a synthetic
  // `lifecycle.transition` event for audit trails. Returns the updated entity.
  // Throws on illegal transition rather than silently writing.
  //
  //   await lifecycle.transition('specimens', specimen, 'in_analysis', { actor, reason })
  //
  // We intentionally take collection name + record (rather than just an id)
  // so callers carry the snapshot and we don't race a stale read.
  const __graphs = {
    specimens: { graph: SPEC_TRANSITIONS,   field: 'state'  },
    orders:    { graph: ORDER_TRANSITIONS,  field: 'status' },
    results:   { graph: RESULT_TRANSITIONS, field: 'status' },
  };

  const transition = async (collection, entity, toState, opts = {}) => {
    const cfg = __graphs[collection];
    if (!cfg) throw new Error(`[lifecycle] unknown collection '${collection}' for transition`);
    if (!entity || !entity.id) throw new Error('[lifecycle] entity required');
    const from = entity[cfg.field];
    if (!canTransition(cfg.graph, from, toState)) {
      throw new Error(`[lifecycle] illegal ${collection} transition: ${from} → ${toState} (allowed: ${(cfg.graph[from] || []).join(', ') || '<none>'})`);
    }
    if (from === toState) return entity; // idempotent — no write, no event
    const updated = { ...entity, [cfg.field]: toState };
    await window.db.put(collection, updated);
    if (window.events) {
      window.events.publish('lifecycle.transition', {
        entityType: collection.replace(/s$/, ''), entityId: entity.id,
        collection, from, to: toState,
        actor: opts.actor || (window.currentUser ? window.currentUser.id : 'system'),
        reason: opts.reason || '',
      });
    }
    return updated;
  };

  window.lifecycle = {
    canTransition,
    SPEC_TRANSITIONS, ORDER_TRANSITIONS, RESULT_TRANSITIONS,
    specimenHasAllResults, isOrderComplete,
    checkOrderCompletion,
    transition,
    start,
  };

  start();
})();
