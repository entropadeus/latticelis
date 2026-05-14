// seed.js — Realistic demo data generator for Lattice LIS.
//
// Generates a reproducible seven-day window of laboratory activity:
// patients with varied demographics, referring clinics, instruments,
// orders across stat/asap/routine, specimens distributed across all six
// lifecycle states, results with realistic flag distribution including
// criticals at varied ages (so escalation T0/T1/T2 are demonstrable),
// QC chains with a few real Westgard violations, audit events.
//
// Idempotent: every seeded record is prefixed with `__demo_` and a fresh
// run wipes the prior seed before generating. Existing non-demo data is
// untouched.
//
// Public surface:
//   await window.seed.demo()            — populate (clears prior demo first)
//   await window.seed.clear()           — remove every __demo_ record
//   window.seed.PREFIX                  — '__demo_' (for tooling that needs it)
//
// Writes via `db.put` only — does NOT publish events.* (would re-trigger
// rules / watcher cascades on every record). Audit events are written
// directly so the Activity Log isn't empty.

(function () {

  const PREFIX = '__demo_';
  const id = (kind, n) => PREFIX + kind + '_' + String(n).padStart(4, '0');

  // ── Static fixtures ──────────────────────────────────────────────────

  const FIRST_F = ['Jane','Mary','Linda','Karen','Sarah','Emma','Olivia','Patricia','Lisa','Susan','Nancy','Helen','Sandra','Donna','Carol','Ruth','Aisha','Maria','Grace','Maya'];
  const FIRST_M = ['John','Robert','Michael','James','David','William','Joseph','Thomas','Charles','Daniel','Matthew','Anthony','Mark','Steven','Paul','Andrew','Hassan','Diego','Liam','Noah'];
  const LAST    = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Patel','Nguyen','Kim','Cohen','Ali'];

  // 12 tests covering chemistry + heme + cardiac. Each carries a realistic
  // adult range; HGB additionally has an F-only range to exercise the
  // demographic resolver. TROP carries per-test escalation thresholds.
  const TESTS = [
    { code: 'GLU',  name: 'Glucose',              units: 'mg/dL',   loinc: '2345-7',  low: 70,  high: 99,  cat: 'chem' },
    { code: 'BUN',  name: 'Blood Urea Nitrogen',  units: 'mg/dL',   loinc: '3094-0',  low: 7,   high: 25,  cat: 'chem' },
    { code: 'CR',   name: 'Creatinine',           units: 'mg/dL',   loinc: '2160-0',  low: 0.6, high: 1.2, cat: 'chem' },
    { code: 'NA',   name: 'Sodium',               units: 'mmol/L',  loinc: '2951-2',  low: 135, high: 145, cat: 'chem' },
    { code: 'K',    name: 'Potassium',            units: 'mmol/L',  loinc: '2823-3',  low: 3.5, high: 5.0, cat: 'chem' },
    { code: 'CL',   name: 'Chloride',             units: 'mmol/L',  loinc: '2075-0',  low: 96,  high: 106, cat: 'chem' },
    { code: 'WBC',  name: 'White Blood Cell',     units: '10^3/uL', loinc: '6690-2',  low: 4.5, high: 11,  cat: 'heme' },
    { code: 'RBC',  name: 'Red Blood Cell',       units: '10^6/uL', loinc: '789-8',   low: 4.5, high: 5.9, cat: 'heme' },
    { code: 'HGB',  name: 'Hemoglobin',           units: 'g/dL',    loinc: '718-7',   low: 13,  high: 17,  cat: 'heme', femaleRange: { low: 12, high: 16 } },
    { code: 'HCT',  name: 'Hematocrit',           units: '%',       loinc: '4544-3',  low: 41,  high: 53,  cat: 'heme' },
    { code: 'PLT',  name: 'Platelet',             units: '10^3/uL', loinc: '777-3',   low: 150, high: 400, cat: 'heme' },
    { code: 'TROP', name: 'Troponin I',           units: 'ng/mL',   loinc: '10839-9', low: 0,   high: 0.04, cat: 'cardiac', t1Sec: 30, t2Sec: 60 },
  ];

  const INSTRUMENTS = [
    { code: 'cobas-c303', name: 'Roche cobas c303', vendor: 'Roche',   model: 'c303', testCodes: ['GLU','BUN','CR','NA','K','CL'] },
    { code: 'au480',      name: 'Beckman AU480',    vendor: 'Beckman', model: 'AU480', testCodes: ['GLU','BUN','CR','TROP'] },
    { code: 'xn-550',     name: 'Sysmex XN-550',    vendor: 'Sysmex',  model: 'XN-550', testCodes: ['WBC','RBC','HGB','HCT','PLT'] },
    { code: 'manual',     name: 'Manual Bench',     vendor: 'In-house',model: '—',     testCodes: [] },
  ];

  const CLIENTS = [
    { code: 'STJOSEPH',     name: "St Joseph's Family Medicine", type: 'CLINIC',   deliveryChannel: 'fax',    deliveryEndpoint: '555-0101' },
    { code: 'WESTSIDE',     name: 'Westside Internal Medicine',  type: 'CLINIC',   deliveryChannel: 'hl7',    deliveryEndpoint: 'tcp://emr-west:6661' },
    { code: 'METROCARDIO',  name: 'Metro Cardiology',            type: 'CLINIC',   deliveryChannel: 'portal', deliveryEndpoint: 'metro-portal' },
    { code: 'NORTHGATE',    name: 'Northgate Pediatrics',        type: 'CLINIC',   deliveryChannel: 'fax',    deliveryEndpoint: '555-0202' },
    { code: 'CITYSNF',      name: 'City Skilled Nursing',        type: 'OTHER',    deliveryChannel: 'fax',    deliveryEndpoint: '555-0303' },
    { code: 'ED-WILMORE',   name: 'Wilmore Hospital ED',         type: 'HOSPITAL', deliveryChannel: 'hl7',    deliveryEndpoint: 'tcp://wilmore:6661' },
    { code: 'PRIMARYHLTH',  name: 'Primary Health Group',        type: 'CLINIC',   deliveryChannel: 'email',  deliveryEndpoint: 'results@primaryhealth.example' },
    { code: 'OBGYN-ALLIANCE', name: 'OB/GYN Alliance',           type: 'CLINIC',   deliveryChannel: 'fax',    deliveryEndpoint: '555-0404' },
  ];

  const SPECIMEN_TYPES = [
    { type: 'serum',       container: 'sst' },
    { type: 'plasma',      container: 'green' },
    { type: 'whole_blood', container: 'lavender' },
    { type: 'urine',       container: 'cup' },
  ];

  const DIAGNOSES = [
    ['E11.9'],          // Type 2 DM
    ['I10'],            // Hypertension
    ['I25.10'],         // CAD
    ['Z00.00'],         // General medical exam
    ['N18.3','I10'],    // CKD + HTN
    ['R07.9'],          // Chest pain
    ['D64.9'],          // Anemia, unspecified
    ['Z51.81'],         // Therapeutic drug monitoring
  ];

  // ── Random helpers ───────────────────────────────────────────────────

  // Deterministic-looking PRNG would be nice for reproducibility but Math.random
  // is fine for a demo. Distributions matter more than seedability.
  const rand = () => Math.random();
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pickWeighted = (entries) => {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    let r = rand() * total;
    for (const e of entries) { r -= e.weight; if (r <= 0) return e.value; }
    return entries[entries.length - 1].value;
  };
  const intBetween = (lo, hi) => Math.floor(lo + rand() * (hi - lo + 1));
  const floatBetween = (lo, hi, decimals = 2) => Number((lo + rand() * (hi - lo)).toFixed(decimals));

  // Distribution: most values inside range, ~15% just outside (L/H), ~3% way out (LL/HH).
  const valueWithFlag = (test, sex) => {
    const range = (sex === 'F' && test.femaleRange) ? test.femaleRange : { low: test.low, high: test.high };
    const span = range.high - range.low || 1;
    const r = rand();
    if (r < 0.78) {
      const v = floatBetween(range.low, range.high);
      return { value: v, flag: '', range };
    }
    if (r < 0.92) {
      // Just-outside L/H
      const side = rand() < 0.5 ? -1 : 1;
      const v = side > 0
        ? floatBetween(range.high + 0.01, range.high + span * 0.4)
        : floatBetween(Math.max(0, range.low - span * 0.4), range.low - 0.01);
      return { value: v, flag: side > 0 ? 'H' : 'L', range };
    }
    if (r < 0.98) {
      // Critical LL/HH
      const side = rand() < 0.5 ? -1 : 1;
      const v = side > 0
        ? floatBetween(range.high + span, range.high + span * 2)
        : floatBetween(Math.max(0, range.low - span), Math.max(0, range.low - span * 0.5));
      return { value: v, flag: side > 0 ? 'HH' : 'LL', range };
    }
    // Abnormal flag for cardiac panel — TROP just having any positive value is abnormal
    return { value: floatBetween(range.low, range.high * 1.2), flag: 'A', range };
  };

  // ── Time helpers ─────────────────────────────────────────────────────

  const NOW = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // Distribute a timestamp over the past N days, biased toward more recent.
  const recentTs = (daysBack = 7) => {
    // Bias: half the events in the last 24h, the rest spread across the prior days.
    if (rand() < 0.5) return NOW - rand() * DAY;
    return NOW - DAY - rand() * (daysBack - 1) * DAY;
  };

  // ── Generation ───────────────────────────────────────────────────────

  const clear = async () => {
    if (!window.db) throw new Error('[seed] db not ready');
    const collections = window.db.COLLECTIONS;
    let removed = 0;
    for (const coll of collections) {
      const rows = await window.db.list(coll);
      for (const r of rows) {
        const rid = r.id;
        const eid = r.entityId;
        if ((typeof rid === 'string' && rid.startsWith(PREFIX)) ||
            (typeof eid === 'string' && eid.startsWith(PREFIX))) {
          await window.db.delete(coll, rid);
          removed++;
        }
      }
    }
    return removed;
  };

  const demo = async () => {
    if (!window.db || !window.schema) throw new Error('[seed] db / schema not ready');
    const cleared = await clear();
    console.info('[seed] cleared ' + cleared + ' prior demo records');

    // ── 1. Tests ──────────────────────────────────────────────────────
    const testIdByCode = {};
    for (const t of TESTS) {
      const refRanges = [];
      if (t.femaleRange) {
        refRanges.push(window.schema.newReferenceRange({
          id: PREFIX + 'rr_' + t.code + '_F',
          low: t.femaleRange.low, high: t.femaleRange.high, units: t.units, sex: 'F',
        }));
      }
      const catMap = { chem: 'Chemistry', heme: 'Hematology', cardiac: 'Chemistry' };
      const test = window.schema.newTest({
        id: id('test', t.code),
        code: t.code, name: t.name, units: t.units, loinc: t.loinc,
        refRangeLow: t.low, refRangeHigh: t.high,
        referenceRanges: refRanges,
        category: catMap[t.cat] || '',
        criticalEscalationT1Sec: t.t1Sec || null,
        criticalEscalationT2Sec: t.t2Sec || null,
      });
      await window.db.put('tests', test);
      testIdByCode[t.code] = test.id;
    }

    // ── 2. Instruments ────────────────────────────────────────────────
    const instIdByCode = {};
    for (const ins of INSTRUMENTS) {
      const inst = window.schema.newInstrument({
        id: id('inst', ins.code),
        name: ins.name, vendor: ins.vendor, model: ins.model,
        serial: 'SN-' + ins.code.toUpperCase().slice(0, 4) + '-' + intBetween(1000, 9999),
        status: ins.code === 'manual' ? 'idle' : pickWeighted([
          { value: 'idle', weight: 1 },
          { value: 'running', weight: 5 },
          { value: 'maintenance', weight: 0.3 },
        ]),
        testIds: ins.testCodes.map(c => testIdByCode[c]).filter(Boolean),
      });
      await window.db.put('instruments', inst);
      instIdByCode[ins.code] = inst.id;
    }

    // ── 3. Clients ────────────────────────────────────────────────────
    const clientIds = [];
    for (const c of CLIENTS) {
      const cl = window.schema.newClient({
        id: id('client', c.code),
        code: c.code, name: c.name, type: c.type,
        deliveryChannel: c.deliveryChannel, deliveryEndpoint: c.deliveryEndpoint,
      });
      await window.db.put('clients', cl);
      clientIds.push(cl.id);
    }

    // ── 3a. Locations ─────────────────────────────────────────────────
    // The lab + a couple of draw stations + a hospital partner. Orders
    // pin against these via locationId so the Locations admin Orders
    // count column reflects real linkage.
    const LOCATIONS = [
      { code: 'MAIN-LAB',     name: 'Main Laboratory',          type: 'LAB',          phone: '555-0100', hours: 'M-F 0700-1900', departments: ['CHEMISTRY','HEMATOLOGY','MICROBIOLOGY','IMMUNOLOGY','URINALYSIS'] },
      { code: 'WSDS',         name: 'Westside Draw Station',    type: 'DRAW_STATION', phone: '555-0150', hours: 'M-F 0600-1400', departments: [], parent: 'MAIN-LAB' },
      { code: 'HOSP-WILMORE', name: 'Wilmore Hospital Lab',     type: 'HOSPITAL',     phone: '555-0900', hours: '24/7', departments: ['CHEMISTRY','HEMATOLOGY','BLOOD_BANK'] },
      { code: 'NORTH-DS',     name: 'Northgate Draw Station',   type: 'DRAW_STATION', phone: '555-0220', hours: 'M-Sa 0700-1500', departments: [], parent: 'MAIN-LAB' },
    ];
    const locationIdByCode = {};
    for (const l of LOCATIONS) {
      const loc = window.schema.newLocation({
        id: id('loc', l.code),
        code: l.code, name: l.name, type: l.type, phone: l.phone, hours: l.hours,
        departments: l.departments,
        parentId: l.parent ? PREFIX + 'loc_' + l.parent : null,
      });
      await window.db.put('locations', loc);
      locationIdByCode[l.code] = loc.id;
    }
    const locationIds = Object.values(locationIdByCode);

    // ── 4. Patients ───────────────────────────────────────────────────
    const N_PATIENTS = 30;
    const patients = [];
    for (let i = 0; i < N_PATIENTS; i++) {
      const sex = pickWeighted([
        { value: 'F', weight: 49 },
        { value: 'M', weight: 49 },
        { value: 'X', weight: 2 },
      ]);
      const first = sex === 'F' ? pick(FIRST_F) : sex === 'M' ? pick(FIRST_M) : pick(FIRST_F.concat(FIRST_M));
      const last  = pick(LAST);
      const ageYrs = pickWeighted([
        { value: intBetween(0, 17), weight: 1 },     // peds
        { value: intBetween(18, 39), weight: 3 },
        { value: intBetween(40, 64), weight: 5 },    // bulk of clinic-visit volume
        { value: intBetween(65, 95), weight: 4 },
      ]);
      const dobDate = new Date(NOW - ageYrs * 365.25 * DAY);
      const p = window.schema.newPatient({
        id: id('pat', i),
        mrn: 'M' + String(100000 + i).slice(0, 6),
        firstName: first, lastName: last, sex,
        dob: dobDate.toISOString().slice(0, 10),
        phone: '555-' + String(1000 + i),
        email: rand() < 0.6 ? (first + '.' + last).toLowerCase() + '@example.com' : '',
        preferredContact: pickWeighted([
          { value: 'phone',  weight: 4 },
          { value: 'portal', weight: 3 },
          { value: 'email',  weight: 2 },
          { value: '',       weight: 1 },
        ]),
      });
      await window.db.put('patients', p);
      patients.push(p);
    }

    // ── 5. Orders ─────────────────────────────────────────────────────
    // 60 orders over the past 7 days.
    const N_ORDERS = 60;
    const ordersOut = [];
    for (let i = 0; i < N_ORDERS; i++) {
      const patient = pick(patients);
      const orderedAt = recentTs(7);
      const priority = pickWeighted([
        { value: 'routine', weight: 70 },
        { value: 'asap',    weight: 20 },
        { value: 'stat',    weight: 10 },
      ]);
      // Pick test panel — chemistry common, heme common, cardiac when chest pain
      const dx = pick(DIAGNOSES);
      const cardiac = dx.includes('R07.9') || dx.includes('I25.10');
      const panel = (() => {
        const codes = [];
        if (rand() < 0.6) codes.push('GLU','BUN','CR','NA','K','CL');
        else if (rand() < 0.5) codes.push('GLU','BUN','CR');
        else codes.push('GLU');
        if (rand() < 0.4) codes.push('WBC','HGB','HCT','PLT');
        if (cardiac) codes.push('TROP');
        // Dedupe
        return Array.from(new Set(codes));
      })();
      const ymd = new Date(orderedAt).toISOString().slice(0,10).replace(/-/g, '');
      const locationId = pick(locationIds);
      const order = window.schema.newOrder({
        id: id('ord', i),
        orderNumber: 'L' + ymd + String(1000 + i).slice(-4),
        patientId: patient.id,
        clientId: pick(clientIds),
        locationId,
        priority,
        status: 'open', // refined below per-specimen state
        testIds: panel.map(c => testIdByCode[c]),
        diagnosisCodes: dx,
        orderedAt, createdAt: orderedAt,
      });
      ordersOut.push(order);
      await window.db.put('orders', order);
    }

    // ── 6. Specimens ──────────────────────────────────────────────────
    // Distribute states realistically. State of an order tracks specimen state.
    const STATE_DIST = [
      { value: 'completed',   weight: 50 },
      { value: 'in_analysis', weight: 25 },
      { value: 'received',    weight: 12 },
      { value: 'in_transit',  weight: 5 },
      { value: 'rejected',    weight: 5 },
      { value: 'pending',     weight: 3 },
    ];
    const specimensOut = [];
    let accessionSeq = 1;
    for (const order of ordersOut) {
      const nSpecs = pickWeighted([
        { value: 1, weight: 6 },
        { value: 2, weight: 3 },
        { value: 3, weight: 1 },
      ]);
      for (let s = 0; s < nSpecs; s++) {
        const stype = pick(SPECIMEN_TYPES);
        const state = pickWeighted(STATE_DIST);
        const collectedAt = (state === 'pending') ? null : order.orderedAt + intBetween(20, 120) * 60 * 1000;
        const receivedAt  = (state === 'pending' || state === 'in_transit') ? null
                          : (collectedAt || order.orderedAt) + intBetween(15, 60) * 60 * 1000;
        const condition = pickWeighted([
          { value: 'ACCEPTABLE',    weight: 90 },
          { value: 'HEMOLYZED_MILD',weight: 4 },
          { value: 'LIPEMIC_MILD',  weight: 2 },
          { value: 'CLOTTED',       weight: 2 },
          { value: 'INSUFFICIENT_VOLUME', weight: 1 },
          { value: 'MISLABELED',    weight: 1 },
        ]);
        const isHeme = order.testIds.some(tid => {
          const code = Object.keys(testIdByCode).find(c => testIdByCode[c] === tid);
          return code && ['WBC','RBC','HGB','HCT','PLT'].includes(code);
        });
        const isChem = order.testIds.some(tid => {
          const code = Object.keys(testIdByCode).find(c => testIdByCode[c] === tid);
          return code && ['GLU','BUN','CR','NA','K','CL','TROP'].includes(code);
        });
        const routedTo = (state === 'in_analysis' || state === 'completed')
          ? (isHeme ? instIdByCode['xn-550'] : isChem ? pick([instIdByCode['cobas-c303'], instIdByCode['au480']]) : null)
          : null;
        const ymd = new Date(receivedAt || collectedAt || order.orderedAt).toISOString().slice(0,10).replace(/-/g,'');
        const spec = window.schema.newSpecimen({
          id: id('spec', accessionSeq),
          accessionNumber: ymd + '-' + String(accessionSeq).padStart(4, '0'),
          barcode: 'BC' + String(100000 + accessionSeq),
          orderId: order.id, patientId: order.patientId,
          type: stype.type, container: stype.container,
          collectedAt, receivedAt,
          state,
          condition,
          rejectReason: state === 'rejected' ? pick(['Clotted','Hemolyzed','Insufficient volume','Mislabeled']) : '',
          routedTo,
          flags: condition.startsWith('HEMOLYZED') ? ['hemolyzed'] : condition.startsWith('LIPEMIC') ? ['lipemic'] : [],
        });
        await window.db.put('specimens', spec);
        specimensOut.push(spec);
        accessionSeq++;
      }
      // Update order status to reflect specimen states
      const orderSpecs = specimensOut.filter(s => s.orderId === order.id);
      const allTerminal = orderSpecs.every(s => ['completed','rejected'].includes(s.state));
      const anyAnalysis = orderSpecs.some(s => s.state === 'in_analysis');
      const status = allTerminal ? 'completed' : anyAnalysis ? 'in_progress' : (orderSpecs.some(s => s.state === 'received') ? 'in_progress' : 'open');
      await window.db.put('orders', { ...order, status });
    }

    // ── 7. Results ────────────────────────────────────────────────────
    // For each specimen in_analysis or completed, generate a result per test.
    const resultsOut = [];
    let resSeq = 1;
    for (const spec of specimensOut) {
      if (!['in_analysis','completed','received'].includes(spec.state)) continue;
      const order = ordersOut.find(o => o.id === spec.orderId);
      if (!order) continue;
      const patient = patients.find(p => p.id === spec.patientId);
      for (const tid of order.testIds) {
        // For 'received' state, only ~30% of tests have a result yet
        if (spec.state === 'received' && rand() > 0.3) continue;
        const code = Object.keys(testIdByCode).find(c => testIdByCode[c] === tid);
        const test = TESTS.find(t => t.code === code);
        if (!test) continue;
        const { value, flag, range } = valueWithFlag(test, patient ? patient.sex : '');
        // Status mostly final on completed, mix on in_analysis
        const status = spec.state === 'completed'
          ? pickWeighted([{value:'final',weight:8},{value:'corrected',weight:1},{value:'cancelled',weight:0.2}])
          : 'preliminary';
        const resultedAt = (spec.receivedAt || spec.collectedAt || order.orderedAt) + intBetween(5, 90) * 60 * 1000;
        const verifiedAt = status === 'final' || status === 'corrected'
          ? resultedAt + intBetween(2, 30) * 60 * 1000
          : null;
        const releasedAt = verifiedAt && rand() < 0.85 ? verifiedAt + intBetween(1, 60) * 60 * 1000 : null;

        // Critical aging — for ~half of HH/LL we leave them unacked at varied ages
        // so the escalation chain has demoable T0/T1/T2 entries. The rest are acked.
        const isCritical = ['LL','HH'].includes(flag) || (flag === 'A' && code === 'TROP');
        let criticalAckedAt = null, criticalAckedBy = null;
        let criticalEscalatedAt = null, criticalEscalationTier = 0;
        if (isCritical && releasedAt) {
          const ageBucket = rand();
          if (ageBucket < 0.5) {
            // Acknowledged
            criticalAckedAt = releasedAt + intBetween(5, 40) * 1000;
            criticalAckedBy = 'demo-supervisor';
          } else {
            // Unacked — set releasedAt to a recent point so escalation visibly fires
            const secondsAgo = pickWeighted([
              { value: 20,  weight: 2 },   // T0 (no escalation yet)
              { value: 60,  weight: 3 },   // T1 (45–90s window)
              { value: 120, weight: 2 },   // T2 (>90s)
            ]);
            const overrideRel = NOW - secondsAgo * 1000;
            // Apply via a new `releasedAt` later
            criticalEscalationTier = secondsAgo >= 90 ? 2 : secondsAgo >= 45 ? 1 : 0;
            criticalEscalatedAt = criticalEscalationTier ? overrideRel + (criticalEscalationTier === 1 ? 45000 : 90000) : null;
            // Mutate releasedAt for this result so the watcher will agree on tier
            // This is ok since seeds are write-once
            // Use the override:
            const result = window.schema.newResult({
              id: id('res', resSeq++),
              specimenId: spec.id, testId: tid,
              value, units: test.units,
              refRangeLow: range.low, refRangeHigh: range.high,
              refRangeSource: (test.femaleRange && patient && patient.sex === 'F') ? 'matched' : 'default',
              flag, status,
              criticalAckedAt, criticalAckedBy,
              criticalEscalatedAt, criticalEscalationTier,
              verifiedBy: verifiedAt ? 'demo-tech' : null, verifiedAt,
              releasedAt: overrideRel, releasedBy: overrideRel ? 'demo-supervisor' : null,
              deliveredAt: null, deliveredVia: '', deliveryStatus: 'pending',
              instrumentId: spec.routedTo,
              comments: '',
              resultedAt,
            });
            await window.db.put('results', result);
            resultsOut.push(result);
            continue;
          }
        }

        // Delivery state
        const deliveryStatus = !releasedAt ? 'pending'
          : pickWeighted([
              { value: 'delivered', weight: 75 },
              { value: 'pending',   weight: 15 },
              { value: 'failed',    weight: 5 },
              { value: 'manual',    weight: 5 },
            ]);
        const deliveredAt = deliveryStatus === 'delivered' && releasedAt
          ? releasedAt + intBetween(1, 20) * 60 * 1000 : null;

        const result = window.schema.newResult({
          id: id('res', resSeq++),
          specimenId: spec.id, testId: tid,
          value, units: test.units,
          refRangeLow: range.low, refRangeHigh: range.high,
          refRangeSource: (test.femaleRange && patient && patient.sex === 'F') ? 'matched' : 'default',
          flag, status,
          criticalAckedAt, criticalAckedBy,
          verifiedBy: verifiedAt ? 'demo-tech' : null, verifiedAt,
          releasedAt, releasedBy: releasedAt ? 'demo-supervisor' : null,
          deliveredAt, deliveredVia: deliveredAt ? pick(['fax','hl7','portal','email']) : '',
          deliveryStatus,
          instrumentId: spec.routedTo,
          comments: rand() < 0.1 ? pick(['Repeat confirmed','Lipemic — cleared by ultracentrifuge','Mid-run instrument calibrated']) : '',
          resultedAt,
        });
        await window.db.put('results', result);
        resultsOut.push(result);
      }
    }

    // ── 8. QC chain ───────────────────────────────────────────────────
    // 3 levels for GLU and HGB, ~20 results per level over the past 5 days.
    // Mostly in-control with a few isolated 1-2s warnings and one 1-3s rejection
    // to populate the violations table.
    const qcOut = [];
    for (const code of ['GLU','HGB']) {
      const test = TESTS.find(t => t.code === code);
      const tid = testIdByCode[code];
      const mean = (test.low + test.high) / 2;
      const sd = (test.high - test.low) / 6; // ~99.7% inside ±3SD
      for (const lev of ['L1','L2','L3']) {
        const level = window.schema.newQcLevel({
          id: id('qclvl', code + '_' + lev),
          testId: tid, level: lev,
          material: 'BioRad Lyphochek ' + lev,
          lotNumber: code + '-LOT-' + intBetween(1000, 9999),
          mean, sd, units: test.units,
          // Pin one to expire soon for the lot-expiry pill
          lotExpiresAt: (code === 'GLU' && lev === 'L2')
            ? NOW + 5 * DAY
            : NOW + intBetween(60, 365) * DAY,
        });
        await window.db.put('qc_levels', level);

        for (let q = 0; q < 18; q++) {
          // Most z-scores within ±1; occasional ±2.x; one ±3 outlier per level
          let zScore;
          if (q === 17) zScore = (rand() < 0.5 ? -1 : 1) * floatBetween(2.1, 3.4);  // last one's an outlier
          else zScore = floatBetween(-1.5, 1.5);
          const value = Number((mean + zScore * sd).toFixed(2));
          const ranAt = NOW - (5 - Math.floor(q / 4)) * DAY - intBetween(0, 23) * 60 * 60 * 1000;
          const status = Math.abs(zScore) > 3 ? 'out_of_control'
                        : Math.abs(zScore) > 2 ? 'warn' : 'in_control';
          const violations = Math.abs(zScore) > 3 ? [{ rule: '1-3s', severity: 'reject' }]
                           : Math.abs(zScore) > 2 ? [{ rule: '1-2s', severity: 'warn' }] : [];
          const qcr = window.schema.newQcResult({
            id: id('qcres', code + '_' + lev + '_' + q),
            qcLevelId: level.id, testId: tid,
            value, zScore: Number(zScore.toFixed(3)),
            status, violations,
            ranAt, enteredManually: false,
          });
          await window.db.put('qc_results', qcr);
          qcOut.push(qcr);

          if (status === 'out_of_control') {
            const v = window.schema.newQcRuleViolation({
              id: id('qcviol', code + '_' + lev + '_' + q),
              qcLevelId: level.id, testId: tid,
              rule: '1-3s', severity: 'reject',
              triggerQcResultId: qcr.id,
              affectedQcResultIds: [qcr.id],
              createdAt: ranAt,
            });
            await window.db.put('qc_violations', v);
          }
        }
      }
    }

    // ── 9. Notifications ─────────────────────────────────────────────
    // A handful of role-targeted escalation entries so the bell drawer
    // isn't empty and the Activity Log "Notify" filter has matches.
    const criticalsUnacked = resultsOut.filter(r => !r.criticalAckedAt && r.criticalEscalationTier > 0);
    for (const c of criticalsUnacked.slice(0, 6)) {
      const notif = window.schema.newNotification({
        id: id('notif', c.id.slice(-6)),
        kind: 'role',
        target: c.criticalEscalationTier === 2 ? 'LAB_DIRECTOR' : 'LAB_SUPERVISOR',
        msg: 'T' + c.criticalEscalationTier + ' ESCALATION — critical result unacknowledged',
        ctx: { resultId: c.id, specimenId: c.specimenId },
        createdAt: c.criticalEscalatedAt || NOW - 60 * 1000,
      });
      await window.db.put('notifications', notif);
    }

    // ── 10. Audit events (manually written so Activity Log isn't empty) ──
    // We don't want to publish events.* and re-trigger rule cascades, so
    // we just write canonical audit_event records for the timestamps we
    // already created. Sample: per-order created event, per-result released.
    let auditSeq = 1;
    const writeAudit = async (type, entityType, entityId, ts, actor = 'system', extra = {}) => {
      await window.db.put('audit_events', window.schema.newAuditEvent({
        id: id('aud', auditSeq++),
        type, actor, entityType, entityId,
        payload: { entityType, entityId, ...extra },
        ts,
      }));
    };
    for (const o of ordersOut) await writeAudit('order.created', 'order', o.id, o.orderedAt, 'demo-tech');
    for (const s of specimensOut.filter(x => x.receivedAt)) {
      await writeAudit('specimen.received', 'specimen', s.id, s.receivedAt, 'demo-accessioner');
    }
    for (const s of specimensOut.filter(x => x.routedTo)) {
      await writeAudit('specimen.routed', 'specimen', s.id, s.receivedAt + 5 * 60 * 1000, 'demo-tech', { routedTo: s.routedTo });
    }
    for (const s of specimensOut.filter(x => x.state === 'completed')) {
      await writeAudit('specimen.completed', 'specimen', s.id, (s.receivedAt || NOW) + 60 * 60 * 1000, 'sim');
    }
    for (const r of resultsOut.filter(x => x.verifiedAt)) {
      await writeAudit('result.verified', 'result', r.id, r.verifiedAt, r.verifiedBy);
    }
    for (const r of resultsOut.filter(x => x.releasedAt)) {
      await writeAudit('result.released', 'result', r.id, r.releasedAt, r.releasedBy);
    }
    for (const r of resultsOut.filter(x => ['LL','HH','A'].includes(x.flag) && x.releasedAt)) {
      await writeAudit('result.critical', 'result', r.id, r.releasedAt + 1000, 'system');
      if (r.criticalEscalatedAt) {
        await writeAudit('result.critical.escalated', 'result', r.id, r.criticalEscalatedAt, 'system', {
          tier: r.criticalEscalationTier,
        });
      }
    }

    return {
      patients: patients.length,
      clients: CLIENTS.length,
      locations: LOCATIONS.length,
      tests: TESTS.length,
      instruments: INSTRUMENTS.length,
      orders: ordersOut.length,
      specimens: specimensOut.length,
      results: resultsOut.length,
      qcResults: qcOut.length,
      notifications: criticalsUnacked.slice(0, 6).length,
      criticalsUnacked: criticalsUnacked.length,
      auditEventsWritten: auditSeq - 1,
    };
  };

  window.seed = { demo, clear, PREFIX };

})();
