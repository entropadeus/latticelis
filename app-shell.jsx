// App shell — sidebar, topbar, command palette, navigation
// Tweak: nav style (sidebar / top / hybrid)

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ----- Navigation tree -----
//
// Sidebar order follows the bench-tech daily flow: walk in → check Dashboard →
// accession at the receiving bench → trace specimens out through worklists →
// verify and release results → look up patients → review activity. Setup and
// configuration screens (Instruments, Interfaces, Rules Engine, Test Catalog,
// QC, Clients, Locations, Labels, Mappers, Notifications) live ONLY under the
// Admin page so the operator's daily nav stays focused. They remain reachable
// via the command palette (⌘K) — see ADMIN_DESTINATIONS below.
// NAV items each declare which permission gates their visibility. Items
// without a `permission` field are unrestricted (any signed-in user sees
// them). The Admin parent uses `anyPermission`: shown if the user holds
// at least one of the listed admin sub-permissions; the page itself
// re-filters its tile grid against the user's permissions.
const NAV = [
  { id: 'dashboard',  label: 'Dashboard',         icon: 'IconDashboard',  group: 'Operations' },
  { id: 'accession',  label: 'Accessioning',      icon: 'IconAccession',  group: 'Operations', shortcut: 'A', permission: 'ACCESSION' },
  { id: 'orders',     label: 'Orders',            icon: 'IconOrder',      group: 'Operations' },
  { id: 'specimens',  label: 'Specimens',         icon: 'IconTube',       group: 'Operations' },
  { id: 'worklists',  label: 'Worklists',         icon: 'IconList',       group: 'Operations' },
  { id: 'results',    label: 'Results',           icon: 'IconResults',    group: 'Operations' },
  { id: 'patients',   label: 'Patient Search',    icon: 'IconSearch',     group: 'Operations' },
  { id: 'reports',    label: 'Activity log',      icon: 'IconReports',    group: 'Review' },
  { id: 'admin',      label: 'Admin',             icon: 'IconAdmin',      group: 'System', anyPermission: ['EDIT_USERS', 'EDIT_RULES', 'EDIT_LAB_CONFIG', 'EDIT_TEST_CATALOG', 'EDIT_INTERFACES', 'EDIT_LABEL_TEMPLATES', 'RESTORE_SNAPSHOT', 'RESOLVE_QC'] },
];

// Admin-only destinations. Hidden from the sidebar but indexed by the command
// palette so power users can jump directly. Match each entry to an actual
// route in `app.jsx` — anything here is reachable via Admin tiles too.
const ADMIN_DESTINATIONS = [
  { id: 'instruments',  label: 'Instruments',       icon: 'IconInstrument', permission: 'EDIT_INTERFACES' },
  { id: 'interfaces',   label: 'Interfaces',        icon: 'IconInterface',  permission: 'EDIT_INTERFACES' },
  { id: 'rules',        label: 'Rules Engine',      icon: 'IconRules',      permission: 'EDIT_RULES' },
  { id: 'tests',        label: 'Test Catalog',      icon: 'IconBeaker',     permission: 'EDIT_TEST_CATALOG' },
  { id: 'qc',           label: 'QC (Westgard)',     icon: 'IconBeaker',     permission: 'RESOLVE_QC' },
  { id: 'clients',      label: 'Clients',           icon: 'IconMap',        permission: 'EDIT_LAB_CONFIG' },
  { id: 'locations',    label: 'Locations',         icon: 'IconMap',        permission: 'EDIT_LAB_CONFIG' },
  { id: 'labels',       label: 'Labels & Printing', icon: 'IconLabel',      permission: 'EDIT_LABEL_TEMPLATES' },
  { id: 'mappers',      label: 'Mappers (LML)',     icon: 'IconBranch',     permission: 'EDIT_INTERFACES' },
  { id: 'notifications',label: 'Notifications',     icon: 'IconBell',       permission: 'EDIT_LAB_CONFIG' },
];

// Helper: does the current user pass a NAV / Admin entry's permission gate?
// Items with no gate always pass. Without a resolver/user yet, fall open
// for the milliseconds before hydration (the auth gate already prevents
// unauthenticated access; this just avoids layout flicker).
const __navItemAllowed = (item) => {
  if (!item) return false;
  if (!window.userRoles || !window.currentUser) return true;
  const userId = window.currentUser.id;
  if (item.permission) return window.userRoles.userHasPermission(userId, item.permission);
  if (Array.isArray(item.anyPermission)) {
    return item.anyPermission.some(p => window.userRoles.userHasPermission(userId, p));
  }
  return true;
};

