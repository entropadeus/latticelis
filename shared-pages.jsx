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

const hasPermission = (permission) => !!(
  window.userRoles &&
  window.userRoles.userHasPermission(window.currentUser && window.currentUser.id, permission)
);

const permissionTitle = (can, allowedTitle, deniedAction) =>
  can ? allowedTitle : `you don't have permission to ${deniedAction}`;

Object.assign(window, { hasPermission, permissionTitle });

// Odometer-style rolling number. Each digit is a 10-row column showing
// 9..0 stacked top to bottom; we translateY to bring the target digit
// into the 1em viewport. New digit slides DOWN from above, old digit
// drops out the bottom — like a flip-clock but in pure CSS. When the
// value updates rapidly (batch verify/release ticking down through
// dozens of items), the chained CSS transitions keep the digits in
// continuous motion instead of snapping.
const SpinnyDigit = ({ digit }) => {
  // Column order is descending [9..0] so that the "0" sits at the bottom
  // of the column. To show digit `d`, scroll the column UP so the digit
  // at row (9-d) is in the viewport. Increment/decrement = a small
  // negative-Y delta = column slides DOWN visually = new digit enters
  // from the top, old digit exits the bottom. Direction is consistent
  // regardless of whether the value is going up or down.
  const offset = -(9 - digit);
  return (
    <span className="spinny-digit">
      <span className="spinny-track" style={{ transform: `translateY(${offset}em)` }}>
        {[9,8,7,6,5,4,3,2,1,0].map(n => <span key={n}>{n}</span>)}
      </span>
    </span>
  );
};

const RollingNumber = ({ value }) => {
  const str = String(value == null ? 0 : value);
  return (
    <span className="spinny-num">
      {str.split('').map((ch, i) => /^\d$/.test(ch)
        ? <SpinnyDigit key={i} digit={parseInt(ch, 10)} />
        : <span key={i}>{ch}</span>
      )}
    </span>
  );
};

Object.assign(window, { RollingNumber });

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

// ── Pagination — usePagination + TablePagination ──────────────────────────
//
// Drop-in pair for any list page that wants the standard "Show N entries /
// Showing X to Y of Z" footer. The default page size is 10 across the LIS;
// per-page state survives sort + filter changes via a stable identity ref
// but resets to page 1 whenever the underlying item count drops below the
// current page's start (which would otherwise show an empty page).
//
// Usage:
//   const pager = usePagination(filteredOrders);
//   const visible = pager.slice;
//   ... <table>{visible.map(...)}</table>
//   <TablePagination {...pager}/>

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250];

const usePagination = (items, initialPageSize = 10) => {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const total = Array.isArray(items) ? items.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // If the current page falls past the end (e.g. filter shrank the list),
  // snap back to the last available page. Doing this in render is safe
  // because the useEffect below corrects state on the next tick — the
  // slice math already clamps so we never render an out-of-bounds window.
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(total, safePage * pageSize);
  const slice = Array.isArray(items)
    ? items.slice((safePage - 1) * pageSize, safePage * pageSize)
    : [];
  return {
    page: safePage,
    pageSize,
    total,
    totalPages,
    from,
    to,
    slice,
    setPage: (n) => setPage(Math.max(1, Math.min(totalPages, Number(n) || 1))),
    setPageSize: (n) => {
      const next = Math.max(1, Number(n) || initialPageSize);
      setPageSize(next);
      // Re-anchor to page 1 when the size changes — keeping the user on
      // page 5 of a now-huge or now-tiny window is disorienting.
      setPage(1);
    },
  };
};

const TablePagination = ({
  page, pageSize, total, totalPages, from, to,
  setPage, setPageSize,
  options = PAGE_SIZE_OPTIONS,
  compact = false,
  // 'top' renders the strip above the table (border-bottom);
  // 'bottom' (default) renders below (border-top). Pages mount this twice
  // to mirror DataTables' standard top + bottom layout.
  pos = 'bottom',
}) => {
  const inputRef = React.useRef(null);
  const [editing, setEditing] = React.useState(String(page));
  React.useEffect(() => { setEditing(String(page)); }, [page]);

  const submitPageInput = () => {
    const n = Number(editing);
    if (Number.isFinite(n) && n >= 1 && n <= totalPages) setPage(n);
    else setEditing(String(page));
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: compact ? '6px 10px' : '8px 12px',
      borderTop: pos === 'bottom' ? '1px solid var(--line)' : 'none',
      borderBottom: pos === 'top' ? '1px solid var(--line)' : 'none',
      background: 'var(--ivory-50)',
      fontSize: 11.5, color: 'var(--ink-500)',
    }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Show</span>
        <select
          value={pageSize}
          onChange={e => setPageSize(Number(e.target.value))}
          className="input mono tnum"
          style={{ width: 64, height: 24, padding: '0 4px', fontSize: 11.5 }}>
          {options.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span>entries</span>
      </label>

      <div style={{ flex: 1 }}/>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button className="btn" data-size="xs" data-variant="ghost"
          onClick={() => setPage(1)} disabled={page <= 1}
          title="First page" style={{ minWidth: 24, padding: '0 6px' }}>«</button>
        <button className="btn" data-size="xs" data-variant="ghost"
          onClick={() => setPage(page - 1)} disabled={page <= 1}
          title="Previous page" style={{ minWidth: 24, padding: '0 6px' }}>‹</button>
        <input
          ref={inputRef}
          className="input mono tnum"
          value={editing}
          onChange={e => setEditing(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={submitPageInput}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitPageInput(); inputRef.current && inputRef.current.blur(); } }}
          style={{ width: 44, height: 24, textAlign: 'center', padding: '0 4px', fontSize: 11.5 }}
          aria-label="Page number"/>
        <span style={{ color: 'var(--ink-400)' }}>/ {totalPages}</span>
        <button className="btn" data-size="xs" data-variant="ghost"
          onClick={() => setPage(page + 1)} disabled={page >= totalPages}
          title="Next page" style={{ minWidth: 24, padding: '0 6px' }}>›</button>
        <button className="btn" data-size="xs" data-variant="ghost"
          onClick={() => setPage(totalPages)} disabled={page >= totalPages}
          title="Last page" style={{ minWidth: 24, padding: '0 6px' }}>»</button>
      </div>

      <div style={{ flex: 1 }}/>

      <span className="tnum" style={{ color: 'var(--ink-700)' }}>
        {total === 0
          ? 'No entries'
          : `Showing ${from} to ${to} of ${total} ${total === 1 ? 'entry' : 'entries'}`}
      </span>
    </div>
  );
};

