// App shell — sidebar, topbar, command palette, navigation
// Tweak: nav style (sidebar / top / hybrid)

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ----- Navigation tree -----
//
// Outreach-shaped two-pane navigation:
//   • Dashboard sits above as the Lattice-specific home.
//   • TaskCenter holds the operator's daily work surfaces.
//   • AdminCenter holds every configuration bucket (mirrors Orchard Outreach's
//     AdminCenter labels — Reports, System Setup, Billing, Customization,
//     Device Engine Setup, Insurance, Order Choice Setup, Other Setup,
//     Patient Setup, Personnel, Toxicology, Rules, Manage, Monitor).
//
// Each tree entry is either:
//   { kind: 'item',    id, label, icon, shortcut?, permission?, anyPermission? }
//   { kind: 'section', id, label, defaultOpen, anyPermission?, children: [...] }
//
// Sections render as collapsible buckets in the sidebar (matches the look
// of Outreach's AdminCenter). Items inside sections are leaf routes that
// `app.jsx` switches on. The legacy `admin` route is still wired and
// reachable via the command palette + System Setup tile.
const NAV = [
  { kind: 'item', id: 'dashboard', label: 'Dashboard', icon: 'IconDashboard' },
  {
    kind: 'section', id: 'taskcenter', label: 'TaskCenter', defaultOpen: true,
    children: [
      { kind: 'item', id: 'orders',        label: 'Manage Orders',  icon: 'IconOrder' },
      { kind: 'item', id: 'specimens',     label: 'Manage Samples', icon: 'IconTube' },
      { kind: 'item', id: 'worklists',     label: 'Worklists',      icon: 'IconList' },
      { kind: 'item', id: 'accession',     label: 'Accessioning',   icon: 'IconAccession', shortcut: 'A', permission: 'ACCESSION' },
      { kind: 'item', id: 'results',       label: 'View Results',   icon: 'IconResults' },
      { kind: 'item', id: 'patients',      label: 'Patient Info',   icon: 'IconSearch' },
      { kind: 'item', id: 'this-location', label: 'This Location',  icon: 'IconMap' },
      { kind: 'item', id: 'preferences',   label: 'My Preferences', icon: 'IconUser' },
      { kind: 'item', id: 'reports',       label: 'Reports',        icon: 'IconReports' },
    ],
  },
  {
    kind: 'section', id: 'admincenter', label: 'AdminCenter', defaultOpen: false,
    anyPermission: ['EDIT_USERS', 'EDIT_RULES', 'EDIT_LAB_CONFIG', 'EDIT_TEST_CATALOG', 'EDIT_INTERFACES', 'EDIT_LABEL_TEMPLATES', 'RESTORE_SNAPSHOT', 'RESOLVE_QC'],
    children: [
      { kind: 'item', id: 'admin-reports', label: 'Reports',             icon: 'IconReports' },
      { kind: 'item', id: 'system-setup',  label: 'System Setup',        icon: 'IconShield',     anyPermission: ['RESTORE_SNAPSHOT', 'EDIT_LAB_CONFIG'] },
      { kind: 'item', id: 'billing',       label: 'Billing',             icon: 'IconReports' },
      { kind: 'item', id: 'customization', label: 'Customization',       icon: 'IconLabel',      anyPermission: ['EDIT_LABEL_TEMPLATES', 'EDIT_LAB_CONFIG', 'EDIT_TEST_CATALOG'] },
      { kind: 'item', id: 'interfaces',    label: 'Device Engine Setup', icon: 'IconInterface',  permission: 'EDIT_INTERFACES' },
      { kind: 'item', id: 'insurance',     label: 'Insurance',           icon: 'IconShield' },
      { kind: 'item', id: 'tests',         label: 'Order Choice Setup',  icon: 'IconBeaker',     permission: 'EDIT_TEST_CATALOG' },
      { kind: 'item', id: 'other-setup',   label: 'Other Setup',         icon: 'IconMap',        anyPermission: ['EDIT_LAB_CONFIG', 'EDIT_INTERFACES'] },
      { kind: 'item', id: 'patient-setup', label: 'Patient Setup',       icon: 'IconUser' },
      { kind: 'item', id: 'users',         label: 'Personnel',           icon: 'IconUser',       permission: 'EDIT_USERS' },
      { kind: 'item', id: 'toxicology',    label: 'Toxicology',          icon: 'IconBeaker' },
      { kind: 'item', id: 'rules',         label: 'Rules',               icon: 'IconRules',      permission: 'EDIT_RULES' },
      { kind: 'item', id: 'manage',        label: 'Manage',              icon: 'IconList',       anyPermission: ['RESOLVE_QC', 'EDIT_INTERFACES'] },
      { kind: 'item', id: 'monitor',       label: 'Monitor',             icon: 'IconInstrument', anyPermission: ['EDIT_INTERFACES', 'EDIT_LAB_CONFIG'] },
    ],
  },
];

