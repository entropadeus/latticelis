// Lattice LIS — Rules Engine library
// A composable system of atomic rule primitives. Conditions + Actions.
// Every primitive declares its inputs/outputs; the composer enforces type safety.

// =========================================================================
// EVENT SOURCES — what triggers a rule
// =========================================================================
const RULE_TRIGGERS = [
  { id: 'order.created',         label: 'Order created',           group: 'Orders',     desc: 'Fires when a new order enters the system' },
  { id: 'order.modified',        label: 'Order modified',          group: 'Orders',     desc: 'Existing order updated by user or interface' },
  { id: 'order.cancelled',       label: 'Order cancelled',         group: 'Orders' },
  { id: 'specimen.received',     label: 'Specimen received',       group: 'Specimens',  desc: 'Specimen accessioned at receiving' },
  { id: 'specimen.collected',    label: 'Specimen collected',      group: 'Specimens' },
  { id: 'specimen.routed',       label: 'Specimen routed',         group: 'Specimens' },
  { id: 'specimen.rejected',     label: 'Specimen rejected',       group: 'Specimens' },
  { id: 'result.received',       label: 'Result received',         group: 'Results',    desc: 'Result returned from analyzer or reference lab' },
  { id: 'result.released',       label: 'Result released',         group: 'Results' },
  { id: 'result.amended',        label: 'Result amended',          group: 'Results' },
  { id: 'message.inbound',       label: 'HL7 inbound message',     group: 'Interfaces', desc: 'ORM, ORU, ADT inbound from external systems' },
  { id: 'message.outbound',      label: 'HL7 outbound message',    group: 'Interfaces' },
  { id: 'analyzer.qc',           label: 'Analyzer QC event',       group: 'Instruments' },
  { id: 'order.tat.warned',       label: 'TAT warning threshold crossed',  group: 'Operations', desc: 'Fires when an order reaches the warning percentage of its TAT target' },
  { id: 'order.tat.breached',     label: 'TAT breach threshold crossed',   group: 'Operations', desc: 'Fires when an order exceeds its full TAT target' },
  { id: 'schedule.cron',         label: 'On schedule (cron)',      group: 'Operations',  desc: 'Fires on a recurring schedule' },
];