// ----- Logo -----
const LatticeLogo = ({ collapsed }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 4px' }}>
    <img src="assets/lattice-logo.png" alt="" width="30" height="30"
      style={{ display: 'block', objectFit: 'contain', flex: '0 0 auto' }}/>
    {!collapsed && (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, letterSpacing: '0.04em' }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--ink-900)' }}>LATTICE</span>
        <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--sage-700)' }}>LIS</span>
      </div>
    )}
  </div>
);

// ----- Sidebar -----
const Sidebar = ({ active, onNav, collapsed }) => {
  // Force re-evaluation when the current operator changes (sign-in/sign-out
  // or operator switch) so the permission filter re-runs against the new id.
  const [, force] = useState(0);
  useEffect(() => {
    if (!window.currentUserApi) return;
    return window.currentUserApi.subscribe(() => force(x => x + 1));
  }, []);
  const groups = useMemo(() => {
    const g = {};
    NAV.filter(__navItemAllowed).forEach(n => {
      if (!g[n.group]) g[n.group] = [];
      g[n.group].push(n);
    });
    return g;
  }, [window.currentUser && window.currentUser.id]);

  return (
    <aside data-screen-label="Sidebar" className="transition-width" style={{
      gridRow: '1 / 3',
      borderRight: '1px solid var(--line)',
      background: 'var(--ivory-100)',
      display: 'flex', flexDirection: 'column',
      width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar)',
    }}>
      <div style={{ padding: collapsed ? '12px 8px' : '14px 16px', borderBottom: '1px solid var(--line)', height: 'var(--topbar)', display: 'flex', alignItems: 'center' }}>
        <LatticeLogo collapsed={collapsed}/>
      </div>
      <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} style={{ marginBottom: 14 }}>
            {!collapsed && (
              <div className="section-title" style={{ padding: '6px 10px 6px', fontSize: 10 }}>{group}</div>
            )}
            {items.map(item => {
              const Icon = window[item.icon];
              const isActive = active === item.id;
              return (
                <button key={item.id}
                  onClick={() => onNav(item.id)}
                  title={collapsed ? item.label : undefined}
                  style={{
                    width: '100%',
                    display: 'flex', alignItems: 'center', gap: 10,
                    height: 30, padding: collapsed ? '0' : '0 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    border: 'none',
                    background: isActive ? 'var(--sage-100)' : 'transparent',
                    color: isActive ? 'var(--sage-900)' : 'var(--ink-700)',
                    borderRadius: 5,
                    fontSize: 12.5,
                    fontWeight: isActive ? 500 : 400,
                    marginBottom: 1,
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--ivory-200)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  {Icon && <Icon size={15}/>}
                  {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>}
                  {!collapsed && item.shortcut && (
                    <span className="kbd" style={{ fontSize: 10 }}>{item.shortcut}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ borderTop: '1px solid var(--line)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--ink-400)' }}>
        <span className="dot" data-tone="ok"/>
        {!collapsed && <span>All systems operational</span>}
      </div>
    </aside>
  );
};

// ----- Top rail (alt nav style) -----
const TopRail = ({ active, onNav }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 2,
    height: 36, padding: '0 8px',
    borderBottom: '1px solid var(--line)',
    background: 'var(--ivory-50)',
    overflowX: 'auto',
  }}>
    {NAV.filter(__navItemAllowed).map(item => {
      const Icon = window[item.icon];
      const isActive = active === item.id;
      return (
        <button key={item.id} onClick={() => onNav(item.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 26, padding: '0 10px',
            border: 'none',
            background: isActive ? 'var(--sage-100)' : 'transparent',
            color: isActive ? 'var(--sage-900)' : 'var(--ink-500)',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: isActive ? 500 : 400,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}>
          {Icon && <Icon size={13}/>}
          {item.label}
        </button>
      );
    })}
  </div>
);

// ----- Topbar (search + actions) -----
const Topbar = ({ onCmdK }) => {
  return (
    <header style={{
      gridColumn: '2 / 3',
      borderBottom: '1px solid var(--line)',
      background: 'var(--ivory-50)',
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px',
      height: 'var(--topbar)',
    }}>
      <button onClick={onCmdK}
        style={{
          flex: 1, maxWidth: 600,
          display: 'flex', alignItems: 'center', gap: 10,
          height: 32, padding: '0 12px',
          border: '1px solid var(--line)',
          borderRadius: 6,
          background: '#fff',
          color: 'var(--ink-300)',
          fontSize: 12.5,
          textAlign: 'left',
          cursor: 'pointer',
        }}>
        <IconSearch size={14}/>
        <span style={{ flex: 1 }}>Search by Accession, Order, Patient, or MRN</span>
        <span className="kbd" style={{ fontSize: 10 }}>⌘K</span>
      </button>

      <div style={{ flex: 1 }}/>

      <button className="btn" data-size="sm" data-variant="ghost" style={{ gap: 6 }}>
        <IconLocation size={14}/>
        All Locations
        <IconChevDown size={12}/>
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--line)' }}/>

      <UserSwitcher/>

      <div style={{ width: 1, height: 20, background: 'var(--line)' }}/>

      <button className="btn" data-variant="ghost" data-size="sm" style={{ width: 30, padding: 0, justifyContent: 'center' }}>
        <IconSun size={15}/>
      </button>
      {window.NotificationsBell && <window.NotificationsBell/>}
      <button className="btn" data-variant="ghost" data-size="sm" style={{ width: 30, padding: 0, justifyContent: 'center' }}>
        <IconHelp size={15}/>
      </button>
    </header>
  );
};

// ── Active operator switcher ────────────────────────────────────────────
// Reads from window.useEntities('users') so the list refreshes when users
// are added. Persists selection to localStorage via window.currentUserApi.
const UserSwitcher = () => {
  const users = window.useEntities('users');
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    if (!window.currentUserApi) return;
    const unsub = window.currentUserApi.subscribe(() => force(x => x + 1));
    return unsub;
  }, []);

  const cur = window.currentUser;
  if (!cur) return null;

  // Primary role for the chip badge. Catalog-order priority via userRoles.
  const curRoleMeta = window.userRoles ? window.userRoles.primaryRoleMeta(cur.id) : null;

  const signOut = () => {
    if (window.auth) window.auth.signOut();
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        className="btn" data-size="sm" data-variant="ghost"
        style={{ gap: 8, paddingLeft: 8, paddingRight: 8 }}
        title={curRoleMeta ? `Signed in as ${curRoleMeta.label}` : 'Account'}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'var(--sage-200)', color: 'var(--sage-900)',
          display: 'grid', placeItems: 'center',
          fontSize: 10.5, fontWeight: 500, letterSpacing: 0.04,
        }}>
          {(cur.firstName || cur.username || '?').slice(0, 1).toUpperCase()
            + (cur.lastName ? cur.lastName.slice(0, 1).toUpperCase() : '')}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--ink-700)' }}>
          {[cur.firstName, cur.lastName].filter(Boolean).join(' ') || cur.username}
        </span>
        {curRoleMeta && (
          <span className="pill" data-tone={curRoleMeta.tone} style={{ fontSize: 9.5 }}>
            {curRoleMeta.label}
          </span>
        )}
        <IconChevDown size={12}/>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }}/>
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4,
            minWidth: 260, zIndex: 91,
            background: '#fff', border: '1px solid var(--line)', borderRadius: 6,
            boxShadow: 'var(--shadow-pop)', padding: 0,
          }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'var(--sage-200)', color: 'var(--sage-900)',
                  display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 500,
                }}>
                  {(cur.firstName || '?').slice(0, 1).toUpperCase() + (cur.lastName || '').slice(0, 1).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-900)' }}>
                    {[cur.firstName, cur.lastName].filter(Boolean).join(' ') || cur.username}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                    {cur.username}{cur.email ? ' · ' + cur.email : ''}
                  </div>
                </div>
              </div>
              {(cur.roles || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                  {(cur.roles || []).map(rid => {
                    const r = (window.schema && window.schema.ROLE_BY_ID && window.schema.ROLE_BY_ID[rid]) || { tone: 'ghost', label: rid };
                    return <span key={rid} className="pill" data-tone={r.tone} style={{ fontSize: 9.5 }}>{r.label}</span>;
                  })}
                </div>
              )}
              {cur.credentials && cur.credentials.length > 0 && (
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-500)', marginTop: 6 }}>
                  {cur.credentials.join(', ')}
                </div>
              )}
            </div>
            <button
              onClick={signOut}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '10px 14px', border: 0,
                background: 'transparent', color: 'var(--ink-700)',
                fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <IconPower size={13}/>
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
};

