// hl7.js — HL7 v2.x message construction + parsing.
//
// Subset that covers ORU-R01 (outbound result) and ORM-O01 (inbound order).
// No network plumbing here — that's Tier 6 (MLLP / TCP / ACK exchange).
// This module produces and consumes the wire-format text; the surrounding
// pipeline treats HL7 as just another channel into and out of the same events
// (`order.created` / `result.released`).
//
// Encoding characters (MSH-2): `^~\&`
//   |  field separator
//   ^  component separator
//   ~  repetition separator
//   \  escape
//   &  subcomponent separator
//
// Datetime is HL7-style yyyyMMddHHmmss (UTC). Segment terminator is \r per
// the spec, but we render with \n for display readability.

(function () {

  const FS = '|';
  const CS = '^';
  const RS = '~';
  const ESC = '\\';
  const SS = '&';
  const SEG = '\n';   // display; spec is \r

  const SENDING_APP    = 'LATTICE';
  const SENDING_FAC    = 'MAIN';

  // ── Encoding helpers ────────────────────────────────────────────────────

  const escapeField = (s) => {
    if (s == null) return '';
    return String(s)
      .replace(/\\/g, '\\E\\')
      .replace(/\|/g, '\\F\\')
      .replace(/\^/g, '\\S\\')
      .replace(/~/g,  '\\R\\')
      .replace(/&/g,  '\\T\\');
  };

  const unescapeField = (s) => {
    if (s == null) return '';
    return String(s)
      .replace(/\\F\\/g, '|')
      .replace(/\\S\\/g, '^')
      .replace(/\\R\\/g, '~')
      .replace(/\\T\\/g, '&')
      .replace(/\\E\\/g, '\\');
  };

  const fmtTs = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
  };

  const parseTs = (s) => {
    if (!s || typeof s !== 'string') return null;
    const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(?:(\d{2}))?)?/);
    if (!m) return null;
    const [, y, mo, d, h = '0', mi = '0', se = '0'] = m;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  };

  const fmtDate = (s) => {
    // Date-only input ("YYYY-MM-DD") → "YYYYMMDD" (HL7 style)
    if (!s) return '';
    return String(s).replace(/-/g, '').slice(0, 8);
  };
  const parseDate = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  };

  // ── Segment builders ────────────────────────────────────────────────────

  const seg = (...fields) => fields.map(f => f == null ? '' : f).join(FS);

  // MSH-2 carries the encoding chars themselves, not field-separated, so it's
  // built specially. The first FS after MSH defines the separator. messageType
  // and controlId are NOT escapeField'd: messageType (e.g. "ORU^R01") uses ^
  // as a legitimate component separator, and control IDs are constrained to
  // safe ASCII by convention.
  const buildMSH = ({ messageType, controlId, sendingApp = SENDING_APP, sendingFac = SENDING_FAC, receivingApp = 'EMR', receivingFac = 'CLINIC', ts = Date.now() }) => {
    return `MSH${FS}${CS}${RS}${ESC}${SS}${FS}${escapeField(sendingApp)}${FS}${escapeField(sendingFac)}${FS}${escapeField(receivingApp)}${FS}${escapeField(receivingFac)}${FS}${fmtTs(ts)}${FS}${FS}${messageType || ''}${FS}${controlId || ''}${FS}P${FS}2.5`;
  };

  const buildPID = (patient, setId = 1) => {
    if (!patient) return seg('PID', setId);
    const name = `${escapeField(patient.lastName || '')}${CS}${escapeField(patient.firstName || '')}${patient.middleName ? CS + escapeField(patient.middleName) : ''}`;
    const sex = ({ M: 'M', F: 'F', X: 'O' })[patient.sex] || 'U';
    const mrn = `${escapeField(patient.mrn || '')}${CS}${CS}${CS}MRN`;
    return seg('PID', setId, '', mrn, '', name, '', fmtDate(patient.dob), sex);
  };

  const buildORC = ({ control = 'NW', placerOrder = '', fillerOrder = '', orderingProvider = '' }) => {
    const provider = orderingProvider ? `${CS}${escapeField(orderingProvider)}` : '';
    return seg('ORC', control, escapeField(placerOrder), escapeField(fillerOrder), '', '', '', '', '', fmtTs(Date.now()), '', '', provider);
  };

  // OBR layout (HL7 v2.5):
  //   OBR-1  Set ID
  //   OBR-2  Placer Order Number
  //   OBR-3  Filler Order Number
  //   OBR-4  Universal Service Identifier  ("CODE^Name^L" + ~"LOINC^Name^LN")
  //   OBR-5  Priority (deprecated; we still set it since some receivers read it)
  //   OBR-6  Requested Date/Time  (when the clinician ordered)
  //   OBR-7  Observation Date/Time  (specimen collected)
  //   OBR-14 Specimen Received Date/Time
  //   OBR-16 Ordering Provider  (we send "^Dr Smith" with empty id component)
  const buildOBR = ({ setId = 1, placer = '', filler = '', test, priority = 'R', requested = '', observed = '', received = '', orderingProvider = '' }) => {
    const universalServiceId = test
      ? `${escapeField(test.code || '')}${CS}${escapeField(test.name || '')}${CS}L${test.loinc ? RS + escapeField(test.loinc) + CS + escapeField(test.name || '') + CS + 'LN' : ''}`
      : '';
    const priCode = ({ stat: 'S', asap: 'A', routine: 'R' })[priority] || 'R';
    const provider = orderingProvider ? `${CS}${escapeField(orderingProvider)}` : '';
    return seg(
      'OBR', setId,                           // 1
      escapeField(placer),                    // 2
      escapeField(filler),                    // 3
      universalServiceId,                     // 4
      priCode,                                // 5
      fmtTs(requested) || '',                 // 6  Requested Date/Time
      fmtTs(observed) || '',                  // 7  Observation Date/Time (collected)
      '', '', '', '', '', '',                 // 8..13
      fmtTs(received) || '',                  // 14 Specimen Received Date/Time
      '',                                     // 15 Specimen Source
      provider                                // 16 Ordering Provider
    );
  };

  const buildOBX = ({ setId, result, test }) => {
    const usid = test
      ? `${escapeField(test.code || '')}${CS}${escapeField(test.name || '')}${CS}L${test.loinc ? RS + escapeField(test.loinc) + CS + escapeField(test.name || '') + CS + 'LN' : ''}`
      : '';
    const valType = typeof result.value === 'number' ? 'NM' : 'ST';
    const ref = (result.refRangeLow != null && result.refRangeHigh != null) ? `${result.refRangeLow}-${result.refRangeHigh}` : '';
    const status = ({ preliminary: 'P', final: 'F', corrected: 'C', cancelled: 'X' })[result.status] || 'F';
    return seg('OBX', setId, valType, usid, '', escapeField(result.value), escapeField(result.units), ref, escapeField(result.flag), '', '', status, '', '', fmtTs(result.resultedAt || result.createdAt));
  };

  const buildNTE = ({ setId = 1, text }) => seg('NTE', setId, '', escapeField(text));

  // ── Outbound — ORU-R01 ─────────────────────────────────────────────────
  // One message per (specimen, order) carrying every result for that spec.
  // Real impls often send one OBR per test+result pair; this groups by order.

  const buildORU = ({ patient, order, specimen, results, testById, controlId }) => {
    const ctl = controlId || ('LIS' + Math.floor(Math.random() * 1e9));
    const lines = [];
    lines.push(buildMSH({ messageType: 'ORU^R01', controlId: ctl, ts: Date.now() }));
    lines.push(buildPID(patient, 1));
    let obxSetId = 0;
    let obrSetId = 0;
    // Group results by testId, one OBR per test on the order.
    for (const tid of (order && order.testIds) || []) {
      const test = testById[tid];
      if (!test) continue;
      const matchingResults = results.filter(r => r.testId === tid);
      if (matchingResults.length === 0) continue;
      obrSetId++;
      lines.push(buildOBR({
        setId: obrSetId,
        placer: order.placerOrderNumber || '',
        filler: order.orderNumber || specimen && specimen.accessionNumber || '',
        test,
        priority: order.priority,
        requested: order.orderedAt,
        observed: specimen && specimen.collectedAt,
        received: specimen && specimen.receivedAt,
        orderingProvider: order.providerId || '',
      }));
      for (const r of matchingResults) {
        obxSetId++;
        lines.push(buildOBX({ setId: obxSetId, result: r, test }));
        if (r.comments) lines.push(buildNTE({ setId: 1, text: r.comments }));
      }
    }
    return lines.join(SEG);
  };

  // ── Inbound — ORM-O01 → entities ───────────────────────────────────────
  // Liberal subset parser: tolerates missing ORC, builds Patient + Order + Tests.
  // Returns { patient, order, tests, errors[] }. The caller persists and
  // publishes order.created — that's where the regular pipeline picks up.

  const splitFields = (line) => line.split(FS);

  const parsePIDLine = (line) => {
    const f = splitFields(line);
    // f[3] = MRN (component-encoded), f[5] = name, f[7] = DOB, f[8] = sex
    const mrn = (f[3] || '').split(CS)[0] || '';
    const nameComponents = (f[5] || '').split(CS);
    const lastName = nameComponents[0] ? unescapeField(nameComponents[0]) : '';
    const firstName = nameComponents[1] ? unescapeField(nameComponents[1]) : '';
    const middleName = nameComponents[2] ? unescapeField(nameComponents[2]) : '';
    const dob = parseDate(f[7] || '');
    const hl7Sex = (f[8] || '').toUpperCase();
    const sex = hl7Sex === 'M' ? 'M' : hl7Sex === 'F' ? 'F' : (hl7Sex === 'O' ? 'X' : '');
    return { mrn, lastName, firstName, middleName, dob, sex };
  };

  const parseORCLine = (line) => {
    const f = splitFields(line);
    return {
      control: f[1] || '',
      placerOrder: unescapeField(f[2] || ''),
      fillerOrder: unescapeField(f[3] || ''),
      orderedAt: parseTs(f[9] || ''),
      orderingProvider: ((f[12] || '').split(CS).slice(1).join(' ') || '').trim() || unescapeField(f[12] || ''),
    };
  };

  const parseOBRLine = (line) => {
    const f = splitFields(line);
    const usid = (f[4] || '').split(CS);
    // LOINC sits in the optional repetition (~) of OBR-4. We read the first repetition
    // only — second repetition LOINC^Name^LN if present.
    const loincRep = (f[4] || '').includes(RS) ? (f[4].split(RS)[1] || '').split(CS) : [];
    return {
      setId: f[1],
      placer: unescapeField(f[2] || ''),
      filler: unescapeField(f[3] || ''),
      test: {
        code: unescapeField(usid[0] || ''),
        name: unescapeField(usid[1] || ''),
        loinc: unescapeField(loincRep[0] || ''),
      },
      priority: ({ S: 'stat', A: 'asap', R: 'routine' })[(f[5] || '').toUpperCase()] || 'routine',
      requested: parseTs(f[6] || ''),
      observed:  parseTs(f[7] || ''),       // OBR-7: Observation Date/Time (collected)
      received:  parseTs(f[14] || ''),      // OBR-14: Specimen Received Date/Time
    };
  };

  const parseMSHTs = (line) => {
    const f = splitFields(line);
    return parseTs(f[6] || '');  // MSH-7 = Date/Time of Message
  };

  const parseORM = (text) => {
    const errors = [];
    if (!text || typeof text !== 'string') return { patient: null, order: null, tests: [], errors: ['empty input'] };
    // Accept either \r or \n segment terminators (or both).
    const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return { patient: null, order: null, tests: [], errors: ['no segments'] };
    if (!lines[0].startsWith('MSH')) errors.push('first segment must be MSH');
    let patient = null;
    let orc = null;
    const obrs = [];
    let mshTs = null;
    for (const l of lines) {
      if (l.startsWith('MSH'))      mshTs = parseMSHTs(l);
      else if (l.startsWith('PID')) patient = parsePIDLine(l);
      else if (l.startsWith('ORC')) orc = parseORCLine(l);
      else if (l.startsWith('OBR')) obrs.push(parseOBRLine(l));
    }
    if (!patient) errors.push('missing PID');
    if (obrs.length === 0) errors.push('no OBR segments — order has no tests');

    const tests = obrs.map(o => o.test).filter(t => t.code);
    // orderedAt prefers ORC-9 → falls back to MSH-7 → null. Never silently
    // fabricates `Date.now()`: that masked missing data in earlier versions.
    const order = orc || obrs[0] ? {
      placerOrderNumber: (orc && orc.placerOrder) || (obrs[0] && obrs[0].placer) || '',
      fillerOrderNumber: (orc && orc.fillerOrder) || (obrs[0] && obrs[0].filler) || '',
      priority: (obrs[0] && obrs[0].priority) || 'routine',
      orderedAt: (orc && orc.orderedAt) || mshTs || null,
      collectedAt: (obrs[0] && obrs[0].observed) || null,
      receivedAt: (obrs[0] && obrs[0].received) || null,
      orderingProvider: orc && orc.orderingProvider || '',
    } : null;
    return { patient, order, tests, errors };
  };

  // ── Sample messages (for the UI's "fill example" affordance) ───────────

  // SAMPLE_ORM — canonical inbound order. Field positions match HL7 v2.5 spec.
  // ORC: pipes 3..8 are empty (placer-group..parent), ORC-9 = transaction time, ORC-12 = provider.
  // OBR: OBR-6 = requested, OBR-7 = observed (collected), OBR-14 = specimen received.
  const SAMPLE_ORM = [
    `MSH|^~\\&|EMR|CLINIC|LATTICE|MAIN|${fmtTs(Date.now())}||ORM^O01|MSG${Math.floor(Math.random()*1e6)}|P|2.5`,
    `PID|1||MRN-789012^^^MRN||Doe^Jane^A||19850412|F`,
    `ORC|NW|EMR-ORD-789|||||||${fmtTs(Date.now())}|||PROVIDER^Dr Smith`,
    `OBR|1|EMR-ORD-789||CMP^Comprehensive Metabolic Panel^L|R|${fmtTs(Date.now())}|${fmtTs(Date.now() - 3600000)}|||||||${fmtTs(Date.now())}`,
    `OBR|2|EMR-ORD-789||TSH^Thyroid Stimulating Hormone^L|R|${fmtTs(Date.now())}|${fmtTs(Date.now() - 3600000)}|||||||${fmtTs(Date.now())}`,
  ].join(SEG);

  window.hl7 = {
    buildORU,
    parseORM,
    SAMPLE_ORM,
    // Helpers exposed so the UI can show field-level breakdowns.
    fmtTs, parseTs, fmtDate, parseDate, escapeField, unescapeField,
  };
})();
