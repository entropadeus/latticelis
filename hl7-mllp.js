// hl7-mllp.js — Minimal Lower Layer Protocol framing + ACK builder for HL7 v2.x.
//
// MLLP framing (per HL7 v2.x Implementation Guide, "Lower Layer Protocols"):
//   <VT>  message  <FS><CR>
// where <VT> = 0x0B (Vertical Tab), <FS> = 0x1C (File Separator), <CR> = 0x0D.
// The message itself uses HL7 segment terminator <CR> (0x0D) between segments.
// We tolerate <LF> as a segment separator on inbound (lots of producers send \n).
//
// This module is the wire-format layer. It does NOT open a socket — the actual
// network transport is Tier 6 (Electron `net` or a server-side proxy). What's
// here is enough to:
//   1. Frame an outbound HL7 message correctly so a real MLLP receiver accepts it.
//   2. Unframe a stream of inbound bytes that may contain 0..N complete frames
//      plus a trailing partial frame (the standard streaming pattern).
//   3. Build the ACK^A01 / NAK that an MLLP receiver MUST send back per spec.
//
// API:
//   frame(msg)                                      → string with VT+msg+FS+CR
//   unframe(bufferText)                             → { messages: [...], remainder }
//   parseHeader(msg)                                → { controlId, sendingApp, sendingFac, messageType, ts } | null
//   buildACK(inboundMsg, opts?)                     → { ack, code, controlId } where opts: { code, errorMessage, sendingApp, sendingFac }
//
// `buildACK` defaults to AA (Application Accept). Pass code: 'AE' (Application
// Error) or 'AR' (Application Reject) for negative ACKs; errorMessage is added
// as MSA-3 / ERR-3 text.

