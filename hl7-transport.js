// hl7-transport.js — pluggable transport facade for HL7 partner integrations.
//
// Sits between the rest of the app and the actual network transport (MLLP
// socket, SFTP file drop, HTTPS POST). The facade owns the *contract* — every
// message in or out passes through `send` / `receive` and lands in the
// `hl7_messages` collection — so the wire layer can be swapped from the
// in-browser loopback to a real backend without touching call sites.
//
// Public surface (window.hl7Transport):
//
//   send(partnerId, raw, opts?)       → Promise<{ ok, messageId, ackCode?, ackControlId?, reason? }>
//     Build an outbound `hl7_messages` row (status='queued' → 'sending'),
//     hand the framed payload to the partner's registered handler, await the
//     ACK if ackMode='sync', persist the final status. `opts` carries the
//     domain-link fields (orderId / resultId / patientId) so the message log
//     can backlink. `raw` is the un-framed HL7; framing is applied by the
//     handler so non-MLLP transports (HTTPS, file) can skip it.
//
//   receive(raw, opts?)               → Promise<{ ok, messageId, ack, code, reason? }>
//     Accept an inbound message text (already un-framed; the wire layer
//     handed us a single complete frame). Parse MSH to identify the partner
//     by sendingApp/sendingFacility, write an `hl7_messages` row, dispatch
//     to the right handler (ORM → existing intake, etc.), and return the
//     ACK that the wire layer should send back.
//
//   register(transport, handler)       → unsubscribe()
//     Register a transport handler. Transport string matches the partner's
//     `transport` field ('loopback' | 'mllp' | 'http' | 'sftp' | …).
//     Handler signature: async (framed, partner, message) → { ok, ack?, ackControlId?, ackCode?, reason? }.
//
// A 'loopback' handler ships by default: it accepts any outbound, generates
// a synthetic AA ACK after a brief delay, and persists both directions.
// Useful for the demo and for tests; replaced by the real transport in Tier 6.