// =========================================================================
// CONDITION PRIMITIVES — small, composable predicates
// =========================================================================
const CONDITION_PRIMITIVES = [
  // Identity / source
  { id: 'order.facility.is',          label: 'Ordering facility',           cat: 'Source',      args: [{ k: 'facility', t: 'facility' }] },
  { id: 'order.location.is',          label: 'Receiving location',          cat: 'Source',      args: [{ k: 'location', t: 'location' }] },
  { id: 'order.provider.npi.is',      label: 'Provider NPI',                cat: 'Source',      args: [{ k: 'npi', t: 'npi' }] },
  { id: 'order.payer.is',             label: 'Payer / insurance',           cat: 'Source',      args: [{ k: 'payer', t: 'payer' }] },
  { id: 'order.priority.is',          label: 'Priority',                    cat: 'Source',      args: [{ k: 'priority', t: 'enum', opts: ['STAT','ASAP','Routine','Timed'] }] },
  { id: 'order.source.is',            label: 'Order source',                cat: 'Source',      args: [{ k: 'source', t: 'enum', opts: ['Athena','Outreach EMR','Internal','Manual','Reference Lab'] }] },

  // Test / analyte
  { id: 'test.code.is',               label: 'Test code is',                cat: 'Test',        args: [{ k: 'code', t: 'test' }] },
  { id: 'test.code.in',               label: 'Test code in set',            cat: 'Test',        args: [{ k: 'codes', t: 'test[]' }] },
  { id: 'test.panel.contains',        label: 'Panel contains test',         cat: 'Test',        args: [{ k: 'code', t: 'test' }] },
  { id: 'test.loinc.matches',         label: 'LOINC matches',               cat: 'Test',        args: [{ k: 'loinc', t: 'loinc' }] },
  { id: 'test.department.is',         label: 'Department',                  cat: 'Test',        args: [{ k: 'dept', t: 'enum', opts: ['Chemistry','Hematology','Microbiology','Molecular','Toxicology','Cytology','Anatomic Pathology'] }] },

  // Specimen
  { id: 'specimen.type.is',           label: 'Specimen type',               cat: 'Specimen',    args: [{ k: 'type', t: 'spec-type' }] },
  { id: 'specimen.container.is',      label: 'Container type',              cat: 'Specimen',    args: [{ k: 'container', t: 'container' }] },
  { id: 'specimen.volume.lt',         label: 'Volume less than',            cat: 'Specimen',    args: [{ k: 'volume', t: 'number', unit: 'mL' }] },
  { id: 'specimen.age.gt',            label: 'Specimen age greater than',   cat: 'Specimen',    args: [{ k: 'hours', t: 'number', unit: 'h' }] },
  { id: 'specimen.temp.outside',      label: 'Storage temp outside range',  cat: 'Specimen',    args: [{ k: 'min', t: 'number', unit: '°C' }, { k: 'max', t: 'number', unit: '°C' }] },
  { id: 'specimen.hemolyzed',         label: 'Specimen is hemolyzed',       cat: 'Specimen',    args: [] },
  { id: 'specimen.lipemic',           label: 'Specimen is lipemic',         cat: 'Specimen',    args: [] },

  // Patient
  { id: 'patient.age.between',        label: 'Patient age between',         cat: 'Patient',     args: [{ k: 'min', t: 'number', unit: 'yr' }, { k: 'max', t: 'number', unit: 'yr' }] },
  { id: 'patient.sex.is',             label: 'Patient sex',                 cat: 'Patient',     args: [{ k: 'sex', t: 'enum', opts: ['F','M','U'] }] },
  { id: 'patient.pregnant',           label: 'Patient is pregnant',         cat: 'Patient',     args: [] },
  { id: 'patient.fasting',            label: 'Patient is fasting',          cat: 'Patient',     args: [] },

  // Result value
  { id: 'result.value.gt',            label: 'Result value >',              cat: 'Result',      args: [{ k: 'value', t: 'number' }] },
  { id: 'result.value.lt',            label: 'Result value <',              cat: 'Result',      args: [{ k: 'value', t: 'number' }] },
  { id: 'result.value.between',       label: 'Result value between',        cat: 'Result',      args: [{ k: 'min', t: 'number' }, { k: 'max', t: 'number' }] },
  { id: 'result.flag.is',             label: 'Result flag is',              cat: 'Result',      args: [{ k: 'flag', t: 'enum', opts: ['H','L','HH','LL','A','AA','Critical'] }] },
  { id: 'result.delta.gt',            label: 'Delta from prior >',          cat: 'Result',      args: [{ k: 'pct', t: 'number', unit: '%' }] },
  { id: 'result.delta.test',          label: 'Delta exceeds test threshold', cat: 'Result',      args: [] },
  { id: 'result.outside.ref',         label: 'Outside reference range',     cat: 'Result',      args: [] },

  // Time
  { id: 'time.day.in',                label: 'Day of week in',              cat: 'Time',        args: [{ k: 'days', t: 'enum[]', opts: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] }] },
  { id: 'time.hour.between',          label: 'Hour between',                cat: 'Time',        args: [{ k: 'start', t: 'time' }, { k: 'end', t: 'time' }] },
  { id: 'time.holiday',               label: 'Is holiday',                  cat: 'Time',        args: [] },

  // TAT — check elapsed time or pre-computed TAT state on the associated order
  { id: 'tat.elapsed.gt',             label: 'TAT elapsed >',               cat: 'TAT',         args: [{ k: 'minutes', t: 'number', unit: 'min' }] },
  { id: 'order.tat.warned',           label: 'Order TAT is in warning',     cat: 'TAT',         args: [] },
  { id: 'order.tat.breached',         label: 'Order TAT is breached',       cat: 'TAT',         args: [] },

  // Interface / message
  { id: 'message.type.is',            label: 'Message type',                cat: 'Message',     args: [{ k: 'type', t: 'enum', opts: ['ORM','ORU','ADT','MDM','SIU','BAR'] }] },
  { id: 'message.field.matches',      label: 'HL7 field matches regex',     cat: 'Message',     args: [{ k: 'path', t: 'hl7-path' }, { k: 'regex', t: 'regex' }] },
  { id: 'message.field.missing',      label: 'HL7 field missing',           cat: 'Message',     args: [{ k: 'path', t: 'hl7-path' }] },
  { id: 'interface.is',               label: 'Inbound interface',           cat: 'Message',     args: [{ k: 'iface', t: 'interface' }] },
];