// ----- Command palette -----
const CommandPalette = ({ open, onClose, onNav }) => {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (open) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  const items = useMemo(() => {
    const all = [
      ...NAV.filter(__navItemAllowed).map(n => ({ id: 'nav-' + n.id, label: 'Go to ' + n.label, kind: 'Navigate', target: n.id })),
      // Admin-only destinations are still indexable via the palette so power
      // users can jump straight to Rules / Instruments / etc. without the
      // detour through the Admin tile grid. Same permission gates apply.
      ...ADMIN_DESTINATIONS.filter(__navItemAllowed).map(n => ({ id: 'admnav-' + n.id, label: 'Go to ' + n.label, kind: 'Admin', target: n.id })),
      { id: 'a-new-accession', label: 'New accessioning session', kind: 'Action', target: 'accession' },
      { id: 'a-new-rule',      label: 'Create new rule',           kind: 'Action', target: 'rules' },
      { id: 'a-new-order',     label: 'Create new order',          kind: 'Action', target: 'orders', permission: 'CREATE_ORDER', deniedAction: 'create orders' },
      { id: 'a-search-patient',label: 'Find patient by MRN',       kind: 'Action', target: 'patients' },
      { id: 'd-shortcuts',     label: 'Keyboard shortcuts',        kind: 'Help' },
      { id: 'd-docs',          label: 'Documentation',             kind: 'Help' },
    ];
    if (!q) return all.slice(0, 10);
    const ql = q.toLowerCase();
    return all.filter(i => i.label.toLowerCase().includes(ql));
  }, [q]);

  useEffect(() => { setIdx(0); }, [q]);

  const handleKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter')     { e.preventDefault(); pick(items[idx]); }
    if (e.key === 'Escape')    { onClose(); }
  };
  const pick = (item) => {
    if (!item) return;
    if (item.permission && !hasPermission(item.permission)) return;
    if (item.target) onNav(item.target);
    onClose();
    // Side-effect actions (open dialogs, etc.). Run after nav so the destination page
    // is mounted before any drawer it depends on opens.
    if (item.id === 'a-new-order' && window.openNewOrder) {
      setTimeout(() => window.openNewOrder(), 0);
    }
  };

  if (!open) return null;
  return (
    <div onMouseDown={onClose} className="backdrop-in" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(31,30,26,0.30)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '13vh',
    }}>
      <div onMouseDown={e => e.stopPropagation()} className="scale-in" style={{
        width: 580, maxWidth: '92vw',
        background: '#fff', borderRadius: 8,
        boxShadow: 'var(--shadow-pop)',
        border: '1px solid var(--line)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
          <IconSearch size={15} style={{ color: 'var(--ink-400)' }}/>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={handleKey}
            placeholder="Search the lab — orders, specimens, patients, actions…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, background: 'transparent' }}/>
          <span className="kbd">esc</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {items.length === 0 ? (
            <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12.5 }}>
              No matches. Try a different query.
            </div>
          ) : items.map((item, i) => {
            const allowed = !item.permission || hasPermission(item.permission);
            return (
            <button key={item.id} onClick={() => pick(item)} onMouseEnter={() => setIdx(i)}
              disabled={!allowed}
              title={allowed ? item.label : `you don't have permission to ${item.deniedAction || 'use this action'}`}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', border: 'none',
                background: idx === i ? 'var(--ivory-100)' : 'transparent',
                borderRadius: 5, cursor: allowed ? 'pointer' : 'not-allowed', textAlign: 'left',
                opacity: allowed ? 1 : 0.5,
              }}>
              <span style={{ fontSize: 13, color: 'var(--ink-900)', flex: 1 }}>{item.label}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{item.kind}</span>
              {idx === i && <IconArrowRight size={12} style={{ color: 'var(--ink-400)' }}/>}
            </button>
            );
          })}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--ink-400)' }}>
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> select</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>
  );
};

