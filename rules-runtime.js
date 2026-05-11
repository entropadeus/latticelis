// rules-runtime.js — Lattice LIS rule evaluator
//
// Subscribes to every lifecycle event from events.js. For each event:
//   1. Find enabled rules whose `trigger` matches the event topic
//   2. Build an evaluation context (event payload + db-backfilled relations)
//   3. Evaluate the rule's condition tree against the context
//   4. If matched, execute actions in order; record results
//   5. Update rule stats (runs / matches / lastRun)
//   6. Publish `rule.fired` so the audit log captures it
//
// Cycle safety: rule.fired is filtered out at the top of onEvent so rules don't
// recursively trigger themselves through their own audit events. Actions that
// publish lifecycle events (route → specimen.routed, autoVerify → result.verified)
// will still fan back through the runtime — that's the intended cascade behavior.
// Pathological loops (rule A's action triggers rule B, B triggers A) are NOT
// detected here; they're a rule-design problem and surface immediately when seen.

(function () {

  // -- Trigger → event-topic mapping ----------------------------------------
  // Most rule trigger IDs in rules-library.jsx match events.js topic IDs 1:1.
  // The remaining synonyms are mapped here so existing rules continue to work.
  const TRIGGER_TO_EVENT = {
    'order.modified': 'order.updated',
    'result.amended': 'result.released',
    // Legacy tat.threshold trigger fires on either TAT event published by tat-watcher.
    'tat.threshold':  ['order.tat.warned', 'order.tat.breached'],
  };

  const matchesTrigger = (ruleTrigger, eventType) => {
    const mapped = TRIGGER_TO_EVENT[ruleTrigger] || ruleTrigger;
    if (Array.isArray(mapped)) return mapped.includes(eventType);
    return mapped === eventType;
  };

  // -- Condition tree evaluator ---------------------------------------------

  const evaluateConditionTree = (node, ctx) => {
    if (!node) return true;

    // Group node: { kind: 'group', op: 'AND'|'OR', children: [...] }
    // The tree root has no `kind` but has `op` + `children`.
    const isGroup = node.kind === 'group' || (node.op && Array.isArray(node.children));
    if (isGroup) {
      const op = node.op || 'AND';
      const kids = node.children || [];
      // Empty group is vacuously true — a rule with no conditions always matches.
      if (kids.length === 0) return true;
      if (op === 'AND') return kids.every(k => evaluateConditionTree(k, ctx));
      if (op === 'OR')  return kids.some(k => evaluateConditionTree(k, ctx));
      return true;
    }

    // Leaf condition: { kind: 'cond', primitive, args, negate }
    if (node.kind === 'cond') {
      const fn = CONDITION_EVALUATORS[node.primitive];
      let result;
      if (!fn) {
        // Unknown primitive — treat as no-match so an unimplemented predicate
        // can't accidentally fire a rule. Surfaces in console for the rule author.
        console.warn('[rules-runtime] no evaluator for primitive', node.primitive, '— treating as false');
        result = false;
      } else {
        try { result = !!fn(node.args || {}, ctx); }
        catch (e) {
          console.error('[rules-runtime] evaluator threw for', node.primitive, e);
          result = false;
        }
      }
      return node.negate ? !result : result;
    }

    return true;
  };

  // -- Condition primitive evaluators ---------------------------------------
  // (args, ctx) => bool. ctx fields: event, order, specimen, patient, result, test, instrument.
  // Implemented evaluators reflect the shapes our pipeline currently produces.
  // Stubs for primitives we don't have data for yet — they always return false
  // (safer than true when we lack the inputs).

  const CONDITION_EVALUATORS = {
    // Source / order
    'order.facility.is':   (a, c) => !!c.order && c.order.facility === a.facility,
    'order.priority.is':   (a, c) => {
      const dataPri = (c.order && c.order.priority) || '';
      const argPri  = String(a.priority || '');
      // Rule editor uses 'STAT'/'ASAP'/'Routine'/'Timed'; data uses lowercase 'stat'/'asap'/'routine'.
      return dataPri.toUpperCase() === argPri.toUpperCase();
    },
    'order.provider.npi.is': (a, c) => !!c.order && (c.order.providerId || '').includes(a.npi || ''),

    // Test
    'test.code.is':       (a, c) => !!c.test && c.test.code === a.code,
    'test.code.in':       (a, c) => !!c.test && Array.isArray(a.codes) && a.codes.includes(c.test.code),
    'test.loinc.matches': (a, c) => !!c.test && c.test.loinc === a.loinc,

    // Specimen
    'specimen.type.is':      (a, c) => !!c.specimen && c.specimen.type === a.type,
    'specimen.container.is': (a, c) => !!c.specimen && c.specimen.container === a.container,
    'specimen.volume.lt':    (a, c) => {
      if (!c.specimen || c.specimen.volume == null) return false;
      return Number(c.specimen.volume) < Number(a.volume);
    },
    'specimen.age.gt': (a, c) => {
      if (!c.specimen || !c.specimen.collectedAt) return false;
      const hours = (Date.now() - c.specimen.collectedAt) / 3600000;
      return hours > Number(a.hours);
    },
    'specimen.hemolyzed': (a, c) => !!c.specimen && (c.specimen.flags || []).includes('hemolyzed'),
    'specimen.lipemic':   (a, c) => !!c.specimen && (c.specimen.flags || []).includes('lipemic'),

    // Patient
    'patient.age.between': (a, c) => {
      if (!c.patient || !c.patient.dob) return false;
      const dob = new Date(c.patient.dob).getTime();
      if (isNaN(dob)) return false;
      const yrs = (Date.now() - dob) / (365.25 * 24 * 3600 * 1000);
      return yrs >= Number(a.min) && yrs <= Number(a.max);
    },
    'patient.sex.is': (a, c) => !!c.patient && c.patient.sex === a.sex,

    // Result
    'result.value.gt':      (a, c) => !!c.result && Number(c.result.value) > Number(a.value),
    'result.value.lt':      (a, c) => !!c.result && Number(c.result.value) < Number(a.value),
    'result.value.between': (a, c) => {
      if (!c.result || c.result.value == null) return false;
      const v = Number(c.result.value);
      return v >= Number(a.min) && v <= Number(a.max);
    },
    'result.flag.is':     (a, c) => !!c.result && c.result.flag === a.flag,
    'result.outside.ref': (a, c) => {
      if (!c.result) return false;
      return ['L','H','LL','HH'].includes(c.result.flag);
    },
    // Delta check: compare current value to most-recent prior result for the same
    // (patient, test). True if absolute % change exceeds the arg threshold.
    // Synchronous evaluator constraints — we precompute deltaPct on the result
    // entity in onEvent before evaluation. If not present, returns false.
    'result.delta.gt': (a, c) => {
      if (!c.result || c.result.deltaPct == null) return false;
      return Math.abs(c.result.deltaPct) > Number(a.pct);
    },
    // Per-test delta check — reads deltaCheckPercent / deltaCheckAbsolute from the
    // test record in ctx. Fires when EITHER configured threshold is exceeded.
    // If neither field is set on the test, returns false (no gate to match).
    // Requires the delta precomputation block (see onEvent) to have stamped
    // deltaPct and deltaAbs onto ctx.result; otherwise returns false safely.
    'result.delta.test': (a, c) => {
      if (!c.result || !c.test || c.result.deltaPct == null) return false;
      const exceedsPct = Number.isFinite(c.test.deltaCheckPercent) && c.test.deltaCheckPercent > 0
        && Math.abs(c.result.deltaPct) > c.test.deltaCheckPercent;
      const exceedsAbs = Number.isFinite(c.test.deltaCheckAbsolute) && c.test.deltaCheckAbsolute > 0
        && c.result.deltaAbs != null && Math.abs(c.result.deltaAbs) > c.test.deltaCheckAbsolute;
      return exceedsPct || exceedsAbs;
    },

    // Time
    'time.day.in': (a) => {
      const days = a.days || [];
      const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date().getDay()];
      return days.includes(dow);
    },
    'time.hour.between': (a) => {
      const parseHour = (s) => parseInt(String(s || '').split(':')[0], 10);
      const start = parseHour(a.start);
      const end   = parseHour(a.end);
      if (isNaN(start) || isNaN(end)) return false;
      const h = new Date().getHours();
      // Wraps midnight if end < start: 22 → 06 means 22..23 OR 0..5
      return start <= end ? (h >= start && h < end) : (h >= start || h < end);
    },

    // TAT state — reads tatBreachLevel written by tat-watcher onto the order entity.
    // If the order hasn't been scanned yet (new, or watcher hasn't run) the field is
    // absent and both conditions return false — safe default: no false-positive alerts.
    'order.tat.warned':   (a, c) => !!c.order && c.order.tatBreachLevel === 'warn',
    'order.tat.breached': (a, c) => !!c.order && c.order.tatBreachLevel === 'breach',

    // TAT elapsed — computes directly from order.orderedAt minus stored pause time.
    // Does not need cfg/testsById; the pause accounting matches what tat-watcher stores.
    'tat.elapsed.gt': (a, c) => {
      if (!c.order || !c.order.orderedAt) return false;
      const pausedMs = Math.max(0, Number(c.order.tatPausedMs) || 0);
      const elapsedMin = Math.max(0, (Date.now() - c.order.orderedAt - pausedMs) / 60000);
      return elapsedMin > Number(a.minutes);
    },

    // Stubs — explicit so console doesn't warn about every primitive in catalog
    'order.location.is':         (a, c) => !!c.location && (c.location.id === a.location || c.location.name === a.location),
    'order.payer.is':            () => false,
    'order.source.is':           () => false,
    'test.panel.contains':       () => false,
    'test.department.is':        () => false,
    'specimen.temp.outside':     () => false,
    'patient.pregnant':          () => false,
    'patient.fasting':           () => false,
    // result.delta.gt is now a real evaluator above — see "Delta check" comment.
    'time.holiday':              () => false,
    'message.type.is':           () => false,
    'message.field.matches':     () => false,
    'message.field.missing':     () => false,
    'interface.is':              () => false,
  };

  // -- Action executors -----------------------------------------------------
  // (args, ctx) => Promise<{ ok: bool, ... }>. Side effects on the db allowed.
  // Real execution where we have data; explicit stubs for primitives that need
  // wiring we haven't built yet (label printing, HL7 send, etc.).

  const auditAction = async (msg, c) => {
    if (!window.schema || !window.db) return { ok: false, reason: 'no schema/db' };
    const audit = window.schema.newAuditEvent({
      type: 'rule.audit', actor: 'rules',
      entityType: c.specimen ? 'specimen' : c.order ? 'order' : c.result ? 'result' : null,
      entityId: (c.specimen && c.specimen.id) || (c.order && c.order.id) || (c.result && c.result.id) || null,
      payload: { message: msg },
    });
    await window.db.put('audit_events', audit);
    return { ok: true };
  };

  const ACTION_EXECUTORS = {
    // -- Routing -----------------------------------------------------------
    'route.to.lab': async (a, c) => {
      if (!c.specimen) return { ok: false, reason: 'no specimen in context' };
      try {
        const updated = await window.lifecycle.transition('specimens',
          { ...c.specimen, routedTo: a.lab || null }, 'in_analysis',
          { actor: 'rule', reason: 'route.to.lab → ' + (a.lab || '?') });
        window.events.publish(window.EVENTS.SPECIMEN_ROUTED, {
          entityType: 'specimen', entityId: updated.id, specimen: updated,
          target: a.lab, viaRule: true,
        });
        return { ok: true, target: a.lab };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },
    'route.to.analyzer': async (a, c) => {
      if (!c.specimen) return { ok: false, reason: 'no specimen in context' };
      try {
        const updated = await window.lifecycle.transition('specimens',
          { ...c.specimen, routedTo: a.analyzer || null }, 'in_analysis',
          { actor: 'rule', reason: 'route.to.analyzer → ' + (a.analyzer || '?') });
        window.events.publish(window.EVENTS.SPECIMEN_ROUTED, {
          entityType: 'specimen', entityId: updated.id, specimen: updated,
          target: a.analyzer, viaRule: true,
        });
        return { ok: true, target: a.analyzer };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },
    'route.to.dept': async (a, c) => {
      if (!c.specimen) return { ok: false, reason: 'no specimen in context' };
      const updated = { ...c.specimen, routedTo: a.dept || null };
      await window.db.put('specimens', updated);
      return { ok: true, target: a.dept };
    },

    // -- Validation --------------------------------------------------------
    'order.hold': async (a, c) => {
      if (!c.order) return { ok: false, reason: 'no order in context' };
      const note = 'HELD: ' + (a.reason || '');
      const updated = { ...c.order, notes: c.order.notes ? c.order.notes + '\n' + note : note };
      await window.db.put('orders', updated);
      await auditAction('order held: ' + (a.reason || ''), c);
      return { ok: true };
    },
    'order.reject': async (a, c) => {
      if (!c.order) return { ok: false, reason: 'no order in context' };
      const note = 'REJECTED: ' + (a.reason || '');
      try {
        const updated = await window.lifecycle.transition('orders',
          { ...c.order, notes: c.order.notes ? c.order.notes + '\n' + note : note },
          'cancelled', { actor: 'rule', reason: a.reason || 'rule rejected' });
        window.events.publish(window.EVENTS.ORDER_CANCELLED, {
          entityType: 'order', entityId: updated.id, order: updated,
          reason: a.reason, viaRule: true,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },
    'order.flag': async (a, c) => {
      if (!c.order) return { ok: false, reason: 'no order in context' };
      const flags = Array.isArray(c.order.flags) ? [...c.order.flags] : [];
      const tag = a.queue ? 'queue:' + a.queue : 'flagged';
      if (!flags.includes(tag)) flags.push(tag);
      await window.db.put('orders', { ...c.order, flags });
      return { ok: true, flag: tag };
    },

    // -- Reflex / cascade --------------------------------------------------
    'order.reflex.add': async (a, c) => {
      if (!c.order || !a.test) return { ok: false, reason: 'no order or test arg' };
      // Find by code; if missing, create a stub test entry so the order can reference it.
      let test = (await window.db.list('tests', t => t.code === a.test))[0];
      if (!test) {
        test = window.schema.newTest({ code: a.test, name: a.test });
        await window.db.put('tests', test);
      }
      const existingTestIds = Array.isArray(c.order.testIds) ? c.order.testIds : [];
      if (existingTestIds.includes(test.id)) return { ok: true, alreadyPresent: true };
      const updated = { ...c.order, testIds: [...existingTestIds, test.id] };
      await window.db.put('orders', updated);
      // Emit order.updated so the simulator can fan out to routed specimens
      // and emit results for the new test (closes the reflex cascade).
      window.events.publish(window.EVENTS.ORDER_UPDATED, {
        entityType: 'order', entityId: updated.id, order: updated,
        viaRule: true, addedTestId: test.id,
      });
      await auditAction('reflex added test ' + a.test, c);
      return { ok: true, addedTestId: test.id };
    },
    'order.reflex.cancel': async (a, c) => {
      if (!c.order || !a.test) return { ok: false, reason: 'no order or test arg' };
      const test = (await window.db.list('tests', t => t.code === a.test))[0];
      const existingTestIds = Array.isArray(c.order.testIds) ? c.order.testIds : [];
      if (!test || !existingTestIds.includes(test.id)) return { ok: true, notPresent: true };
      const updated = { ...c.order, testIds: existingTestIds.filter(id => id !== test.id) };
      await window.db.put('orders', updated);
      window.events.publish(window.EVENTS.ORDER_UPDATED, {
        entityType: 'order', entityId: updated.id, order: updated,
        viaRule: true, removedTestId: test.id,
      });
      await auditAction('reflex cancelled test ' + a.test, c);
      return { ok: true, removedTestId: test.id };
    },

    // -- Result handling ---------------------------------------------------
    'result.flag.set': async (a, c) => {
      if (!c.result) return { ok: false, reason: 'no result in context' };
      await window.db.put('results', { ...c.result, flag: a.flag || '' });
      return { ok: true, flag: a.flag };
    },
    'result.comment.append': async (a, c) => {
      if (!c.result) return { ok: false, reason: 'no result in context' };
      const comments = c.result.comments
        ? c.result.comments + '\n' + (a.text || '')
        : (a.text || '');
      await window.db.put('results', { ...c.result, comments });
      return { ok: true };
    },
    'result.autoVerify': async (a, c) => {
      if (!c.result) return { ok: false, reason: 'no result in context' };
      try {
        const updated = await window.lifecycle.transition('results',
          { ...c.result, verifiedAt: Date.now(), verifiedBy: 'auto' }, 'final',
          { actor: 'rule', reason: 'auto-verify rule' });
        window.events.publish(window.EVENTS.RESULT_VERIFIED, {
          entityType: 'result', entityId: updated.id, result: updated,
          auto: true, viaRule: true,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e.message };
      }
    },
    'result.holdRelease': async (a, c) => {
      if (!c.result) return { ok: false, reason: 'no result in context' };
      // Mark the result as held (no `held` status in the schema today; encode via comment + status).
      const note = 'HELD by rule';
      const comments = c.result.comments ? c.result.comments + '\n' + note : note;
      await window.db.put('results', { ...c.result, comments });
      await auditAction('result release held', c);
      return { ok: true };
    },

    // -- Notifications -----------------------------------------------------
    // No notifications UI yet — log to audit so the action is observable.
    'notify.user': async (a, c) => {
      window.events.publish('notification', { kind: 'user', target: a.user || '?', msg: a.msg || '', viaRule: true, ctx: { orderId: c.order && c.order.id, specimenId: c.specimen && c.specimen.id, resultId: c.result && c.result.id } });
      return auditAction('notify user ' + (a.user || '?') + ': ' + (a.msg || ''), c);
    },
    'notify.role': async (a, c) => {
      window.events.publish('notification', { kind: 'role', target: a.role || '?', msg: a.msg || '', viaRule: true, ctx: { orderId: c.order && c.order.id, specimenId: c.specimen && c.specimen.id, resultId: c.result && c.result.id } });
      return auditAction('notify role ' + (a.role || '?') + ': ' + (a.msg || ''), c);
    },
    'notify.provider': async (a, c) => {
      window.events.publish('notification', { kind: 'provider', target: c.order && c.order.providerId || 'ordering provider', msg: 'Provider notification via ' + (a.channel || 'unknown'), viaRule: true, ctx: { orderId: c.order && c.order.id, resultId: c.result && c.result.id } });
      return auditAction('notify ordering provider via ' + (a.channel || 'unknown'), c);
    },
    'notify.critical': async (a, c) => {
      if (c.result) {
        window.events.publish(window.EVENTS.RESULT_CRITICAL, {
          entityType: 'result', entityId: c.result.id, result: c.result, viaRule: true,
        });
      }
      await auditAction('critical callback triggered', c);
      return { ok: true };
    },

    // -- Audit / metadata --------------------------------------------------
    'audit.log': async (a, c) => auditAction(a.msg || '', c),
    'tag.add': async (a, c) => {
      // Apply to whichever entity is in scope, preferring the most-specific.
      const target = c.result   ? { coll: 'results',   e: c.result,   label: 'result' }
                  : c.specimen ? { coll: 'specimens', e: c.specimen, label: 'specimen ' + (c.specimen.accessionNumber || c.specimen.barcode || c.specimen.id.slice(-6)) }
                  : c.order    ? { coll: 'orders',    e: c.order,    label: 'order ' + (c.order.orderNumber || c.order.id.slice(-6)) }
                  : null;
      if (!target) return { ok: false, reason: 'no taggable entity' };
      const flags = Array.isArray(target.e.flags) ? [...target.e.flags] : [];
      const already = a.tag && flags.includes(a.tag);
      if (a.tag && !already) flags.push(a.tag);
      await window.db.put(target.coll, { ...target.e, flags });
      await auditAction(`tagged ${target.label} "${a.tag || ''}"${already ? ' (already present)' : ''}`, c);
      return { ok: true, target: target.coll, tag: a.tag, already };
    },

    // -- Stubs (still wire up the audit so the activity is visible) --------
    'route.to.refLab':      async (a, c) => auditAction('STUB route.to.refLab → ' + (a.refLab || '?'), c),
    'route.split':          async (a, c) => auditAction('STUB route.split count=' + (a.count || 0), c),
    'order.requireDx':      async (_, c) => auditAction('STUB order.requireDx', c),
    'order.requireAuth':    async (_, c) => auditAction('STUB order.requireAuth', c),
    'order.duplicate.warn': async (a, c) => {
      if (!c.order) return { ok: false, reason: 'no order in context' };
      const hours = Math.max(0.1, Number(a.hours) || 24);
      const since = Date.now() - hours * 3600000;
      const patientId = c.order.patientId;
      if (!patientId) return { ok: true, found: 0 };
      const recentOrders = await window.db.list('orders', o =>
        o.patientId === patientId && o.id !== c.order.id && (o.createdAt || 0) >= since
      );
      const currentTestIds = new Set(Array.isArray(c.order.testIds) ? c.order.testIds : []);
      const duplicates = recentOrders.filter(o => (o.testIds || []).some(tid => currentTestIds.has(tid)));
      if (duplicates.length === 0) return { ok: true, found: 0 };
      window.events.publish('notification', {
        kind: 'system',
        msg: `Duplicate order: ${duplicates.length} recent order(s) for this patient share test(s) with ${c.order.orderNumber || c.order.id.slice(-6)} (within ${hours}h).`,
        viaRule: true,
        ctx: { orderId: c.order.id, duplicateOrderIds: duplicates.map(o => o.id) },
      });
      await auditAction(`duplicate.warn: ${duplicates.length} duplicate(s) within ${hours}h`, c);
      return { ok: true, found: duplicates.length };
    },
    'order.reflex.replace': async (a, c) => {
      if (!c.order || !a.from || !a.to) return { ok: false, reason: 'missing order or from/to args' };
      const cancelResult = await ACTION_EXECUTORS['order.reflex.cancel']({ test: a.from }, c);
      if (!cancelResult.ok && !cancelResult.notPresent) return cancelResult;
      // Re-fetch the order so the add sees the cancel's removal of testIds.
      const freshOrder = await window.db.get('orders', c.order.id);
      const addResult = await ACTION_EXECUTORS['order.reflex.add']({ test: a.to }, { ...c, order: freshOrder });
      if (!addResult.ok) return addResult;
      await auditAction(`reflex.replace ${a.from} → ${a.to}`, c);
      return { ok: true, from: a.from, to: a.to, addedTestId: addResult.addedTestId };
    },
    'order.panel.expand':   async (_, c) => auditAction('STUB panel.expand', c),
    'result.range.apply':   async (a, c) => auditAction('STUB range.apply ' + (a.range || '?'), c),
    'message.send.hl7':     async (a, c) => auditAction('STUB hl7.send ' + (a.type || '?') + ' via ' + (a.iface || '?'), c),
    'message.transform':    async (a, c) => auditAction('STUB hl7.transform ' + (a.path || '?'), c),
    'label.print':          async (a, c) => auditAction('STUB label.print ' + (a.template || '?'), c),
    'report.generate':      async (a, c) => auditAction('STUB report.generate ' + (a.template || '?'), c),
    'metric.increment':     async (a, c) => auditAction('STUB metric.increment ' + (a.metric || '?'), c),
  };

  // Stub detection — self-maintaining: when a stub is implemented (function body
  // changes from `() => false` or stops containing 'STUB '), it drops out naturally.
  const STUB_COND_IDS = new Set(
    Object.entries(CONDITION_EVALUATORS)
      .filter(([, fn]) => /=>\s*false\s*$/.test(fn.toString().trim()))
      .map(([k]) => k)
  );
  const STUB_ACTION_IDS = new Set(
    Object.entries(ACTION_EXECUTORS)
      .filter(([, fn]) => fn.toString().includes("'STUB "))
      .map(([k]) => k)
  );

  // -- Context builder ------------------------------------------------------
  // Pulls related entities from the db so condition primitives can reference
  // patient.age even when only specimen is in the event payload, etc.

  const buildContext = async (evt) => {
    const p = evt.payload || {};
    const ctx = { event: evt };

    if (p.order)      ctx.order      = p.order;
    if (p.specimen)   ctx.specimen   = p.specimen;
    if (p.patient)    ctx.patient    = p.patient;
    if (p.result)     ctx.result     = p.result;
    if (p.test)       ctx.test       = p.test;
    if (p.instrument) ctx.instrument = p.instrument;

    // Backfill from db where we have an id but not the entity itself.
    // orderId in payload covers TAT events (order.tat.warned / order.tat.breached)
    // which carry orderId but not the full order object.
    if (!ctx.order && p.orderId) {
      ctx.order = await window.db.get('orders', p.orderId);
    }
    if (ctx.specimen && !ctx.order && ctx.specimen.orderId) {
      ctx.order = await window.db.get('orders', ctx.specimen.orderId);
    }
    if (ctx.specimen && !ctx.patient && ctx.specimen.patientId) {
      ctx.patient = await window.db.get('patients', ctx.specimen.patientId);
    }
    if (ctx.order && !ctx.patient && ctx.order.patientId) {
      ctx.patient = await window.db.get('patients', ctx.order.patientId);
    }
    if (ctx.result && !ctx.specimen && ctx.result.specimenId) {
      ctx.specimen = await window.db.get('specimens', ctx.result.specimenId);
    }
    if (ctx.result && !ctx.test && ctx.result.testId) {
      ctx.test = await window.db.get('tests', ctx.result.testId);
    }
    if (ctx.order && ctx.order.locationId && !ctx.location) {
      ctx.location = await window.db.get('locations', ctx.order.locationId);
    }

    return ctx;
  };

  // After each successful action, re-fetch the entities in ctx so the next
  // action sees the previous action's mutations. Without this, sequential
  // actions on the same entity (e.g., flag.set then comment.append) trample
  // each other because both spread from the original snapshot.
  const refreshContext = async (ctx) => {
    const next = { event: ctx.event };
    if (ctx.order)      next.order      = await window.db.get('orders', ctx.order.id);
    if (ctx.specimen)   next.specimen   = await window.db.get('specimens', ctx.specimen.id);
    if (ctx.patient)    next.patient    = await window.db.get('patients', ctx.patient.id);
    if (ctx.result)     next.result     = await window.db.get('results', ctx.result.id);
    if (ctx.test)       next.test       = await window.db.get('tests', ctx.test.id);
    if (ctx.instrument) next.instrument = await window.db.get('instruments', ctx.instrument.id);
    if (ctx.location)   next.location   = await window.db.get('locations',   ctx.location.id);
    return next;
  };

  // -- Runtime entry point --------------------------------------------------

  let __started = false;

  const onEvent = async (evt) => {
    try {
      // Filter rule-emitted events so a rule can't trigger itself via its own audit.
      // Rules CAN trigger other rules through entity-state events (route → routed),
      // and that cascade is intentional.
      if (evt.type === window.EVENTS.RULE_FIRED) return;
      if (evt.type === 'rule.audit') return;

      const matchingRules = await window.db.list(
        'rules',
        r => r.enabled && matchesTrigger(r.trigger, evt.type)
      );
      if (matchingRules.length === 0) return;

      let ctx = await buildContext(evt);

      // Pre-compute delta-check on the current result against the patient's
      // most recent prior result for the same test, so the synchronous
      // result.delta.gt evaluator has it available.
      if (ctx.result && ctx.result.value != null && ctx.result.testId && ctx.specimen && ctx.specimen.patientId) {
        const priors = await window.db.list('results', r =>
          r.testId === ctx.result.testId &&
          r.id !== ctx.result.id &&
          r.specimenId !== ctx.result.specimenId &&  // exclude same draw
          r.value != null
        );
        // Filter to same patient (via specimen lookup) — this is O(N) but N is small.
        const sameSpecs = await window.db.list('specimens', s => s.patientId === ctx.specimen.patientId);
        const sameSpecIds = new Set(sameSpecs.map(s => s.id));
        const priorMatches = priors
          .filter(r => sameSpecIds.has(r.specimenId))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (priorMatches.length > 0) {
          const prior = priorMatches[0];
          if (prior.value != null && Number(prior.value) !== 0) {
            const deltaAbs = Number(ctx.result.value) - Number(prior.value);
            const pct = (deltaAbs / Number(prior.value)) * 100;
            ctx = { ...ctx, result: { ...ctx.result, deltaPct: pct, deltaAbs, deltaPriorId: prior.id } };
          }
        }
      }

      for (const rule of matchingRules) {
        const matched = evaluateConditionTree(rule.conditions, ctx);

        // Always increment runs; only increment matches when conditions held.
        const prevStats = rule.stats || { runs: 0, matches: 0, lastRun: null };
        const next = {
          ...rule,
          stats: {
            runs: (prevStats.runs || 0) + 1,
            matches: (prevStats.matches || 0) + (matched ? 1 : 0),
            lastRun: Date.now(),
            lastMatched: matched ? Date.now() : prevStats.lastMatched || null,
          },
        };
        await window.db.put('rules', next);

        if (!matched) continue;

        const actionResults = [];
        for (const action of (rule.actions || [])) {
          const fn = ACTION_EXECUTORS[action.primitive];
          if (!fn) {
            actionResults.push({ primitive: action.primitive, ok: false, reason: 'no executor' });
            continue;
          }
          try {
            const r = await fn(action.args || {}, ctx);
            actionResults.push({ primitive: action.primitive, ...r });
            // Refresh ctx so the next action in this rule sees the mutation.
            // Skipped on stub/no-op results to avoid extra reads.
            if (r && r.ok && !r.stub) ctx = await refreshContext(ctx);
          } catch (e) {
            console.error('[rules-runtime] action threw:', action.primitive, e);
            actionResults.push({
              primitive: action.primitive, ok: false, error: e.message || String(e),
            });
          }
        }

        window.events.publish(window.EVENTS.RULE_FIRED, {
          entityType: 'rule', entityId: rule.id,
          ruleId: rule.id, ruleName: rule.name,
          eventType: evt.type, actionResults,
        });
      }
    } catch (e) {
      console.error('[rules-runtime] onEvent failed', e);
    }
  };

  // Serialize event processing so multiple events firing in quick succession
  // don't race on rule.stats writes (each onEvent reads-then-writes the rule).
  // Side benefit: action chains within a rule complete before the next event
  // is processed — predictable ordering for downstream observers.
  let __queue = Promise.resolve();
  const onEventSerial = (evt) => {
    __queue = __queue.then(() => onEvent(evt))
      .catch(e => console.error('[rules-runtime] queue error', e));
  };

  const start = () => {
    if (__started) return;
    if (!window.events || !window.db || !window.schema) {
      // Pipeline not yet loaded — try again on next tick.
      setTimeout(start, 0);
      return;
    }
    __started = true;
    window.events.subscribe('*', onEventSerial);
    console.info('[rules-runtime] subscribed to lifecycle events (serialized)');
  };

  // Public surface — kept small. Test harness can call evaluateConditionTree
  // and buildContext directly.
  window.rulesRuntime = {
    start,
    evaluateConditionTree,
    buildContext,
    CONDITION_EVALUATORS,
    ACTION_EXECUTORS,
    STUB_COND_IDS,
    STUB_ACTION_IDS,
  };

  start();
})();