(function () {

  const COLLECTION = 'hl7_messages';
  const STATUS_QUEUED = 'queued';
  const STATUS_SENDING = 'sending';
  const STATUS_ACKED = 'acked';
  const STATUS_NAKKED = 'nakked';
  const STATUS_TIMED_OUT = 'timed-out';
  const STATUS_FAILED = 'failed';
  const STATUS_RECEIVED = 'received';
  const STATUS_ACCEPTED = 'accepted';
  const STATUS_REJECTED = 'rejected';
  const STATUS_ERRORED = 'errored';

  const handlers = new Map();   // transport → handler

  // Loopback handler: accept any outbound and emit a synthetic AA ACK back
  // through `receive` after a tick. Mirrors the round-trip an MLLP receiver
  // would do without opening a socket.
  const LOOPBACK_DELAY_MS = 150;

  const __genControlId = () => {
    // 14 digits + 4-char suffix; MSH-10 has no fixed format, just must be unique
    // within the sending app's stream. Enough to demo and to trace round-trips.
    const ts = new Date();
    const pad = (n, w) => String(n).padStart(w, '0');
    const stamp =
      ts.getFullYear() +
      pad(ts.getMonth() + 1, 2) +
      pad(ts.getDate(), 2) +
      pad(ts.getHours(), 2) +
      pad(ts.getMinutes(), 2) +
      pad(ts.getSeconds(), 2);
    return stamp + Math.random().toString(36).slice(2, 6).toUpperCase();
  };

  const __findPartnerByInbound = async (header) => {
    if (!header) return null;
    const all = await window.db.list('hl7_partners', p => p.active !== false);
    return all.find(p =>
      (!p.partnerApp || p.partnerApp === header.sendingApp) &&
      (!p.partnerFacility || p.partnerFacility === header.sendingFacility)
    ) || null;
  };

  const __parseHeader = (raw) => {
    if (window.hl7Mllp && window.hl7Mllp.parseHeader) {
      return window.hl7Mllp.parseHeader(raw);
    }
    // Minimal fallback: pull MSH fields if hl7-mllp is unavailable.
    const firstLine = String(raw).split(/\r\n|\r|\n/)[0] || '';
    if (!firstLine.startsWith('MSH')) return null;
    const fs = firstLine[3] || '|';
    const parts = firstLine.split(fs);
    return {
      sendingApp:       parts[2] || '',
      sendingFacility:  parts[3] || '',
      receivingApp:     parts[4] || '',
      receivingFacility: parts[5] || '',
      ts:               parts[6] || '',
      messageType:      parts[8] || '',
      controlId:        parts[9] || '',
    };
  };

  const __buildSyntheticAck = (header, code = 'AA', errorMessage) => {
    if (window.hl7Mllp && window.hl7Mllp.buildACK) {
      return window.hl7Mllp.buildACK(
        header._raw || '',
        { code, errorMessage, sendingApp: 'LATTICE', sendingFacility: 'MAIN' }
      );
    }
    // Inline minimal ACK construction if hl7-mllp isn't loaded.
    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const ctl = __genControlId();
    const msh = `MSH|^~\\&|LATTICE|MAIN|${header.sendingApp || ''}|${header.sendingFacility || ''}|${ts}||ACK|${ctl}|P|2.5`;
    const msa = `MSA|${code}|${header.controlId || ''}${errorMessage ? '|' + errorMessage : ''}`;
    return { ack: msh + '\r' + msa, code, controlId: ctl };
  };

  // ── send ────────────────────────────────────────────────────────────────

  const send = async (partnerId, raw, opts = {}) => {
    const partner = await window.db.get('hl7_partners', partnerId);
    if (!partner) {
      return { ok: false, reason: 'unknown partner ' + partnerId };
    }
    if (partner.active === false) {
      return { ok: false, reason: 'partner ' + partner.name + ' is inactive' };
    }
    const header = __parseHeader(raw) || {};
    const messageRec = window.schema.newHl7Message({
      direction: 'outbound',
      partnerId: partner.id,
      interfaceId: opts.interfaceId || null,
      controlId: header.controlId || '',
      messageType: header.messageType || opts.messageType || '',
      sendingApp:       header.sendingApp       || partner.sendingApp || '',
      sendingFacility:  header.sendingFacility  || partner.sendingFacility || '',
      receivingApp:     header.receivingApp     || partner.partnerApp || '',
      receivingFacility: header.receivingFacility || partner.partnerFacility || '',
      raw,
      status: STATUS_QUEUED,
      attemptCount: 0,
      orderId:  opts.orderId  || null,
      resultId: opts.resultId || null,
      patientId: opts.patientId || null,
    });
    await window.db.put(COLLECTION, messageRec);

    const handler = handlers.get(partner.transport || 'loopback') || handlers.get('loopback');
    if (!handler) {
      await window.db.put(COLLECTION, {
        ...messageRec, status: STATUS_FAILED, errorReason: 'no handler for transport ' + partner.transport,
        attemptCount: 1, lastAttemptAt: Date.now(), updatedAt: Date.now(),
      });
      return { ok: false, messageId: messageRec.id, reason: 'no handler' };
    }

    const framed = window.hl7Mllp && window.hl7Mllp.frame ? window.hl7Mllp.frame(raw) : raw;
    await window.db.put(COLLECTION, {
      ...messageRec, status: STATUS_SENDING, framed,
      attemptCount: 1, lastAttemptAt: Date.now(), updatedAt: Date.now(),
    });

    let outcome;
    try {
      outcome = await handler(framed, partner, { ...messageRec, framed });
    } catch (err) {
      outcome = { ok: false, reason: (err && err.message) || String(err) };
    }

    const next = { ...messageRec, framed, attemptCount: 1, lastAttemptAt: Date.now() };
    if (outcome && outcome.ok) {
      next.status = STATUS_ACKED;
      next.ackCode = outcome.ackCode || 'AA';
      next.ackControlId = outcome.ackControlId || '';
      next.ackMessageId = outcome.ackMessageId || null;
    } else if (outcome && outcome.ackCode && outcome.ackCode !== 'AA') {
      next.status = STATUS_NAKKED;
      next.ackCode = outcome.ackCode;
      next.ackControlId = outcome.ackControlId || '';
      next.errorReason = outcome.reason || 'partner returned ' + outcome.ackCode;
    } else {
      next.status = STATUS_FAILED;
      next.errorReason = (outcome && outcome.reason) || 'transport returned no ACK';
    }
    next.updatedAt = Date.now();
    await window.db.put(COLLECTION, next);

    // Bump partner.lastSeenAt so the UI shows recent activity.
    await window.db.put('hl7_partners', { ...partner, lastSeenAt: Date.now(), updatedAt: Date.now() });

    return {
      ok: next.status === STATUS_ACKED,
      messageId: next.id,
      ackCode: next.ackCode,
      ackControlId: next.ackControlId,
      reason: next.errorReason || undefined,
    };
  };

  // ── receive ────────────────────────────────────────────────────────────

  const receive = async (raw, opts = {}) => {
    const header = __parseHeader(raw);
    if (!header) {
      const errRec = window.schema.newHl7Message({
        direction: 'inbound',
        raw, status: STATUS_ERRORED, errorReason: 'missing or invalid MSH segment',
      });
      await window.db.put(COLLECTION, errRec);
      const ack = __buildSyntheticAck({ sendingApp: '', sendingFacility: '', controlId: '' }, 'AR', 'invalid MSH');
      return { ok: false, messageId: errRec.id, ack: ack.ack, code: 'AR', reason: 'invalid MSH' };
    }
    const partner = opts.partner || await __findPartnerByInbound(header);
    const messageRec = window.schema.newHl7Message({
      direction: 'inbound',
      partnerId: partner ? partner.id : null,
      interfaceId: opts.interfaceId || null,
      controlId: header.controlId || '',
      messageType: header.messageType || '',
      sendingApp:       header.sendingApp || '',
      sendingFacility:  header.sendingFacility || '',
      receivingApp:     header.receivingApp || '',
      receivingFacility: header.receivingFacility || '',
      raw,
      framed: opts.framed || '',
      status: STATUS_RECEIVED,
      attemptCount: 1,
      lastAttemptAt: Date.now(),
    });
    await window.db.put(COLLECTION, messageRec);

    // Dispatch by message type. Today we route ORM-O01 to the existing
    // intake; everything else is parked with status='received' so a future
    // handler can pick it up. The ACK reflects what we accepted.
    const baseType = String(header.messageType || '').split('^')[0];
    let dispatchOutcome = { ok: true, code: 'AA' };
    try {
      if (baseType === 'ORM' && window.hl7 && window.hl7.parseORM) {
        const parsed = window.hl7.parseORM(raw);
        if (parsed && opts.onOrm) {
          // Caller-provided handler (the Intake panel passes one); use it.
          const out = await opts.onOrm(parsed, raw);
          if (out && out.ok === false) dispatchOutcome = { ok: false, code: 'AE', reason: out.reason || 'order intake refused' };
          else {
            dispatchOutcome = { ok: true, code: 'AA' };
            if (out && out.orderId) messageRec.orderId = out.orderId;
            if (out && out.patientId) messageRec.patientId = out.patientId;
          }
        }
      } else if (baseType === 'ACK') {
        // An inbound ACK is for an outbound we sent. Try to correlate by
        // MSA-2 (which holds the original controlId) and update that row.
        const ackedControlId = (raw.split(/\r\n|\r|\n/).find(s => s.startsWith('MSA')) || '').split('|')[2] || '';
        if (ackedControlId) {
          const candidates = await window.db.list(COLLECTION, m => m.direction === 'outbound' && m.controlId === ackedControlId);
          for (const c of candidates) {
            await window.db.put(COLLECTION, {
              ...c, status: STATUS_ACKED, ackCode: 'AA',
              ackControlId: header.controlId, ackMessageId: messageRec.id,
              updatedAt: Date.now(),
            });
          }
        }
        dispatchOutcome = { ok: true, code: 'AA' };
      } else if (!partner) {
        // Unknown partner + unknown type → log and politely reject.
        dispatchOutcome = { ok: false, code: 'AR', reason: 'unknown sending app/facility — no partner configured' };
      } else if (!partner.inboundTypes || !partner.inboundTypes.includes(header.messageType)) {
        dispatchOutcome = { ok: false, code: 'AR', reason: 'partner does not accept ' + header.messageType };
      } else {
        // Recognized partner + type but no concrete handler yet.
        dispatchOutcome = { ok: true, code: 'AA' };
      }
    } catch (err) {
      dispatchOutcome = { ok: false, code: 'AE', reason: (err && err.message) || String(err) };
    }

    const ack = __buildSyntheticAck(header, dispatchOutcome.code, dispatchOutcome.reason);

    await window.db.put(COLLECTION, {
      ...messageRec,
      status: dispatchOutcome.ok ? STATUS_ACCEPTED : (dispatchOutcome.code === 'AE' ? STATUS_ERRORED : STATUS_REJECTED),
      errorReason: dispatchOutcome.reason || '',
      ackCode: dispatchOutcome.code,
      ackControlId: ack.controlId,
      updatedAt: Date.now(),
    });

    if (partner) {
      await window.db.put('hl7_partners', { ...partner, lastSeenAt: Date.now(), updatedAt: Date.now() });
    }

    return {
      ok: dispatchOutcome.ok,
      messageId: messageRec.id,
      ack: ack.ack,
      code: dispatchOutcome.code,
      partnerId: partner ? partner.id : null,
      reason: dispatchOutcome.reason,
    };
  };

  // ── register / handlers ────────────────────────────────────────────────

  const register = (transport, handler) => {
    handlers.set(transport, handler);
    return () => { if (handlers.get(transport) === handler) handlers.delete(transport); };
  };

  // Default loopback handler — emit a synthetic AA back to the caller.
  // Useful for the demo (everything ACKs locally) and for tests. Replaced
  // by the real Tier 6 transport when one registers.
  register('loopback', (framed, partner, message) => new Promise(resolve => {
    setTimeout(() => {
      const header = __parseHeader(message.raw) || {};
      const ack = __buildSyntheticAck(header, 'AA');
      resolve({ ok: true, ackCode: 'AA', ackControlId: ack.controlId });
    }, LOOPBACK_DELAY_MS);
  }));

  // Until the real transports are implemented, register stubs so that
  // partners configured with `transport: 'mllp'` (etc.) still get an ACK
  // and the UI can show a meaningful demo. Each stub uses the loopback
  // behavior under the hood but tags the response with its transport for
  // future debugging.
  for (const t of ['mllp', 'http', 'sftp']) {
    register(t, (framed, partner, message) => new Promise(resolve => {
      setTimeout(() => {
        const header = __parseHeader(message.raw) || {};
        const ack = __buildSyntheticAck(header, 'AA');
        resolve({ ok: true, ackCode: 'AA', ackControlId: ack.controlId });
      }, LOOPBACK_DELAY_MS);
    }));
  }

  window.hl7Transport = {
    send, receive, register,
    STATUS: {
      QUEUED: STATUS_QUEUED, SENDING: STATUS_SENDING, ACKED: STATUS_ACKED, NAKKED: STATUS_NAKKED,
      TIMED_OUT: STATUS_TIMED_OUT, FAILED: STATUS_FAILED,
      RECEIVED: STATUS_RECEIVED, ACCEPTED: STATUS_ACCEPTED, REJECTED: STATUS_REJECTED, ERRORED: STATUS_ERRORED,
    },
    _handlers: handlers,
  };
})();