// =========================================================================
// ACTION PRIMITIVES — what to do when conditions match
// =========================================================================
const ACTION_PRIMITIVES = [
  // Routing
  { id: 'route.to.lab',               label: 'Route to lab',                cat: 'Routing',     args: [{ k: 'lab', t: 'lab' }] },
  { id: 'route.to.analyzer',          label: 'Route to analyzer',           cat: 'Routing',     args: [{ k: 'analyzer', t: 'analyzer' }] },
  { id: 'route.to.refLab',            label: 'Send out to reference lab',   cat: 'Routing',     args: [{ k: 'refLab', t: 'ref-lab' }] },
  { id: 'route.to.dept',              label: 'Route to department',         cat: 'Routing',     args: [{ k: 'dept', t: 'dept' }] },
  { id: 'route.split',                label: 'Split aliquot',               cat: 'Routing',     args: [{ k: 'count', t: 'number' }] },

  // Validation / hold
  { id: 'order.hold',                 label: 'Place on hold',               cat: 'Validation',  args: [{ k: 'reason', t: 'text' }] },
  { id: 'order.reject',               label: 'Reject order',                cat: 'Validation',  args: [{ k: 'reason', t: 'text' }] },
  { id: 'order.requireDx',            label: 'Require diagnosis code',      cat: 'Validation',  args: [] },
  { id: 'order.requireAuth',          label: 'Require prior auth',          cat: 'Validation',  args: [] },
  { id: 'order.flag',                 label: 'Flag for review',             cat: 'Validation',  args: [{ k: 'queue', t: 'queue' }] },
  { id: 'order.duplicate.warn',       label: 'Warn on duplicate within',    cat: 'Validation',  args: [{ k: 'hours', t: 'number', unit: 'h' }] },

  // Reflex / cascade
  { id: 'order.reflex.add',           label: 'Reflex: add test',            cat: 'Reflex',      args: [{ k: 'test', t: 'test' }] },
  { id: 'order.reflex.cancel',        label: 'Reflex: cancel test',         cat: 'Reflex',      args: [{ k: 'test', t: 'test' }] },
  { id: 'order.reflex.replace',       label: 'Reflex: replace test',        cat: 'Reflex',      args: [{ k: 'from', t: 'test' }, { k: 'to', t: 'test' }] },
  { id: 'order.panel.expand',         label: 'Expand panel into tests',     cat: 'Reflex',      args: [] },

  // Result handling
  { id: 'result.flag.set',            label: 'Set result flag',             cat: 'Result',      args: [{ k: 'flag', t: 'enum', opts: ['H','L','HH','LL','A','AA','Critical'] }] },
  { id: 'result.range.apply',         label: 'Apply reference range',       cat: 'Result',      args: [{ k: 'range', t: 'range' }] },
  { id: 'result.comment.append',      label: 'Append result comment',       cat: 'Result',      args: [{ k: 'text', t: 'text' }] },
  { id: 'result.autoVerify',          label: 'Auto-verify result',          cat: 'Result',      args: [] },
  { id: 'result.holdRelease',         label: 'Hold result release',         cat: 'Result',      args: [] },

  // Notifications
  { id: 'notify.user',                label: 'Notify user',                 cat: 'Notify',      args: [{ k: 'user', t: 'user' }, { k: 'msg', t: 'text' }] },
  { id: 'notify.role',                label: 'Notify role',                 cat: 'Notify',      args: [{ k: 'role', t: 'role' }, { k: 'msg', t: 'text' }] },
  { id: 'notify.provider',            label: 'Notify ordering provider',    cat: 'Notify',      args: [{ k: 'channel', t: 'enum', opts: ['Fax','Phone','Portal','HL7'] }] },
  { id: 'notify.critical',            label: 'Trigger critical callback',   cat: 'Notify',      args: [] },

  // Output / messaging
  { id: 'message.send.hl7',           label: 'Send HL7 message',            cat: 'Output',      args: [{ k: 'iface', t: 'interface' }, { k: 'type', t: 'enum', opts: ['ORM','ORU','ACK'] }] },
  { id: 'message.transform',          label: 'Transform HL7 field',         cat: 'Output',      args: [{ k: 'path', t: 'hl7-path' }, { k: 'expr', t: 'expr' }] },
  { id: 'label.print',                label: 'Print label',                 cat: 'Output',      args: [{ k: 'template', t: 'label' }, { k: 'printer', t: 'printer' }] },
  { id: 'report.generate',            label: 'Generate report',             cat: 'Output',      args: [{ k: 'template', t: 'report' }] },

  // Audit / metadata
  { id: 'audit.log',                  label: 'Write to audit log',          cat: 'Audit',       args: [{ k: 'msg', t: 'text' }] },
  { id: 'tag.add',                    label: 'Add tag',                     cat: 'Audit',       args: [{ k: 'tag', t: 'tag' }] },
  { id: 'metric.increment',           label: 'Increment metric',            cat: 'Audit',       args: [{ k: 'metric', t: 'metric' }] },
];

const COND_CATS = ['Source','Test','Specimen','Patient','Result','Time','TAT','Message'];
const ACTION_CATS = ['Routing','Validation','Reflex','Result','Notify','Output','Audit'];

Object.assign(window, {
  RULE_TRIGGERS, CONDITION_PRIMITIVES, ACTION_PRIMITIVES,
  COND_CATS, ACTION_CATS,
});