// ===== Delivery channel picker =====
//
// Channel + endpoint picker driven by `schema.DELIVERY_CHANNELS`. Every
// surface that touches "how does a result leave the lab" should mount this
// instead of hardcoding `<option value="fax">` etc. — adding a new channel
// is a registry edit, not a UI sweep.
//
// Props:
//   channel          — current channel id ('' = unset / inherit)
//   endpoint         — current endpoint string
//   onChannelChange  — (newId) => void
//   onEndpointChange — (newEndpoint) => void
//   allowInherit     — true on per-order pickers (renders the "inherit from
//                      client" sentinel). false on client editors (a client
//                      must always have a default channel).
//   layout           — 'inline' renders select + input side-by-side (default),
//                      'stacked' puts them on separate rows for narrow forms.
//   showHint         — surfaces the channel's hint line below the input.
//                      Defaults true; set false on dense list editors.
//   disabled         — disables both controls (e.g., insufficient perms).
//
// Validation is intentionally non-blocking: the endpoint regex is a heuristic,
// not a contract, and labs occasionally have non-conforming destinations.
// `validateDeliveryEndpoint` returns `{ ok, hint }` and we surface the hint
// in amber on blur — operator can ignore and save anyway. Channel changes
// reset the touched flag so the warning doesn't haunt the next selection.
const DeliveryChannelPicker = ({
  channel, endpoint,
  onChannelChange, onEndpointChange,
  allowInherit = false,
  layout = 'inline',
  showHint = true,
  disabled = false,
}) => {
  const schema = window.schema || {};
  const channels = schema.listDeliveryChannels ? schema.listDeliveryChannels() : [];
  const channelDef = schema.getDeliveryChannel ? schema.getDeliveryChannel(channel) : null;
  const validate = schema.validateDeliveryEndpoint || (() => ({ ok: true, hint: '' }));

  const [touched, setTouched] = useStateOS(false);
  // Reset the touched flag when the channel changes so a fresh selection
  // gets its own clean validation pass — switching from email to fax
  // shouldn't carry the email-format complaint forward.
  useEffectOS(() => { setTouched(false); }, [channel]);

  const validation = touched ? validate(channel, endpoint) : { ok: true, hint: '' };

  const endpointDisabled = disabled || (allowInherit && !channel);
  const placeholder = channelDef
    ? channelDef.placeholder
    : (allowInherit ? 'Inherits client endpoint' : 'Endpoint');

  const selectEl = (
    <select
      className="input"
      value={channel || ''}
      onChange={e => onChannelChange(e.target.value)}
      disabled={disabled}
      style={layout === 'inline' ? { maxWidth: 160 } : undefined}>
      {allowInherit && <option value="">— inherit from client —</option>}
      {channels.map(c => (
        <option key={c.id} value={c.id}>{c.label}</option>
      ))}
      {/* If the current value isn't in the visible registry (legacy data or
          a hidden/retired channel), keep it selectable as a tagged option
          so save doesn't silently rewrite it. */}
      {channel && !channels.find(c => c.id === channel) && (
        <option value={channel}>{channel} (legacy)</option>
      )}
    </select>
  );

  const inputEl = (
    <input
      className="input mono"
      value={endpoint || ''}
      onChange={e => onEndpointChange(e.target.value)}
      onBlur={() => setTouched(true)}
      placeholder={placeholder}
      disabled={endpointDisabled}
      style={layout === 'inline' ? { flex: 1 } : { width: '100%' }}/>
  );

  const container = layout === 'stacked'
    ? <div style={{ display: 'grid', gap: 6 }}>{selectEl}{inputEl}</div>
    : <div style={{ display: 'flex', gap: 6 }}>{selectEl}{inputEl}</div>;

  const hintLine = showHint && channelDef && channelDef.hint && validation.ok
    ? <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>{channelDef.hint}</div>
    : null;
  const warningLine = !validation.ok
    ? <div style={{ fontSize: 11, color: 'var(--warn-700)', marginTop: 4 }}>{validation.hint}</div>
    : null;

  return (
    <div>
      {container}
      {warningLine || hintLine}
    </div>
  );
};

Object.assign(window, { DeliveryChannelPicker });

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

