// Other screens — Dashboard, Orders, Specimens, Results, Patients, Worklists, Instruments, Interfaces, Reports, Admin
// All real shells. No dummy data. Empty states reflect actual schema.

const { useState: useStateOS, useMemo: useMemoOS, useEffect: useEffectOS } = React;

// ===== Page header (shared) =====
//
// PageHeader carries the top padding (24px) instead of the Page wrapper.
// Why: when a page scrolls and a sticky thead inside it activates, putting
// padding on the scroll container leaves a 24px ivory band between the
// topbar and the sticky header — visually reads as a "gap" between two
// floating chrome bars. Putting the padding on PageHeader keeps the
// at-rest breathing room (header sits 24px below the topbar) but lets
// sticky children inside the scroll container sit flush against the
// scroll container's top when activated.
const PageHeader = ({ title, sub, actions }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18, paddingTop: 24 }}>
    <div style={{ flex: 1 }}>
      <h1 className="page-title">{title}</h1>
      {sub && <p className="page-sub">{sub}</p>}
    </div>
    {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
  </div>
);

const Page = ({ children, label }) => (
  <div data-screen-label={label} style={{ padding: '0 32px 24px', overflow: 'auto', height: '100%' }}>
    {children}
  </div>
);

// ===== Empty data table (column scaffold preserved) =====
const EmptyTable = ({ columns, message, sub }) => (
  <div className="panel" style={{ overflow: 'hidden' }}>
    <table className="tbl">
      <thead>
        <tr>{columns.map(c => <th key={c} style={{ minWidth: c.length * 9 }}>{c}</th>)}</tr>
      </thead>
    </table>
    <div className="empty" style={{ padding: '56px 24px' }}>
      <div className="empty-icon"><IconInbox size={18}/></div>
      <div className="empty-title">{message || 'No data to display'}</div>
      <div className="empty-sub">{sub || 'This view is wired and ready. Records will appear once data flows in.'}</div>
    </div>
  </div>
);

// ===== Dashboard =====

const TatPill = ({ order }) => {
  if (!order) return null;
  if (order.status === 'completed' || order.status === 'cancelled') return null;
  const level = order.tatBreachLevel || 'ok';
  if (level === 'ok') return null;
  const tone = level === 'breach' ? 'rust' : 'amber';
  const label = level === 'breach' ? 'TAT breach' : 'TAT warn';
  // Show elapsed-since-breach for breaches (gives quick "5h over" sense at a glance).
  let elapsedHint = null;
  if (level === 'breach' && order.tatBreachedAt) {
    const ms = Date.now() - order.tatBreachedAt;
    const m = Math.round(ms / 60000);
    elapsedHint = m < 60 ? (m + 'm') : (m / 60).toFixed(1).replace(/\.0$/, '') + 'h';
  }
  const source = order.tatThresholdSource === 'test' ? 'test override' : 'priority target';
  const paused = Number(order.tatPausedMs) > 0 || order.tatPauseStartedAt;
  const title = [
    level === 'breach'
      ? 'Order has exceeded its adjusted TAT target.'
      : 'Order is approaching its adjusted TAT target.',
    order.tatThresholdMin ? `Target: ${order.tatThresholdMin}m (${source}).` : '',
    paused ? 'Clock includes specimen-recollect pause time.' : '',
  ].filter(Boolean).join(' ');
  return (
    <span className="pill" data-tone={tone} title={title}
      style={{ height: 18, padding: '0 6px', fontSize: 10.5, gap: 4 }}>
      <span style={{ textTransform: 'uppercase', letterSpacing: 0.04, fontSize: 9.5 }}>{label}</span>
      {elapsedHint && <span className="mono tnum">+{elapsedHint}</span>}
      {paused && <span className="mono tnum">pause</span>}
    </span>
  );
};

const PRIORITY_TONE = { stat: 'rust', asap: 'amber', routine: 'ghost' };
const PriorityPill = ({ p }) => (
  <span className="pill" data-tone={PRIORITY_TONE[p] || 'ghost'}>
    {p === 'stat' ? 'STAT' : p === 'asap' ? 'ASAP' : 'Routine'}
  </span>
);

const STATUS_TONE = { open: 'sage', in_progress: 'info', completed: 'slate', cancelled: 'ghost' };
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
const StatusPill = ({ s }) => (
  <span className="pill" data-tone={STATUS_TONE[s] || 'ghost'}>{STATUS_LABEL[s] || s || '—'}</span>
);

const SPEC_STATE_TONE = {
  pending: 'ghost', in_transit: 'amber', received: 'sage',
  in_analysis: 'info', completed: 'slate', rejected: 'rust',
};
const SPEC_STATE_LABEL = {
  pending: 'Pending', in_transit: 'In transit', received: 'Received',
  in_analysis: 'In analysis', completed: 'Completed', rejected: 'Rejected',
};
const SpecimenStatePill = ({ state }) => (
  <span className="pill" data-tone={SPEC_STATE_TONE[state] || 'ghost'}>{SPEC_STATE_LABEL[state] || state || '—'}</span>
);

const ConditionPill = ({ condition, rejectReason }) => {
  const conds = window.schema && window.schema.SPECIMEN_CONDITIONS ? window.schema.SPECIMEN_CONDITIONS : [];
  const def = conds.find(c => c.id === condition);
  if (!condition || !def) return <span style={{ color: 'var(--ink-300)' }}>—</span>;
  return (
    <span className="pill" data-tone={def.tone || 'ghost'}
      title={rejectReason || def.label}>
      {def.label}
    </span>
  );
};

const formatTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};
const formatDateTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sameDay = d.getTime() >= today.getTime();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const currentActorId = () => (window.currentUser ? window.currentUser.id : 'unknown');

const safetyFact = (label, value) => ({
  label,
  value: value == null || value === '' ? '-' : String(value),
});

const safetyConfirm = (options) => {
  if (!window.safetyConfirm) return Promise.resolve({ confirmed: false, reason: '', typedText: '' });
  return window.safetyConfirm(options);
};

const safetyNotice = (options) => safetyConfirm({
  tone: 'info',
  title: 'Notice',
  confirmLabel: 'OK',
  cancelLabel: null,
  audit: false,
  notice: true,
  ...options,
});

const compactName = (patient) => {
  if (!patient) return 'no patient';
  const name = [patient.lastName, patient.firstName].filter(Boolean).join(', ');
  return [patient.mrn, name].filter(Boolean).join(' - ') || patient.id;
};

// ===== Dashboard live panels =====
// Three derived panels (TAT, specimen status, pending review) all read off
// existing entity collections — no new state, no new events. Adding more
// dashboard tiles never costs anything but a function.

const median = (nums) => {
  if (!nums || nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