// ----- Status bar (bottom) -----
const StatusBar = () => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 18,
    padding: '0 16px', height: 26,
    borderTop: '1px solid var(--line)',
    background: 'var(--ivory-100)',
    fontSize: 11, color: 'var(--ink-400)',
    // Status bar is a single row of compact chips. Without nowrap, items
    // re-flow onto two rows at narrower widths and the bar height blows up.
    whiteSpace: 'nowrap', flexWrap: 'nowrap', overflow: 'hidden',
  }}>
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span className="dot" data-tone="ok"/> System healthy
    </span>
    <span style={{ flexShrink: 0 }} title="Pre-production prototype. Tier 6 (real MLLP transport, auth, FHIR) deferred — see Build Ledger.">
      Environment <span style={{ color: 'var(--warn-700)' }}>Prototype</span>
    </span>
    <span style={{ flexShrink: 0 }}>Database <span style={{ color: 'var(--ink-700)' }}>IndexedDB · healthy</span></span>
    <span style={{ flexShrink: 0 }}>Queue <span style={{ color: 'var(--ink-700)' }}>0 backlog</span></span>
    <span style={{ flex: 1 }}/>
    <span className="mono" style={{ flexShrink: 0 }} title="Cache-bust build identifier">{(window.__LIS_VERSION || '0.x')}</span>
    <span style={{ flexShrink: 0 }}><span className="kbd">⌘K</span> command palette</span>
  </div>
);

Object.assign(window, { Sidebar, TopRail, Topbar, CommandPalette, StatusBar, NAV, ADMIN_DESTINATIONS });