// Flat list of all leaf items — used by TopRail (alt nav style) and by the
// command palette so every reachable route is indexable regardless of where
// it sits in the tree.
const __flattenNav = (tree) => {
  const out = [];
  const walk = (nodes) => nodes.forEach(n => {
    if (n.kind === 'section') walk(n.children || []);
    else out.push(n);
  });
  walk(tree);
  return out;
};
const NAV_FLAT = __flattenNav(NAV);

// Hidden destinations not on the sidebar but still command-palette indexable.
// The legacy Admin tile-grid page is kept here so power users can jump to it
// without going through System Setup.
const ADMIN_DESTINATIONS = [
  { id: 'admin', label: 'Admin (legacy tile grid)', icon: 'IconAdmin', anyPermission: ['EDIT_USERS', 'EDIT_RULES', 'EDIT_LAB_CONFIG', 'EDIT_TEST_CATALOG', 'EDIT_INTERFACES', 'EDIT_LABEL_TEMPLATES', 'RESTORE_SNAPSHOT', 'RESOLVE_QC'] },
];

// Helper: does the current user pass a NAV entry's permission gate?
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

// Sidebar section open/closed state persists per-user across reloads so the
// operator's preferred fold stays put.
const __SECTION_STATE_KEY = 'lattice.nav.sections.v1';
const __readSectionState = () => {
  try { return JSON.parse(localStorage.getItem(__SECTION_STATE_KEY) || '{}') || {}; }
  catch { return {}; }
};
const __writeSectionState = (st) => {
  try { localStorage.setItem(__SECTION_STATE_KEY, JSON.stringify(st)); } catch {}
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

// ----- Sidebar item button (leaf) -----
const NavItemButton = ({ item, active, onNav, collapsed, indent }) => {
  const Icon = window[item.icon];
  const isActive = active === item.id;
  return (
    <button
      onClick={() => onNav(item.id)}
      title={collapsed ? item.label : undefined}
      style={{
        width: '100%',
        display: 'flex', alignItems: 'center', gap: 10,
        height: 30,
        padding: collapsed ? '0' : (indent ? '0 10px 0 22px' : '0 10px'),
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
        transition: 'background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard)',
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
};

// ----- Sidebar section (collapsible, smooth grid-template-rows animation) -----
const NavSection = ({ section, open, onToggle, active, onNav, collapsed }) => {
  // When the sidebar is rail-collapsed (icon only), the section header acts
  // as a non-interactive divider with the section's first letter — clicking
  // any child still works, just no expand/collapse toggle UX.
  const visibleChildren = (section.children || []).filter(__navItemAllowed);
  if (visibleChildren.length === 0) return null;

  if (collapsed) {
    // Rail mode — drop the section chrome, render children flat with a thin divider.
    return (
      <div style={{ marginBottom: 8, paddingTop: 6, borderTop: '1px solid var(--line-soft)' }}>
        {visibleChildren.map(item => (
          <NavItemButton key={item.id} item={item} active={active} onNav={onNav} collapsed/>
        ))}
      </div>
    );
  }

  return (
    <div className="nav-section" data-open={open ? 'true' : 'false'} style={{ marginBottom: 6 }}>
      <button onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px 6px', border: 0, background: 'transparent',
          cursor: 'pointer', textAlign: 'left',
          color: 'var(--ink-500)',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--ink-900)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--ink-500)'}>
        <IconChevRight size={11} className="nav-section-chevron"/>
        <span className="section-title" style={{ fontSize: 10, padding: 0 }}>{section.label}</span>
      </button>
      <div className="nav-section-body">
        <div>
          {visibleChildren.map(item => (
            <NavItemButton key={item.id} item={item} active={active} onNav={onNav} indent/>
          ))}
        </div>
      </div>
    </div>
  );
};

// ----- Sidebar -----
const Sidebar = ({ active, onNav, collapsed }) => {
  // Force re-evaluation when the current operator changes (sign-in/sign-out
  // or operator switch) so the permission filter re-runs against the new id.
  const [, force] = useState(0);
  useEffect(() => {
    if (!window.currentUserApi) return;
    return window.currentUserApi.subscribe(() => force(x => x + 1));
  }, []);

  // Per-section open/closed state. Hydrate from localStorage on first paint;
  // fall back to each section's defaultOpen. When a section is auto-opened
  // because the active route lives inside it, that decision is sticky for
  // the current session but not persisted (the user's explicit fold wins).
  const [sectionState, setSectionState] = useState(() => {
    const saved = __readSectionState();
    const out = {};
    NAV.forEach(n => {
      if (n.kind === 'section') out[n.id] = saved[n.id] != null ? !!saved[n.id] : !!n.defaultOpen;
    });
    return out;
  });

  // If the active route lives inside a collapsed section, auto-open that
  // section so the breadcrumb reads naturally. Don't persist this — the
  // user's last explicit toggle still wins across sessions.
  useEffect(() => {
    const sec = NAV.find(n => n.kind === 'section' && (n.children || []).some(c => c.id === active));
    if (sec && !sectionState[sec.id]) {
      setSectionState(s => ({ ...s, [sec.id]: true }));
    }
  }, [active]);

  const toggleSection = (id) => {
    setSectionState(s => {
      const next = { ...s, [id]: !s[id] };
      __writeSectionState(next);
      return next;
    });
  };

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
        {NAV.map(node => {
          if (node.kind === 'item') {
            if (!__navItemAllowed(node)) return null;
            return <NavItemButton key={node.id} item={node} active={active} onNav={onNav} collapsed={collapsed}/>;
          }
          if (node.kind === 'section') {
            if (!__navItemAllowed(node)) return null;
            return (
              <NavSection key={node.id}
                section={node}
                open={!!sectionState[node.id]}
                onToggle={() => toggleSection(node.id)}
                active={active}
                onNav={onNav}
                collapsed={collapsed}/>
            );
          }
          return null;
        })}
      </nav>
      <div style={{ borderTop: '1px solid var(--line)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--ink-400)' }}>
        <span className="dot" data-tone="ok"/>
        {!collapsed && <span>All systems operational</span>}
      </div>
    </aside>
  );
};

// ----- Top rail (alt nav style) -----
// Flattens the hierarchical NAV so every leaf route is reachable from a
// single horizontal rail. Section grouping is dropped here on purpose —
// the rail is the "single-row densest" variant, not a tree.
const TopRail = ({ active, onNav }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 2,
    height: 36, padding: '0 8px',
    borderBottom: '1px solid var(--line)',
    background: 'var(--ivory-50)',
    overflowX: 'auto',
  }}>
    {NAV_FLAT.filter(__navItemAllowed).map(item => {
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

// ----- Universal search bar -----
//
// As-you-type search across the entities a clinic user looks for most:
// patients, orders, specimens, results, clients, tests. Results are grouped
// by entity type; clicking a row opens the universal entity drawer for
// patient/order/specimen/result, or navigates to the admin page for
// clients/tests. The ⌘K command palette is still wired for action / page
// navigation — this bar is for finding *data*.
const UniversalSearch = ({ onNav }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  const patients  = window.useEntities('patients');
  const orders    = window.useEntities('orders');
  const specimens = window.useEntities('specimens');
  const results   = window.useEntities('results');
  const clients   = window.useEntities('clients');
  const tests     = window.useEntities('tests');

  // Build a flat, ranked match list across all collections. Each match is
  // { kind, id, label, sub, action } where `action()` is the click handler.
  // Cap the per-collection contribution so a single noisy collection can't
  // monopolize the dropdown.
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const hit = (s) => (s || '').toLowerCase().includes(term);
    const out = [];
    const push = (m, cap) => {
      if (out.filter(x => x.kind === m.kind).length >= cap) return;
      out.push(m);
    };

    for (const p of (patients || [])) {
      const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
      if (hit(name) || hit(p.mrn) || hit(p.dob) || hit(p.id)) {
        push({
          kind: 'Patient', id: p.id,
          label: name || p.mrn || p.id,
          sub: [p.mrn && `MRN ${p.mrn}`, p.dob, p.sex].filter(Boolean).join(' · '),
          action: () => window.openEntity && window.openEntity('patient', p.id),
        }, 6);
      }
    }
    for (const o of (orders || [])) {
      if (hit(o.orderNumber) || hit(o.id) || hit(o.placerOrderNumber) || hit(o.providerId)) {
        push({
          kind: 'Order', id: o.id,
          label: o.orderNumber || o.id,
          sub: [o.status, o.priority, o.providerId].filter(Boolean).join(' · '),
          action: () => window.openEntity && window.openEntity('order', o.id),
        }, 6);
      }
    }
    for (const s of (specimens || [])) {
      if (hit(s.accessionNumber) || hit(s.id) || hit(s.barcode)) {
        push({
          kind: 'Specimen', id: s.id,
          label: s.accessionNumber || s.id,
          sub: [s.status, s.containerType, s.condition].filter(Boolean).join(' · '),
          action: () => window.openEntity && window.openEntity('specimen', s.id),
        }, 6);
      }
    }
    for (const r of (results || [])) {
      if (hit(r.id) || hit(r.testCode) || hit(r.testName)) {
        push({
          kind: 'Result', id: r.id,
          label: r.testName || r.testCode || r.id,
          sub: [r.value && (r.value + (r.units || '')), r.status, r.flag].filter(Boolean).join(' · '),
          action: () => window.openEntity && window.openEntity('result', r.id),
        }, 6);
      }
    }
    for (const c of (clients || [])) {
      if (hit(c.code) || hit(c.name)) {
        push({
          kind: 'Client', id: c.id,
          label: [c.code, c.name].filter(Boolean).join(' — ') || c.id,
          sub: [c.type, c.contactName, c.phone].filter(Boolean).join(' · '),
          action: () => onNav && onNav('clients'),
        }, 4);
      }
    }
    for (const t of (tests || [])) {
      if (hit(t.code) || hit(t.name)) {
        push({
          kind: 'Test', id: t.id,
          label: [t.code, t.name].filter(Boolean).join(' — ') || t.id,
          sub: [t.specimenType, t.units].filter(Boolean).join(' · '),
          action: () => onNav && onNav('tests'),
        }, 4);
      }
    }
    return out.slice(0, 30);
  }, [q, patients, orders, specimens, results, clients, tests]);

  useEffect(() => { setIdx(0); }, [q]);

  const pick = (m) => {
    if (!m) return;
    m.action && m.action();
    setOpen(false);
    setQ('');
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current && inputRef.current.blur(); return; }
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(matches.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter')     { e.preventDefault(); pick(matches[idx]); }
  };

  // Group matches by kind for display, preserving the in-list order.
  const grouped = useMemo(() => {
    const g = {};
    matches.forEach(m => {
      if (!g[m.kind]) g[m.kind] = [];
      g[m.kind].push(m);
    });
    return g;
  }, [matches]);

  const showPanel = open && q.trim().length > 0;

  return (
    <div style={{ flex: 1, maxWidth: 600, position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: 32, padding: '0 12px',
        border: '1px solid ' + (showPanel ? 'var(--ink-300)' : 'var(--line)'),
        borderRadius: 6,
        background: '#fff',
        transition: 'border-color var(--dur-fast) var(--ease-standard)',
      }}>
        <IconSearch size={14} style={{ color: 'var(--ink-400)' }}/>
        <input ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Search patients, orders, samples, results, clients, tests…"
          style={{
            flex: 1, border: 'none', outline: 'none',
            background: 'transparent', fontSize: 12.5, color: 'var(--ink-900)',
          }}/>
        {q && (
          <button onClick={() => { setQ(''); inputRef.current && inputRef.current.focus(); }}
            title="Clear"
            style={{ border: 0, background: 'transparent', color: 'var(--ink-400)', cursor: 'pointer', padding: 2, display: 'flex' }}>
            <IconClose size={12}/>
          </button>
        )}
        <span className="kbd" style={{ fontSize: 10 }}>⌘K</span>
      </div>
      {showPanel && (
        <>
          <div onMouseDown={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 60 }}/>
          <div className="slide-down" style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            zIndex: 61,
            background: '#fff',
            border: '1px solid var(--line)',
            borderRadius: 6,
            boxShadow: 'var(--shadow-pop)',
            maxHeight: 'min(520px, 70vh)', overflowY: 'auto',
            padding: 6,
          }}>
            {matches.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--ink-400)', fontSize: 12.5 }}>
                No matches for <span className="mono">{q}</span>.
                <div style={{ marginTop: 6, fontSize: 11.5 }}>
                  Try a patient name, MRN, accession, order number, or test code.
                </div>
              </div>
            ) : (
              Object.entries(grouped).map(([kind, list]) => (
                <div key={kind} style={{ marginBottom: 6 }}>
                  <div className="section-title" style={{ padding: '6px 10px 4px', fontSize: 10 }}>{kind}</div>
                  {list.map((m, i) => {
                    const flatIndex = matches.indexOf(m);
                    const isActive = flatIndex === idx;
                    return (
                      <button key={kind + ':' + m.id}
                        onMouseEnter={() => setIdx(flatIndex)}
                        onClick={() => pick(m)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                          padding: '7px 10px', border: 0,
                          background: isActive ? 'var(--ivory-100)' : 'transparent',
                          borderRadius: 5, cursor: 'pointer', textAlign: 'left',
                        }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: 'var(--ink-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {m.label}
                          </div>
                          {m.sub && (
                            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {m.sub}
                            </div>
                          )}
                        </div>
                        {isActive && <IconArrowRight size={12} style={{ color: 'var(--ink-400)' }}/>}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
            <div style={{ borderTop: '1px solid var(--line)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 14, fontSize: 11, color: 'var(--ink-400)' }}>
              <span><span className="kbd">↑↓</span> navigate</span>
              <span><span className="kbd">↵</span> open</span>
              <span><span className="kbd">esc</span> close</span>
              <span style={{ flex: 1 }}/>
              <span><span className="kbd">⌘K</span> commands</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ----- Topbar (search + actions) -----
const Topbar = ({ onCmdK, onNav }) => {
  return (
    <header style={{
      gridColumn: '2 / 3',
      borderBottom: '1px solid var(--line)',
      background: 'var(--ivory-50)',
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 16px',
      height: 'var(--topbar)',
    }}>
      <UniversalSearch onNav={onNav}/>

      <div style={{ flex: 1 }}/>

      <button className="btn" data-size="sm" data-variant="ghost" style={{ gap: 6 }}>
        <IconLocation size={14}/>
        All Locations
        <IconChevDown size={12}/>
      </button>

      <div style={{ width: 1, height: 20, background: 'var(--line)' }}/>

      <UserSwitcher/>

      <div style={{ width: 1, height: 20, background: 'var(--line)' }}/>

      <button className="btn" data-variant="ghost" data-size="sm" style={{ width: 30, padding: 0, justifyContent: 'center' }} onClick={onCmdK} title="Command palette (⌘K)">
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
      ...NAV_FLAT.filter(__navItemAllowed).map(n => ({ id: 'nav-' + n.id, label: 'Go to ' + n.label, kind: 'Navigate', target: n.id })),
      // Hidden destinations not on the sidebar (legacy Admin tile grid, etc.)
      // are still indexable via the palette. Same permission gates apply.
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

Object.assign(window, { Sidebar, TopRail, Topbar, CommandPalette, StatusBar, NAV, NAV_FLAT, ADMIN_DESTINATIONS, UniversalSearch });
