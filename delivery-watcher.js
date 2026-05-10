// delivery-watcher.js — auto-delivers released results to the ordering client.
//
// On `result.released`, walks: result → specimen → order → client. If the
// client has a deliveryChannel set, simulates the delivery (records the channel
// + endpoint + attempt timestamp on the result, publishes `result.delivered`).
// No network call is made here; attempts are local simulation records only.
// Real ASTM/HL7 plumbing replaces the "simulate" step in Tier 6 — the
// observable shape (delivery fields on the result) stays identical, so every
// page that displays delivery status keeps working.
//
// Critical results that are still unacknowledged DO NOT auto-deliver. They go
// to delivery_status='pending' so the lab can complete the critical-callback
// before the result lands at the clinic. (Real outreach LIS standard.)

(function () {

  const SUCCESS_RATE = 0.95;             // simulated delivery success rate
  const DELIVERY_DELAY_MS = 250;         // brief delay so the UI shows pending → delivered
  const CRITICAL_FLAGS = ['LL', 'HH', 'A', 'AA'];

  let __started = false;

  const isCriticalUnacked = (result) => {
    return CRITICAL_FLAGS.includes(result.flag) && !result.criticalAckedAt;
  };

  const recordAttempt = (result, attempt) => {
    const attempts = Array.isArray(result.deliveryAttempts) ? [...result.deliveryAttempts] : [];
    attempts.push(attempt);
    return attempts;
  };

  const onResultReleased = async (evt) => {
    try {
      const result = evt.payload && evt.payload.result;
      if (!result) return;
      // If already delivered (or in flight), don't re-fire.
      if (result.deliveredAt || result.deliveryStatus === 'delivered') return;

      const specimen = result.specimenId ? await window.db.get('specimens', result.specimenId) : null;
      const order = specimen && specimen.orderId ? await window.db.get('orders', specimen.orderId) : null;
      const client = order && order.clientId ? await window.db.get('clients', order.clientId) : null;

      // Channel resolution chain — order override > client default > manual.
      // Endpoint follows the channel that won (so a per-order endpoint only
      // applies when the per-order channel does too).
      let channel, endpoint, channelSource;
      if (order && order.deliveryChannel) {
        channel = order.deliveryChannel;
        endpoint = order.deliveryEndpoint || '';
        channelSource = 'order';
      } else if (client && client.deliveryChannel) {
        channel = client.deliveryChannel;
        endpoint = client.deliveryEndpoint || '';
        channelSource = 'client';
      } else {
        channel = 'manual';
        endpoint = '';
        channelSource = 'fallback';
      }

      // No client AND no order override → mark manual and stop.
      if (channelSource === 'fallback') {
        await window.db.put('results', {
          ...result, deliveryStatus: 'manual',
        });
        return;
      }

      // Critical-unacked → hold delivery until ack.
      if (isCriticalUnacked(result)) {
        await window.db.put('results', {
          ...result, deliveryStatus: 'pending',
        });
        return;
      }
      await window.db.put('results', {
        ...result, deliveryStatus: 'pending',
        deliveredVia: channel, deliveredTo: endpoint,
      });

      // Simulate the wire. Real backends (HL7 sender, fax modem, portal API)
      // replace this branch.
      setTimeout(async () => {
        try {
          const fresh = await window.db.get('results', result.id);
          if (!fresh) return;
          const success = Math.random() < SUCCESS_RATE;

          // For HL7 channel, build the actual ORU-R01 message and persist it
          // on the attempt so it can be inspected (and a real network sender
          // can pick it up later). When window.hl7Mllp is loaded, also produce
          // the MLLP-framed wire bytes (VT … FS+CR with CR-segment normalization)
          // — that's what would actually go on the socket in Tier 6.
          let hl7Payload = null;
          let framedPayload = null;
          if (channel === 'hl7' && window.hl7) {
            try {
              const patient = specimen && specimen.patientId ? await window.db.get('patients', specimen.patientId) : null;
              const allTests = await window.db.list('tests', t => order && order.testIds && order.testIds.includes(t.id));
              const testById = Object.fromEntries(allTests.map(t => [t.id, t]));
              hl7Payload = window.hl7.buildORU({
                patient, order, specimen,
                results: [fresh],
                testById,
              });
              if (hl7Payload && window.hl7Mllp) {
                framedPayload = window.hl7Mllp.frame(hl7Payload);
              }
            } catch (e) {
              console.warn('[delivery-watcher] ORU build failed', e);
            }
          }

          if (success) {
            const attempt = {
              at: Date.now(), via: channel, to: endpoint, outcome: 'delivered',
              payload: hl7Payload,
              framedPayload,
              framedBytes: framedPayload ? framedPayload.length : 0,
            };
            const updated = {
              ...fresh,
              deliveryStatus: 'delivered',
              deliveredAt: attempt.at,
              deliveredVia: channel,
              deliveredTo: endpoint,
              deliveryAttempts: recordAttempt(fresh, attempt),
              lastHl7Message: hl7Payload || fresh.lastHl7Message || null,
            };
            await window.db.put('results', updated);
            window.events.publish(window.EVENTS.RESULT_DELIVERED, {
              entityType: 'result', entityId: updated.id, result: updated,
              channel, endpoint, clientId: client && client.id, channelSource,
            });
          } else {
            const attempt = {
              at: Date.now(), via: channel, to: endpoint, outcome: 'failed', reason: 'simulated transient',
              payload: hl7Payload,
              framedPayload,
              framedBytes: framedPayload ? framedPayload.length : 0,
            };
            const updated = {
              ...fresh,
              deliveryStatus: 'failed',
              deliveryAttempts: recordAttempt(fresh, attempt),
            };
            await window.db.put('results', updated);
            window.events.publish(window.EVENTS.RESULT_DELIVERY_FAILED, {
              entityType: 'result', entityId: updated.id, result: updated,
              channel, endpoint, clientId: client && client.id, channelSource, reason: attempt.reason,
            });
          }
        } catch (e) {
          console.error('[delivery-watcher] delivery simulation failed', e);
        }
      }, DELIVERY_DELAY_MS);

    } catch (e) {
      console.error('[delivery-watcher] release handler failed', e);
    }
  };

  // Correction handler. When a corrected result is created via the
  // CorrectResultModal, the prior may have already been delivered. Real labs
  // re-send corrections as amendments — HL7 ORU with OBX-11='C', or a
  // re-fax/portal-update for non-HL7 channels. We simulate by stamping
  // releasedAt + releasedBy on the corrected record and republishing
  // RESULT_RELEASED, which routes through the existing delivery chain. The
  // ORU builder reads result.status='corrected' and emits OBX-11='C'
  // automatically (see hl7.js mapping), so the wire output is correct.
  //
  // If the prior was NOT released yet, we don't auto-release the correction
  // — the operator may want to verify the corrected value before reporting.
  // The "Release" action remains available on the corrected record.
  const onResultCorrected = async (evt) => {
    try {
      const corrected = evt.payload && evt.payload.result;
      const prior = evt.payload && evt.payload.prior;
      if (!corrected) return;
      // Only auto-release the correction when the prior was already out the door.
      if (!prior || !prior.releasedAt) return;

      const actor = evt.payload.actor || (window.currentUser ? window.currentUser.id : 'system');
      const updated = {
        ...corrected,
        releasedAt: Date.now(),
        releasedBy: actor,
        // Tag the delivery state so the UI shows "amendment in flight" rather
        // than a fresh release.
        deliveryStatus: 'pending',
      };
      await window.db.put('results', updated);
      // Re-fire RELEASED so the existing onResultReleased handler runs the
      // channel-resolution chain and produces a fresh delivery attempt.
      window.events.publish(window.EVENTS.RESULT_RELEASED, {
        entityType: 'result', entityId: updated.id, result: updated,
        actor, viaCorrection: true, supersedes: prior.id,
      });
    } catch (e) {
      console.error('[delivery-watcher] correction handler failed', e);
    }
  };

  // Manual re-send — exposed on window so the Results UI can drive it.
  // Skips channel auto-detection if `overrideChannel` is provided.
  const resend = async (resultId, overrideChannel, overrideEndpoint) => {
    const fresh = await window.db.get('results', resultId);
    if (!fresh) return false;
    // Reset to pending so the watcher will pick it up again on next release event.
    const channel = overrideChannel || fresh.deliveredVia;
    const endpoint = overrideEndpoint != null ? overrideEndpoint : fresh.deliveredTo;
    await window.db.put('results', {
      ...fresh, deliveredAt: null, deliveryStatus: 'pending',
    });
    window.events.publish(window.EVENTS.RESULT_RELEASED, {
      entityType: 'result', entityId: fresh.id, result: { ...fresh, deliveredAt: null, deliveryStatus: 'pending' },
      resend: true, channel, endpoint,
    });
    return true;
  };

  const start = () => {
    if (__started) return;
    if (!window.events || !window.db) { setTimeout(start, 0); return; }
    __started = true;
    window.events.subscribe(window.EVENTS.RESULT_RELEASED, onResultReleased);
    window.events.subscribe(window.EVENTS.RESULT_CORRECTED, onResultCorrected);
    console.info('[delivery-watcher] listening for result.released + result.corrected');
  };

  window.deliveryWatcher = { start, resend };
  start();
})();