(function () {

  const VT = '\x0B';
  const FS = '\x1C';
  const CR = '\x0D';
  const SEG = '\r';   // wire segment separator per spec

  // ── Outbound framing ────────────────────────────────────────────────────

  const frame = (msg) => {
    if (msg == null) return VT + FS + CR;  // empty frame is technically legal
    // Normalize segment separators: HL7 wire uses \r between segments. Our
    // builders render with \n for human readability — re-normalize on the wire.
    const normalized = String(msg).replace(/\r\n|\n/g, SEG);
    return VT + normalized + FS + CR;
  };

  // ── Inbound un-framing ──────────────────────────────────────────────────
  //
  // A real receiver accumulates bytes from a socket and calls unframe with the
  // running buffer. We return any complete frames and the remainder for the
  // next read. The caller is expected to feed the returned `remainder` back in
  // prepended to the next chunk. We DROP bytes before the first VT (garbage
  // before a frame start) but report them in `dropped` so the caller can log it.

  const unframe = (buffer) => {
    if (buffer == null || buffer === '') return { messages: [], remainder: '', dropped: 0 };
    let s = String(buffer);
    let dropped = 0;
    const messages = [];

    // Drop anything before the first VT.
    const firstVt = s.indexOf(VT);
    if (firstVt < 0) {
      // No frame starts at all — the whole buffer is either pre-frame garbage
      // or part of a previous incomplete frame the caller hasn't kept track of.
      // We treat it as remainder so the caller can prepend on next read; it's
      // up to them to bound it.
      return { messages: [], remainder: s, dropped: 0 };
    }
    if (firstVt > 0) {
      dropped = firstVt;
      s = s.slice(firstVt);
    }

    while (s.length > 0) {
      if (s[0] !== VT) {
        // Garbage between frames; drop until next VT.
        const next = s.indexOf(VT, 1);
        if (next < 0) {
          dropped += s.length;
          s = '';
          break;
        }
        dropped += next;
        s = s.slice(next);
        continue;
      }
      // s starts with VT. Look for FS+CR terminator.
      const end = s.indexOf(FS + CR, 1);
      if (end < 0) {
        // Incomplete frame — keep it in remainder for the next read.
        break;
      }
      const body = s.slice(1, end);          // strip VT prefix and FS+CR suffix
      messages.push(body);
      s = s.slice(end + 2);                  // 2 = length of FS+CR
    }
    return { messages, remainder: s, dropped };
  };

  // ── Header peek (for ACK echo fields) ───────────────────────────────────
  //
  // The ACK MUST echo the inbound message's MSH-10 (control ID) into MSA-2,
  // and reflect MSH-3/4 into MSH-5/6 (sender becomes receiver). We need a
  // tiny parser that doesn't care about the rest of the message.

  const parseHeader = (msg) => {
    if (!msg || typeof msg !== 'string') return null;
    const firstSeg = msg.split(/[\r\n]/)[0] || '';
    if (!firstSeg.startsWith('MSH')) return null;
    // MSH is special: f[0]='MSH', f[1]=encoding chars (^~\&), f[2]=sending app, …
    // The field separator is firstSeg[3] (the '|' after MSH).
    const fs = firstSeg[3] || '|';
    const f = firstSeg.split(fs);
    return {
      sendingApp:    f[2] || '',
      sendingFac:    f[3] || '',
      receivingApp:  f[4] || '',
      receivingFac:  f[5] || '',
      ts:            f[6] || '',
      messageType:   f[8] || '',
      controlId:     f[9] || '',
      processingId:  f[10] || '',
      version:       f[11] || '',
    };
  };

  // ── ACK^A01 builder ─────────────────────────────────────────────────────
  //
  // Per HL7 spec the ACK message has at minimum:
  //   MSH | ^~\& | <us> | <us-fac> | <them> | <them-fac> | <ts> || ACK^A01 | <ackCtl> | P | 2.5
  //   MSA | <code> | <inbound-control-id> | <error message?>
  // The ACK echoes inbound's MSH-10 in MSA-2 so the sender can correlate.
  //
  // codes:
  //   AA  Application Accept   — success
  //   AE  Application Error    — message received but a logical error blocked processing
  //   AR  Application Reject   — message rejected (bad version, malformed header, etc.)

  const __pad2 = (n) => String(n).padStart(2, '0');
  const __ts = () => {
    const d = new Date();
    return d.getUTCFullYear()
      + __pad2(d.getUTCMonth() + 1) + __pad2(d.getUTCDate())
      + __pad2(d.getUTCHours()) + __pad2(d.getUTCMinutes()) + __pad2(d.getUTCSeconds());
  };

  const buildACK = (inboundMsg, opts = {}) => {
    const code = opts.code || 'AA';
    const errMsg = opts.errorMessage || '';
    const myApp = opts.sendingApp || 'LATTICE';
    const myFac = opts.sendingFac || 'MAIN';

    const header = parseHeader(inboundMsg);
    // If the inbound has no parseable MSH, we still build a NAK (AR) but echo
    // an empty control ID — the sender will still see SOMETHING land back.
    const inboundControlId = header ? header.controlId : '';
    const targetApp = header ? header.sendingApp : 'UNKNOWN';
    const targetFac = header ? header.sendingFac : 'UNKNOWN';

    const ackCtl = 'ACK' + Math.floor(Math.random() * 1e9);
    const lines = [
      ['MSH', '^~\\&', myApp, myFac, targetApp, targetFac, __ts(), '', 'ACK^A01', ackCtl, 'P', '2.5'].join('|'),
      ['MSA', code, inboundControlId, errMsg].join('|'),
    ];
    return {
      ack: lines.join(SEG),
      code,
      controlId: ackCtl,
      echoedControlId: inboundControlId,
    };
  };

  // ── Convenience: full receive + ACK helper ─────────────────────────────
  //
  // For tests / a future receiver: take a raw bytes buffer, return the parsed
  // messages, the remainder (caller stores), and a per-message ACK.
  // NB: this is the simplest possible receive policy — every well-framed
  // message gets AA, every msg with no MSH gets AR. A real receiver would
  // run domain validation between unframe and buildACK.

  const receive = (buffer, opts = {}) => {
    const u = unframe(buffer);
    const responses = u.messages.map(m => {
      const h = parseHeader(m);
      if (!h || !h.controlId) {
        return { msg: m, ack: buildACK(m, { code: 'AR', errorMessage: 'malformed MSH or missing control ID', ...opts }) };
      }
      return { msg: m, ack: buildACK(m, { code: 'AA', ...opts }) };
    });
    return { ...u, responses };
  };

  window.hl7Mllp = {
    VT, FS, CR, SEG,
    frame, unframe, parseHeader, buildACK, receive,
  };

})();
