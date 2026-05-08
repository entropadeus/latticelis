// events.js — Lifecycle event bus for the LIS pipeline
//
// Two layers of reactivity in the system:
//   1. db.subscribe(collection, fn)   — fires after every write to that collection (raw)
//   2. events.publish(type, payload)  — fires on semantic moments (order.created, …)
//
// The rules runtime listens to the semantic layer. Pages mostly reactivize through db
// (via useEntities), but anything that wants event-driven behavior listens here.
//
// Every published event is also written to the audit_events collection automatically,
// so we get an append-only audit trail for free.

const EVENTS = {
  ORDER_CREATED:      'order.created',
  ORDER_UPDATED:      'order.updated',
  ORDER_CANCELLED:    'order.cancelled',
  SPECIMEN_COLLECTED: 'specimen.collected',
  SPECIMEN_RECEIVED:  'specimen.received',
  SPECIMEN_REJECTED:  'specimen.rejected',
  SPECIMEN_ROUTED:    'specimen.routed',
  SPECIMEN_COMPLETED: 'specimen.completed',
  RESULT_RECEIVED:    'result.received',
  RESULT_VERIFIED:    'result.verified',
  RESULT_RELEASED:    'result.released',
  RESULT_CRITICAL:    'result.critical',
  RESULT_CORRECTED:   'result.corrected',
  RESULT_DELIVERED:   'result.delivered',
  RESULT_DELIVERY_FAILED: 'result.delivery_failed',
  RULE_FIRED:         'rule.fired',
  NOTIFICATION:       'notification',
  // TAT (turnaround time) lifecycle. Published by `tat-watcher.js` when an
  // active order's elapsed time crosses the warn-threshold (`order.tat.warned`)
  // or the full breach threshold (`order.tat.breached`). The watcher also
  // republishes `notification` events with kind='role' so toasts/drawer/bell
  // surfaces light up without each subscriber needing to know about TAT.
  ORDER_TAT_WARNED:   'order.tat.warned',
  ORDER_TAT_BREACHED: 'order.tat.breached',
};

const __evSubs = new Map();  // event name OR '*' → Set<fn>

const events = {
  TYPES: EVENTS,

  publish: (type, payload = {}) => {
    const evt = { type, payload, ts: Date.now() };
    const fire = (set) => set && set.forEach(fn => {
      try { fn(evt); } catch (e) { console.error('[events] handler threw for ' + type, e); }
    });
    fire(__evSubs.get(type));
    fire(__evSubs.get('*'));

    // Persist to the audit log so the timeline survives reloads.
    if (window.schema && window.db) {
      const actor = payload.actor || 'system';
      // Frozen role snapshot at publish time. Caller can pre-resolve the
      // snapshot in payload.actorRoles (e.g. for cross-user attributions);
      // otherwise we look up the user in window.__userCache and snapshot
      // their current roles. Snapshot at publish-time means historical
      // events don't shift if a user's roles change later.
      let actorRoles = Array.isArray(payload.actorRoles) ? payload.actorRoles : null;
      if (!actorRoles && window.userRoles && actor && actor !== 'system' && actor !== 'auto' && actor !== 'rules') {
        actorRoles = window.userRoles.userRolesSnapshot(actor);
      }
      const audit = window.schema.newAuditEvent({
        type,
        actor,
        actorRoles: actorRoles || [],
        entityType: payload.entityType || null,
        entityId: payload.entityId || null,
        payload,
      });
      window.db.put('audit_events', audit).catch(err => {
        console.error('[events] audit persist failed', err);
      });
    }
    return evt;
  },

  subscribe: (type, fn) => {
    if (!__evSubs.has(type)) __evSubs.set(type, new Set());
    __evSubs.get(type).add(fn);
    return () => { __evSubs.get(type) && __evSubs.get(type).delete(fn); };
  },
};

window.events = events;
window.EVENTS = EVENTS;
