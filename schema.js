// schema.js — Lattice LIS entity factories
//
// Real schema. No dummy data. Factories produce blank-but-shaped records.
// Every record gets an id and timestamps. Optional fields are nulled, not omitted,
// so the shape is consistent across reads.
//
// Inventory:
//   Patient        — demographics, MRN
//   Order          — request for tests on a patient (one or more tests)
//   Specimen       — physical sample, attached to an order
//   Test           — analyte definition (catalogue)
//   Result         — measured value for a (specimen, test)
//   Instrument     — analyzer
//   Worklist       — queue of specimens for an instrument
//   Interface      — external system feed (HL7, FHIR, ASTM)
//   Rule           — composable rule (trigger + conditions + actions)
//   AuditEvent     — append-only audit log

const __id = (prefix) => prefix + '_' +
  Math.random().toString(36).slice(2, 10) +
  Date.now().toString(36).slice(-4);

const __time = (v, fallback = null) => {
  if (v == null || v === '') return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = new Date(v).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
};

const newPatient = (init = {}) => ({
  id: init.id || __id('pat'),
  mrn: init.mrn || '',
  lastName: init.lastName || '',
  firstName: init.firstName || '',
  middleName: init.middleName || '',
  dob: init.dob || '',                 // YYYY-MM-DD
  sex: init.sex || '',                  // 'M' | 'F' | 'X' | ''
  phone: init.phone || '',
  email: init.email || '',
  address: init.address || null,
  // Patient-preferred contact channel for non-result correspondence. Result
  // delivery itself follows order.deliveryChannel + client.deliveryChannel
  // overrides — see `delivery-watcher.js`. Empty falls back to client default.
  preferredContact: init.preferredContact || '',  // ''|'phone'|'email'|'mail'|'portal'
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const newOrder = (init = {}) => ({
  id: init.id || __id('ord'),
  orderNumber: init.orderNumber || '',
  placerOrderNumber: init.placerOrderNumber || '',
  fillerOrderNumber: init.fillerOrderNumber || init.orderNumber || '',
  patientId: init.patientId || null,
  providerId: init.providerId || null,
  // Outreach: the "client" is the referring clinic that placed the order.
  // Distinct from `facility` (the receiving lab's site name).
  clientId: init.clientId || null,
  // Where the order is physically processed. `locationId` is the FK into the
  // `locations` collection (preferred); `facility` is a free-text fallback
  // kept for back-compat with older records that pre-date the Locations admin.
  // Display resolution prefers locationId → location.name; falls through to
  // the string when locationId is unset.
  locationId: init.locationId || null,
  facility: init.facility || '',
  priority: init.priority || 'routine',  // 'stat' | 'asap' | 'routine'
  status: init.status || 'open',         // 'open' | 'in_progress' | 'completed' | 'cancelled'
  testIds: init.testIds || [],
  diagnosisCodes: init.diagnosisCodes || [],
  notes: init.notes || '',
  // Per-order delivery override. Empty = inherit from client (the standard
  // outreach pattern: client.deliveryChannel is the default; an individual
  // order can override for stat-faxes, urgent-portal, etc.).
  deliveryChannel: init.deliveryChannel || '',     // ''|'fax'|'hl7'|'portal'|'email'|'print'|'manual'
  deliveryEndpoint: init.deliveryEndpoint || '',
  orderedAt: __time(init.orderedAt, Date.now()),
  collectedAt: __time(init.collectedAt, null),
  receivedAt: __time(init.receivedAt, null),
  // TAT (turnaround time) state. Computed and stamped by `tat-watcher.js`.
  // - tatBreachLevel: 'ok' until elapsed crosses warn threshold, then 'warn',
  //   then 'breach'. Resets to 'ok' once the order completes/cancels (the
  //   watcher leaves terminal orders alone, but a manual reopen would).
  // - tatNotifiedLevel: highest level a notification has fired for. Prevents
  //   re-firing on every scan tick. Cleared if thresholds are edited downward
  //   so reconfigured limits surface fresh alerts.
  // - tatBreachedAt: ms timestamp of the first 'breach' transition; powers the
  //   "elapsed since breach" pill on the orders list / drawer.
  tatBreachLevel: init.tatBreachLevel || 'ok',     // 'ok' | 'warn' | 'breach'
  tatNotifiedLevel: init.tatNotifiedLevel || 'ok', // 'ok' | 'warn' | 'breach'
  tatBreachedAt: init.tatBreachedAt || null,
  tatThresholdMin: init.tatThresholdMin == null ? null : Number(init.tatThresholdMin),
  tatThresholdSource: init.tatThresholdSource || '', // ''|'priority'|'test'
  tatThresholdTestId: init.tatThresholdTestId || null,
  tatPausedMs: init.tatPausedMs == null ? 0 : Number(init.tatPausedMs) || 0,
  tatPauseStartedAt: init.tatPauseStartedAt || null,
  tatPauseReason: init.tatPauseReason || '',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// Client = referring clinic / outreach customer. The lab's "customer" account,
// distinct from a Facility (which is one of the lab's own sites).
const newClient = (init = {}) => ({
  id: init.id || __id('cli'),
  code: init.code || '',                    // short mnemonic ("STJOSEPH", "FAMCARE")
  name: init.name || '',                    // display name
  type: init.type || 'CLINIC',              // 'CLINIC' | 'HOSPITAL' | 'PHYSICIAN_OFFICE' | 'OTHER'
  contactName: init.contactName || '',
  phone: init.phone || '',
  fax: init.fax || '',
  email: init.email || '',
  address: init.address || null,
  // Result delivery preference — drives the outbound channel after release.
  deliveryChannel: init.deliveryChannel || 'fax',  // 'fax' | 'hl7' | 'portal' | 'email' | 'print'
  deliveryEndpoint: init.deliveryEndpoint || '',    // fax #, HL7 endpoint id, portal url, etc.
  // Billing
  billType: init.billType || 'CLIENT',     // 'CLIENT' | 'PATIENT' | 'INSURANCE' (override per order)
  active: init.active === undefined ? true : init.active,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const newSpecimen = (init = {}) => ({
  id: init.id || __id('spec'),
  accessionNumber: init.accessionNumber || '',
  barcode: init.barcode || '',
  orderId: init.orderId || null,
  patientId: init.patientId || null,
  type: init.type || '',               // 'serum' | 'plasma' | 'whole_blood' | 'urine' | …
  container: init.container || '',      // 'sst' | 'lavender' | 'green' | 'cup' | …
  volume: init.volume || null,
  collectedAt: init.collectedAt || null,
  receivedAt: init.receivedAt || null,
  state: init.state || 'pending',       // 'pending'|'in_transit'|'received'|'in_analysis'|'completed'|'rejected'
  // Condition is always captured at accessioning (Harvest / outreach LIS convention).
  // Acceptable codes per Appendix A — the "ACCEPTABLE" default lets keyboard flow stay fast.
  condition: init.condition || 'ACCEPTABLE',
  rejectReason: init.rejectReason || '',
  routedTo: init.routedTo || null,      // instrument id
  flags: init.flags || [],
  notes: init.notes || '',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const SPECIMEN_CONDITIONS = [
  // Acceptable
  { id: 'ACCEPTABLE',          label: 'Acceptable',           tone: 'sage',  ok: true },
  // Hemolyzed
  { id: 'HEMOLYZED_MILD',      label: 'Hemolyzed (mild)',     tone: 'amber', flag: 'hemolyzed' },
  { id: 'HEMOLYZED_MODERATE',  label: 'Hemolyzed (moderate)', tone: 'amber', flag: 'hemolyzed' },
  { id: 'HEMOLYZED_GROSS',     label: 'Hemolyzed (gross)',    tone: 'rust',  flag: 'hemolyzed', reject: true },
  // Lipemic
  { id: 'LIPEMIC_MILD',        label: 'Lipemic (mild)',       tone: 'amber', flag: 'lipemic' },
  { id: 'LIPEMIC_MODERATE',    label: 'Lipemic (moderate)',   tone: 'amber', flag: 'lipemic' },
  { id: 'LIPEMIC_GROSS',       label: 'Lipemic (gross)',      tone: 'rust',  flag: 'lipemic', reject: true },
  // Icteric
  { id: 'ICTERIC_MILD',        label: 'Icteric (mild)',       tone: 'amber', flag: 'icteric' },
  { id: 'ICTERIC_MODERATE',    label: 'Icteric (moderate)',   tone: 'amber', flag: 'icteric' },
  { id: 'ICTERIC_GROSS',       label: 'Icteric (gross)',      tone: 'rust',  flag: 'icteric', reject: true },
  // Pre-analytical failures (typically reject)
  { id: 'CLOTTED',             label: 'Clotted',              tone: 'rust',  flag: 'clotted',  reject: true },
  { id: 'INSUFFICIENT_VOLUME', label: 'Insufficient volume',  tone: 'rust',  reject: true },
  { id: 'IMPROPER_CONTAINER',  label: 'Improper container',   tone: 'rust',  reject: true },
  { id: 'UNLABELED',           label: 'Unlabeled',            tone: 'rust',  reject: true },
  { id: 'MISLABELED',          label: 'Mislabeled',           tone: 'rust',  reject: true },
  { id: 'LEAKED',              label: 'Leaked',               tone: 'rust',  reject: true },
  { id: 'BROKEN',              label: 'Broken',               tone: 'rust',  reject: true },
  { id: 'EXPIRED',             label: 'Expired',              tone: 'rust',  reject: true },
  { id: 'OTHER',               label: 'Other (note)',         tone: 'amber' },
];

const newResult = (init = {}) => ({
  id: init.id || __id('res'),
  specimenId: init.specimenId || null,
  testId: init.testId || null,
  value: init.value === undefined ? null : init.value,
  units: init.units || '',
  refRangeLow: init.refRangeLow == null ? null : init.refRangeLow,
  refRangeHigh: init.refRangeHigh == null ? null : init.refRangeHigh,
  refRangeSource: init.refRangeSource || '',  // '' | 'matched' | 'default' | 'none'
  refRangeId: init.refRangeId || null,        // id of the test.referenceRanges entry that resolved
  flag: init.flag || '',                  // '' | 'L' | 'H' | 'LL' | 'HH' | 'A'
  status: init.status || 'pending',       // 'pending'|'preliminary'|'final'|'corrected'|'cancelled'
  // Critical-result acknowledgment + escalation tracking. Set by the
  // critical-alerts banner (ack) and the critical-escalation watcher (escalate).
  criticalAckedAt: init.criticalAckedAt || null,
  criticalAckedBy: init.criticalAckedBy || null,
  criticalAckNote: init.criticalAckNote || '',
  criticalEscalatedAt: init.criticalEscalatedAt || null,  // timestamp of last escalation fire
  criticalEscalationTier: init.criticalEscalationTier == null ? 0 : init.criticalEscalationTier,  // 0 = none, 1 = supervisor, 2 = director/oncall
  verifiedBy: init.verifiedBy || null,
  verifiedAt: init.verifiedAt || null,
  releasedAt: init.releasedAt || null,
  releasedBy: init.releasedBy || null,
  // Outbound delivery to the ordering client (fax/hl7/portal/email/print).
  // Owned by the delivery watcher: written when result.released propagates
  // through. Re-deliveries append to deliveryAttempts; deliveredAt holds the
  // most recent successful delivery (null if none).
  deliveredAt: init.deliveredAt || null,
  deliveredVia: init.deliveredVia || '',
  deliveredTo: init.deliveredTo || '',
  deliveryAttempts: init.deliveryAttempts || [],
  deliveryStatus: init.deliveryStatus || '',  // ''|'pending'|'delivered'|'failed'|'manual'
  instrumentId: init.instrumentId || null,
  comments: init.comments || '',
  enteredManually: init.enteredManually || false,
  enteredBy: init.enteredBy || null,
  // Correction chain. When a released/final result needs to be amended,
  // a NEW record is created with `correctionOf` pointing to the prior id
  // and `status: 'corrected'`. The prior record is NEVER mutated — it
  // remains at status='final' (it really was final at the time it was
  // reported); display logic walks the chain to surface the latest.
  // Real labs treat this as an audit-trail religion — the only way to
  // amend a reported result without losing the original signal.
  correctionOf: init.correctionOf || null,         // previous result.id this supersedes
  correctionReason: init.correctionReason || '',   // free text, required by UI when issuing
  correctedBy: init.correctedBy || null,           // user.id who issued the correction
  correctedAt: init.correctedAt || null,           // timestamp of the correction record creation
  // Mirror field on the SUPERSEDED record. Stamped after the new corrected
  // record is written so a prior result can be displayed as "amended" without
  // walking the chain. Updates the prior record but does NOT change its status.
  supersededByResultId: init.supersededByResultId || null,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const newTest = (init = {}) => ({
  id: init.id || __id('test'),
  code: init.code || '',
  loinc: init.loinc || '',
  name: init.name || '',
  shortName: init.shortName || '',
  units: init.units || '',
  // Default range — used when no reference range entry matches a patient's demographics.
  // Treat as the "any sex, any age, no effective dating" fallback.
  refRangeLow: init.refRangeLow == null ? null : init.refRangeLow,
  refRangeHigh: init.refRangeHigh == null ? null : init.refRangeHigh,
  // Demographic-aware ranges. Resolution lives in `reference-ranges.js`:
  //   pickReferenceRange(test, { patient, asOf, method })
  // Each entry shape: see `newReferenceRange` below.
  referenceRanges: init.referenceRanges || [],
  specimenTypes: init.specimenTypes || [],
  containerTypes: init.containerTypes || [],
  turnaroundMinutes: init.turnaroundMinutes == null || init.turnaroundMinutes === '' ? null : Number(init.turnaroundMinutes),
  // Per-test critical-result escalation thresholds, in seconds. `null` (or any
  // non-finite / non-positive value) falls back to the watcher's global default
  // (see critical-escalation.js TIER1_MS / TIER2_MS). Real labs tune these
  // per-test: STAT troponin escalates faster than routine glucose.
  criticalEscalationT1Sec: init.criticalEscalationT1Sec == null ? null : Number(init.criticalEscalationT1Sec),
  criticalEscalationT2Sec: init.criticalEscalationT2Sec == null ? null : Number(init.criticalEscalationT2Sec),
  // Per-test "lot expiring soon" amber threshold, in days. `null` (or any
  // non-finite / non-positive value) falls back to the watcher's global
  // default (see lot-expiry-watcher.js SOON_DAYS = 14). Useful when a test's
  // QC reagent has a tighter shelf life than 14 days (e.g. some coag and
  // urine chemistries) and the lab wants earlier warning.
  lotExpirationAmberDays: init.lotExpirationAmberDays == null ? null : Number(init.lotExpirationAmberDays),
  // Per-test delta-check thresholds for the `result.delta.test` rules condition.
  // `null` (or any non-finite / non-positive value) means "no per-test gate" —
  // the condition returns false unless the threshold is explicitly set, so rules
  // author `result.delta.test` only for analytes that have a configured limit.
  // Percent threshold: absolute % change from prior result that triggers the rule.
  // Absolute threshold: absolute numeric change (in the test's units) that triggers.
  // Either can be set independently; the condition fires when EITHER is exceeded.
  deltaCheckPercent:  init.deltaCheckPercent  == null ? null : Number(init.deltaCheckPercent),
  deltaCheckAbsolute: init.deltaCheckAbsolute == null ? null : Number(init.deltaCheckAbsolute),
  active: init.active === undefined ? true : init.active,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// One row in `test.referenceRanges`. Nulls mean "wildcard" for filtering;
// blank `units` inherits from the parent test.
const newReferenceRange = (init = {}) => ({
  id: init.id || __id('rr'),
  low:           init.low == null ? null : Number(init.low),
  high:          init.high == null ? null : Number(init.high),
  units:         init.units || '',
  sex:           init.sex || 'any',          // 'any' | 'M' | 'F' | 'X'
  ageMinYears:   init.ageMinYears == null ? null : Number(init.ageMinYears),
  ageMaxYears:   init.ageMaxYears == null ? null : Number(init.ageMaxYears),
  method:        init.method || '',          // empty = any method
  effectiveFrom: init.effectiveFrom == null ? null : Number(init.effectiveFrom),
  effectiveTo:   init.effectiveTo   == null ? null : Number(init.effectiveTo),
  notes:         init.notes || '',
  createdAt:     init.createdAt || Date.now(),
  updatedAt:     Date.now(),
});

const newInstrument = (init = {}) => ({
  id: init.id || __id('inst'),
  name: init.name || '',
  vendor: init.vendor || '',
  model: init.model || '',
  serial: init.serial || '',
  status: init.status || 'idle',       // 'idle'|'running'|'maintenance'|'offline'|'error'
  testIds: init.testIds || [],
  interfaceId: init.interfaceId || null,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const newInterface = (init = {}) => ({
  id: init.id || __id('iface'),
  name: init.name || '',
  protocol: init.protocol || 'hl7v2',  // 'hl7v2'|'fhir'|'astm'|'custom'
  direction: init.direction || 'bidirectional',  // 'inbound'|'outbound'|'bidirectional'
  endpoint: init.endpoint || '',
  status: init.status || 'idle',
  lastSeenAt: init.lastSeenAt || null,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const newWorklist = (init = {}) => ({
  id: init.id || __id('wl'),
  name: init.name || '',
  instrumentId: init.instrumentId || null,
  specimenIds: init.specimenIds || [],
  status: init.status || 'open',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

const newAuditEvent = (init = {}) => ({
  id: init.id || __id('aud'),
  type: init.type || '',
  actor: init.actor || 'system',
  // Frozen role snapshot at action time. Optional — older records didn't
  // carry this; consumers should treat missing as `[]` not as an error.
  // Never inferred from `actor` at read time, which is what makes it a
  // *snapshot* and not a live join. Set by events.js publish() automatically
  // when the actor maps to a real user; callers can override by passing a
  // pre-resolved `actorRoles` array in payload.
  actorRoles: Array.isArray(init.actorRoles) ? init.actorRoles.filter(r => typeof r === 'string') : [],
  entityType: init.entityType || '',
  entityId: init.entityId || null,
  payload: init.payload || {},
  ts: init.ts || Date.now(),
});

// Persisted history of notification toasts (the in-memory toast component
// auto-dismisses; this is the durable record). Same shape as the event payload
// plus an `acknowledgedAt` field so users can mark items read.
const newNotification = (init = {}) => ({
  id: init.id || __id('not'),
  kind: init.kind || 'system',         // 'user'|'role'|'provider'|'system'
  target: init.target || '',
  msg: init.msg || '',
  ctx: init.ctx || {},                 // { orderId, specimenId, resultId } refs
  acknowledgedAt: init.acknowledgedAt || null,
  acknowledgedBy: init.acknowledgedBy || null,
  createdAt: init.createdAt || Date.now(),
});

// ── QC (Westgard) ───────────────────────────────────────────────────────
//
// QcLevel: a control material at a specific level for a specific test
// (e.g. "Glucose, BioRad Lyphochek L1, mean 90, SD 4"). The catalog row
// the running QC results compare against.
const newQcLevel = (init = {}) => ({
  id: init.id || __id('qcl'),
  testId: init.testId || null,
  level: init.level || 'L1',                         // 'L1'|'L2'|'L3' or freeform
  material: init.material || '',                     // vendor / product label
  lotNumber: init.lotNumber || '',
  lotExpiresAt: init.lotExpiresAt || null,
  mean: init.mean == null ? null : Number(init.mean),
  sd:   init.sd   == null ? null : Number(init.sd),
  units: init.units || '',                           // inherits from test if blank
  instrumentId: init.instrumentId || null,           // optional scope to a single instrument
  active: init.active === undefined ? true : init.active,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// QcResult: a single observation of a control level. zScore is computed
// at write time so downstream Westgard evaluation is a pure function over
// {zScore, ranAt} arrays.
const newQcResult = (init = {}) => ({
  id: init.id || __id('qcr'),
  qcLevelId: init.qcLevelId || null,
  testId: init.testId || null,                       // denormalized for fast filtering
  value: init.value == null ? null : Number(init.value),
  zScore: init.zScore == null ? null : Number(init.zScore),
  instrumentId: init.instrumentId || null,
  status: init.status || 'pending',                  // 'pending'|'in_control'|'warn'|'out_of_control'
  violations: init.violations || [],                 // [{rule,severity}], filled by evaluator
  ranAt: init.ranAt || Date.now(),
  enteredBy: init.enteredBy || null,
  enteredManually: init.enteredManually || false,
  notes: init.notes || '',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// QcRuleViolation: historical record of a Westgard rule firing. We keep
// them separate from QcResult so violation lifecycle (acknowledge / resolve)
// doesn't tangle with the underlying QC measurement record.
const newQcRuleViolation = (init = {}) => ({
  id: init.id || __id('qcv'),
  qcLevelId: init.qcLevelId || null,
  testId: init.testId || null,
  instrumentId: init.instrumentId || null,
  rule: init.rule || '',                             // '1-2s'|'1-3s'|'2-2s'|'R-4s'|'4-1s'|'10-x'
  severity: init.severity || 'warn',                 // 'warn'|'reject'
  triggerQcResultId: init.triggerQcResultId || null,
  affectedQcResultIds: init.affectedQcResultIds || [],
  acknowledgedAt: init.acknowledgedAt || null,
  acknowledgedBy: init.acknowledgedBy || null,
  resolvedAt: init.resolvedAt || null,
  notes: init.notes || '',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// Location — a facility / department / draw station the lab services.
// Orders pin a location via `order.facility` (string code today; rows can
// later carry the lookup id). Locations are also used by the dashboard
// for the "All Locations" filter.
const newLocation = (init = {}) => ({
  id: init.id || __id('loc'),
  code: init.code || '',                     // short mnemonic ("MAIN-LAB", "WSDS")
  name: init.name || '',                     // display name ("Main Lab", "Westside Draw Station")
  type: init.type || 'LAB',                  // 'LAB'|'DRAW_STATION'|'HOSPITAL'|'CLINIC'|'OTHER'
  parentId: init.parentId || null,           // optional: a draw station can belong to a lab
  address: init.address || null,             // { line1, city, state, postalCode } shape
  phone: init.phone || '',
  // Operating hours stored as plain text for now ("M-F 0700-1700"). Real
  // scheduling would land an array of weekday/time-range entries.
  hours: init.hours || '',
  // Departments / sections within the location. Free-form codes:
  // ['CHEMISTRY','HEMATOLOGY','MICROBIOLOGY']. UI shows them as pills.
  departments: Array.isArray(init.departments) ? init.departments : [],
  active: init.active === undefined ? true : init.active,
  notes: init.notes || '',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// LabelTemplate — a ZPL II template scoped to specimen type or test class.
// `labels.build` looks up the most-specific template (by specimenType, then
// testCode, then default). The body is a ZPL string with mustache-like
// `{patient_line}`, `{accession}`, `{barcode}` placeholders that the build
// step substitutes.
const newLabelTemplate = (init = {}) => ({
  id: init.id || __id('lbl'),
  code: init.code || '',                     // short mnemonic ("CHEM-DEFAULT")
  name: init.name || '',                     // display name
  // Scope predicate. Empty fields = wildcard. Most-specific match wins.
  specimenType: init.specimenType || '',     // 'serum'|'plasma'|'whole_blood'|...|''
  testCode: init.testCode || '',             // optional: "BLOOD-BANK" forces specific template
  // Output config
  width:  init.width  == null ? 2.0 : Number(init.width),    // inches (2.0×1.0 default)
  height: init.height == null ? 1.0 : Number(init.height),
  dpi:    init.dpi    == null ? 203 : Number(init.dpi),
  zpl:    init.zpl    || '',                 // raw ZPL II body with placeholders
  // Optional printer routing hint — the eventual transport layer reads this
  // to pick a destination (e.g., 'tcp://zebra-bench3:9100'). Not used today.
  printerEndpoint: init.printerEndpoint || '',
  active: init.active === undefined ? true : init.active,
  notes: init.notes || '',
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// ── Users & Roles ───────────────────────────────────────────────────────
//
// ROLES catalog: single source of truth for the role identifiers used by
// users, TAT routing, the safety modal's permission gates, and any future
// access-control surface. Adding a role here automatically makes it
// selectable in the Users admin page and selectable in TAT recipient
// pickers (because both surfaces enumerate this list directly).
//
// `tone` maps to the existing pill colors; the Users admin and audit log
// use it to color the role badge consistently with the rest of the UI.
const ROLES = [
  { id: 'LAB_DIRECTOR',         label: 'Lab Director',         tone: 'rust',  description: 'Final medical authority. Sign-out, abnormal/critical oversight.' },
  { id: 'LAB_SUPERVISOR',       label: 'Lab Supervisor',       tone: 'amber', description: 'Day-to-day lab operations, QC override authority, scheduling.' },
  { id: 'PATHOLOGIST',          label: 'Pathologist',          tone: 'rust',  description: 'Anatomic / clinical sign-out. Critical result review.' },
  { id: 'MEDICAL_TECHNOLOGIST', label: 'Medical Technologist', tone: 'sage',  description: 'Result release, manual entry, instrument operation.' },
  { id: 'LAB_ASSISTANT',        label: 'Lab Assistant',        tone: 'ghost', description: 'Accessioning, specimen handling, prep.' },
  { id: 'IT_ADMIN',             label: 'IT Admin',             tone: 'slate', description: 'System config, interfaces, mappers, label templates.' },
];
const ROLE_IDS = ROLES.map(r => r.id);
const ROLE_BY_ID = Object.fromEntries(ROLES.map(r => [r.id, r]));

// PERMISSIONS matrix: which roles can perform which permissioned actions.
// `userRoles.userHasPermission(userId, permission)` reads this; UI surfaces
// can use it to disable buttons proactively, and the safety modal uses it
// to gate the high-impact flows. Permissions absent from this map are
// treated as "no gate" (anyone may perform the action) — this keeps the
// matrix focused on the meaningful gates instead of needing an entry per
// click target.
const PERMISSIONS = {
  RELEASE_RESULT:       ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'PATHOLOGIST'],
  VERIFY_RESULT:        ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'PATHOLOGIST'],
  CORRECT_RESULT:       ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'PATHOLOGIST'],
  ACK_CRITICAL:         ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'PATHOLOGIST'],
  RESOLVE_QC:           ['LAB_DIRECTOR', 'LAB_SUPERVISOR'],
  EDIT_RULES:           ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'IT_ADMIN'],
  EDIT_LAB_CONFIG:      ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'IT_ADMIN'],
  EDIT_TEST_CATALOG:    ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'IT_ADMIN'],
  EDIT_USERS:           ['LAB_DIRECTOR', 'IT_ADMIN'],
  EDIT_INTERFACES:      ['IT_ADMIN'],
  EDIT_LABEL_TEMPLATES: ['IT_ADMIN'],
  RESTORE_SNAPSHOT:     ['LAB_DIRECTOR', 'IT_ADMIN'],
  ACCESSION:            ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'LAB_ASSISTANT'],
  CREATE_ORDER:         ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'LAB_ASSISTANT'],
};

// User factory. Filters role array against the ROLES catalog so unknown
// role ids from imports / hand-edited records can't poison the resolver.
// `status` is a hard 'ACTIVE' | 'INACTIVE' enum — anything else snaps to ACTIVE.
const __coerceUserRoles = (raw) => {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(ROLE_IDS);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    if (!allowed.has(r)) continue;
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
};
const newUser = (init = {}) => ({
  id: init.id || __id('usr'),
  username: init.username || '',
  firstName: init.firstName || '',
  lastName: init.lastName || '',
  email: init.email || '',
  credentials: Array.isArray(init.credentials)
    ? init.credentials.filter(c => typeof c === 'string')
    : [],
  roles: __coerceUserRoles(init.roles),
  facilityIds: Array.isArray(init.facilityIds)
    ? init.facilityIds.filter(f => typeof f === 'string')
    : [],
  status: init.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  // Password storage: salt + SHA-256 hash via auth.js (Web Crypto SubtleCrypto).
  // PROTOTYPE-GRADE — single-round SHA-256 with a per-user random salt is fine
  // for an in-browser-only LIS prototype; production needs PBKDF2 / argon2id
  // with proper work factors. Both fields are nullable: a user without a
  // passwordHash cannot log in (auth.verify returns reason: 'no password set').
  // Writing nulls is intentional, not a sentinel for "no password ever required".
  passwordHash: init.passwordHash || null,
  passwordSalt: init.passwordSalt || null,
  passwordSetAt: init.passwordSetAt || null,
  passwordSource: init.passwordSource || null,
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// LabConfig — installation-level singleton. Exactly one row, fixed id.
// Holds settings that apply lab-wide regardless of test or instrument.
//   qcDisabledRules: Westgard rule IDs that should NOT trigger violations.
//     Some labs disable 1-2s as advisory-only or skip 4-1s for a specific
//     workflow. Unknown / invalid IDs are silently ignored at evaluator time.
//   tatThresholds: per-priority TAT targets in MINUTES. Order's
//     `orderedAt → releasedAt-of-last-test` interval is compared against
//     these by `tat-watcher.js`. Defaults reflect typical hospital lab
//     targets (STAT 1h, ASAP 4h, Routine 24h) and are user-editable in the
//     Notifications admin page.
//   tatWarnAtPercent: percent of the threshold at which the watcher flips
//     an order to `tatBreachLevel='warn'`. Default 80%. Below this is `ok`,
//     above the full threshold is `breach`.
//   tatRecipients: notification target roles. The watcher publishes
//     `notification` events with kind='role' and target=each entry, so the
//     existing toast / drawer / bell surfaces light up without bespoke wiring.
//   tatRecipientsByPriority: optional per-priority override map. Shape
//     { stat?: string[], asap?: string[], routine?: string[] }. A priority
//     missing from the map (or with an empty array, after coercion drops it)
//     inherits from the default `tatRecipients` list. STAT can page Director
//     + Pathologist while Routine pages only Supervisor — same lab, different
//     escalation rosters.
const LAB_CONFIG_ID = 'lab_config';
const TAT_THRESHOLD_DEFAULTS = { stat: 60, asap: 240, routine: 1440 };
const TAT_RECIPIENTS_DEFAULT = ['LAB_SUPERVISOR'];
const TAT_PRIORITY_KEYS = ['stat', 'asap', 'routine'];
const __coerceTatThresholds = (raw) => {
  const out = { ...TAT_THRESHOLD_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(out)) {
    const v = Number(raw[k]);
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
};
// Coerce per-priority overrides. Empty/non-array entries are dropped so the
// resolver falls back to `tatRecipients`. Strings-only filter prevents weird
// payloads from import/restore poisoning the UI.
const __coerceTatRecipientsByPriority = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const pri of TAT_PRIORITY_KEYS) {
    if (!Array.isArray(raw[pri])) continue;
    const filtered = raw[pri].filter(r => typeof r === 'string');
    if (filtered.length > 0) out[pri] = filtered;
  }
  return out;
};
const newLabConfig = (init = {}) => ({
  id: LAB_CONFIG_ID,                                      // fixed singleton id
  // Lab identity — shown on printed result reports and in the System Setup page.
  labName:          init.labName          || '',
  labClia:          init.labClia          || '',
  labDirectorName:  init.labDirectorName  || '',
  labPhone:         init.labPhone         || '',
  labAddress:       init.labAddress       || '',
  qcDisabledRules: Array.isArray(init.qcDisabledRules)
    ? init.qcDisabledRules.filter(r => typeof r === 'string')
    : [],
  tatThresholds: __coerceTatThresholds(init.tatThresholds),
  tatWarnAtPercent: (() => {
    const v = Number(init.tatWarnAtPercent);
    return Number.isFinite(v) && v > 0 && v < 100 ? v : 80;
  })(),
  tatRecipients: Array.isArray(init.tatRecipients) && init.tatRecipients.length
    ? init.tatRecipients.filter(r => typeof r === 'string')
    : [...TAT_RECIPIENTS_DEFAULT],
  tatRecipientsByPriority: __coerceTatRecipientsByPriority(init.tatRecipientsByPriority),
  createdAt: init.createdAt || Date.now(),
  updatedAt: Date.now(),
});

// Accession number generation. YYYYMMDD-NNNN local sequence.
// Pure function — caller passes today's existing count.
const nextAccessionNumber = (existingCountToday) => {
  const d = new Date();
  const ymd = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const seq = String((existingCountToday || 0) + 1).padStart(4, '0');
  return ymd + '-' + seq;
};

// ───────────────────────────────────────────────────────────────────────────
// Delivery channel registry
//
// One source of truth for "how does a result leave the lab?" — the order form
// (per-order override), the client editor (client-level default), the
// entity drawer (display), and the delivery watcher (consumer) all read from
// here. Adding a new channel (FHIR, SFTP, S3 dropbox, custom REST) means
// adding one entry below — every UI surface picks it up automatically.
//
// Shape of each entry:
//   id             — kebab-case identifier persisted on order.deliveryChannel
//                    and client.deliveryChannel. Treat as opaque.
//   label          — operator-facing label shown in the select.
//   endpointLabel  — operator-facing label for the endpoint input
//                    (changes per channel: "Fax number", "MLLP target", etc.).
//   placeholder    — example value shown in the empty endpoint input.
//   hint           — one-line explanation rendered under the input (optional).
//   validate(s)    — pure function. returns true when the endpoint string
//                    looks plausible. Non-blocking — operators sometimes
//                    enter custom strings the regex doesn't anticipate;
//                    UI surfaces a warning, not an error.
//   normalize(s)   — pure function. returns the canonical form to persist
//                    (lowercased domain, trimmed whitespace, etc.).
//   available      — false hides the channel from new pickers but keeps it
//                    readable on existing records, so a feature can be
//                    rolled back without losing data.
//   sample         — example output of normalize() — used in seed data and
//                    docs so we don't drift.
//
// Validation is intentionally permissive. The LIS should warn the operator
// about a malformed endpoint, but should never refuse to save — a clinic
// might have a non-standard target the lab needs to handle.
const DELIVERY_CHANNELS = [
  {
    id: 'fax',
    label: 'Fax',
    endpointLabel: 'Fax number',
    placeholder: '555-555-5555',
    hint: '10-digit North-American or international with leading +. Hyphens and spaces are ignored.',
    validate: (s) => /^\+?[\d().\-\s]{7,20}$/.test(String(s).trim()),
    normalize: (s) => String(s).trim().replace(/[^\d+]/g, ''),
    available: true,
    sample: '5550101',
  },
  {
    id: 'hl7',
    label: 'HL7 over MLLP',
    endpointLabel: 'MLLP target',
    placeholder: 'tcp://emr-west:6661',
    hint: 'tcp://host:port — the framer wraps ORU-R01 in VT/FS+CR per HL7 LLP. Real socket transport ships with the Electron port (Tier 6).',
    validate: (s) => /^(tcp|hl7):\/\/[a-z0-9._-]+:\d{2,5}$/i.test(String(s).trim()),
    normalize: (s) => String(s).trim().toLowerCase(),
    available: true,
    sample: 'tcp://emr-west:6661',
  },
  {
    id: 'portal',
    label: 'Patient portal',
    endpointLabel: 'Portal handle',
    placeholder: 'metro-portal',
    hint: 'Slug the destination portal uses to scope deliveries. Lowercase, alphanumeric + dot/dash/underscore.',
    validate: (s) => /^[a-z0-9][a-z0-9._-]{1,63}$/i.test(String(s).trim()),
    normalize: (s) => String(s).trim().toLowerCase(),
    available: true,
    sample: 'metro-portal',
  },
  {
    id: 'email',
    label: 'Email',
    endpointLabel: 'Email address',
    placeholder: 'results@clinic.example',
    hint: 'Single deliverable inbox. Multiple recipients should live on the client record, not here.',
    validate: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim()),
    normalize: (s) => String(s).trim().toLowerCase(),
    available: true,
    sample: 'results@clinic.example',
  },
  {
    id: 'print',
    label: 'Print / Courier',
    endpointLabel: 'Printer or route',
    placeholder: 'lab-printer-3',
    hint: 'Named printer or courier route. Empty falls back to the lab default printer.',
    validate: () => true, // free-form
    normalize: (s) => String(s).trim(),
    available: true,
    sample: 'lab-printer-3',
  },
  {
    id: 'manual',
    label: 'Manual / hold',
    endpointLabel: 'Note',
    placeholder: 'Hand-deliver, walk-in pickup, …',
    hint: 'No automated delivery. Operator must hand-deliver or release through the Results page.',
    validate: () => true,
    normalize: (s) => String(s).trim(),
    available: true,
    sample: 'walk-in pickup',
  },
  // ── future channels — flip `available: true` to surface in pickers ────
  // Persisted values on existing records still render even while hidden, so
  // pilots can roll a channel back without data loss.
  {
    id: 'fhir',
    label: 'FHIR R4 endpoint',
    endpointLabel: 'FHIR base URL',
    placeholder: 'https://emr.example/fhir',
    hint: 'DiagnosticReport bundles posted to the base URL. Ships with Tier 6 (FHIR builder + auth).',
    validate: (s) => /^https?:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(String(s).trim()),
    normalize: (s) => String(s).trim(),
    available: false,
    sample: 'https://emr.example/fhir',
  },
  {
    id: 'sftp',
    label: 'SFTP drop',
    endpointLabel: 'SFTP destination',
    placeholder: 'sftp://user@host:22/inbound',
    hint: 'sftp://user@host[:port]/path — files dropped per release. Ships with the production transport layer.',
    validate: (s) => /^sftp:\/\/[^\s@]+@[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(String(s).trim()),
    normalize: (s) => String(s).trim(),
    available: false,
    sample: 'sftp://lab@drops.example:22/inbound',
  },
];

const DELIVERY_CHANNEL_BY_ID = Object.fromEntries(DELIVERY_CHANNELS.map(c => [c.id, c]));

// Resolve a channel definition. Returns null for unknown ids so callers can
// detect legacy data (e.g. a channel removed from the registry) and degrade
// gracefully instead of crashing.
const getDeliveryChannel = (id) => DELIVERY_CHANNEL_BY_ID[id] || null;

// Channels the operator can pick from new-record pickers. Hidden channels
// (available:false) still resolve via getDeliveryChannel so display surfaces
// continue to render them on existing records.
const listDeliveryChannels = (opts = {}) => {
  const all = opts.includeHidden ? DELIVERY_CHANNELS : DELIVERY_CHANNELS.filter(c => c.available !== false);
  return all;
};

// Validate + normalize an endpoint string against its channel. Returns
// `{ ok, normalized, hint }`. `ok: false` means the endpoint didn't match the
// channel's regex — surface as a warning, not an error (validation is
// intentionally permissive; see DELIVERY_CHANNELS comment).
const validateDeliveryEndpoint = (channelId, endpoint) => {
  const ch = getDeliveryChannel(channelId);
  if (!ch) return { ok: true, normalized: String(endpoint || '').trim(), hint: '' };
  const trimmed = String(endpoint || '').trim();
  if (!trimmed) return { ok: true, normalized: '', hint: '' };
  const ok = ch.validate(trimmed);
  const normalized = ch.normalize(trimmed);
  return { ok, normalized, hint: ok ? '' : `Doesn't look like a ${ch.label} ${ch.endpointLabel.toLowerCase()} — saved anyway, but double-check.` };
};

window.schema = {
  newPatient, newOrder, newSpecimen, newResult, newTest, newReferenceRange,
  newInstrument, newInterface, newWorklist, newAuditEvent, newNotification,
  newClient, newUser,
  newLocation, newLabelTemplate,
  newQcLevel, newQcResult, newQcRuleViolation,
  newLabConfig, LAB_CONFIG_ID,
  TAT_THRESHOLD_DEFAULTS, TAT_RECIPIENTS_DEFAULT, TAT_PRIORITY_KEYS,
  ROLES, ROLE_IDS, ROLE_BY_ID, PERMISSIONS,
  nextAccessionNumber,
  SPECIMEN_CONDITIONS,
  // Delivery channel registry (single source of truth for fax/hl7/portal/etc.)
  DELIVERY_CHANNELS, getDeliveryChannel, listDeliveryChannels, validateDeliveryEndpoint,
};
