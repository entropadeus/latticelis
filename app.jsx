// Lattice LIS — main app

const { useState: useStateApp, useEffect: useEffectApp, useMemo: useMemoApp, useCallback: useCallbackApp } = React;

// Default tweaks (extracted by the host editor)
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "navStyle": "sidebar",
  "density": "comfortable"
}/*EDITMODE-END*/;

const App = () => {
  // ── Auth gate ─────────────────────────────────────────────────────────
  // The login flag is the source of truth — we re-read it on every render
  // and on auth.subscribeAuth callbacks. When `authedId` is null, the LoginPage
  // is rendered instead of the main shell. `currentUser` (set by current-user.js
  // when the auth flag matches a real user) is the deeper signal — we wait
  // for both to line up before flipping into the app to avoid the brief
  // moment where authedId is set but the user record hasn't hydrated yet.
  const [authTick, bumpAuth] = useStateApp(0);
  useEffectApp(() => {
    if (!window.auth) return;
    const unsub = window.auth.subscribeAuth(() => bumpAuth(t => t + 1));
    return unsub;
  }, []);
  // Bump on currentUser changes too — current-user.js fires its own subscribers
  // when the user record lands; without this hook the app stays on LoginPage
  // for one render after auth.verify resolves.
  useEffectApp(() => {
    if (!window.currentUserApi) return;
    return window.currentUserApi.subscribe(() => bumpAuth(t => t + 1));
  }, []);
  const authedId = window.auth ? window.auth.authedUserId() : null;
  const authedUser = authedId && window.currentUser && window.currentUser.id === authedId
    ? window.currentUser : null;

  const [active, setActive] = useStateApp('dashboard');

  // Reset active page when the signed-in identity changes so a fresh sign-in
  // doesn't land on a Forbidden page left over from the previous operator.
  // useEffect-driven, only fires when the user *id* actually changes.
  useEffectApp(() => {
    if (authedUser) setActive('dashboard');
  }, [authedUser && authedUser.id]);
  const [cmdOpen, setCmdOpen] = useStateApp(false);
  const [newOrderOpen, setNewOrderOpen] = useStateApp(false);
  // Optional pinned filter for the Orders page. Set when navigating from
  // a related view (e.g., Dashboard "Top clients" → Orders pinned to that
  // client). Clear via the X chip in the Orders toolbar.
  const [ordersFilterClientId, setOrdersFilterClientId] = useStateApp(null);
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // Expose a global hook so the command palette, OrdersPage button, and any future
  // shortcut can all open the New Order drawer without prop-drilling.
  useEffectApp(() => {
    window.openNewOrder = () => setNewOrderOpen(true);
    return () => { delete window.openNewOrder; };
  }, []);

  // Cross-component navigation hook (used by alert banner "View" buttons, etc.)
  useEffectApp(() => {
    window.__navTo = (page) => setActive(page);
    return () => { delete window.__navTo; };
  }, []);

  // Cross-component "open Orders pinned to a client" hook. Used by the
  // Dashboard top-clients panel to make a chart row navigable.
  useEffectApp(() => {
    window.openOrdersFilteredByClient = (clientId) => {
      setOrdersFilterClientId(clientId || null);
      setActive('orders');
    };
    return () => { delete window.openOrdersFilteredByClient; };
  }, []);

  // When the user navigates AWAY from Orders, drop the pinned client filter
  // so a fresh visit doesn't see stale state.
  useEffectApp(() => {
    if (active !== 'orders' && ordersFilterClientId) setOrdersFilterClientId(null);
  }, [active]);

  // Rules now live in the persistence pipeline (IndexedDB) — same store everything else uses,
  // so when we port to Electron the rules carry over with the rest of the data via SQLite.
  // The RulesEnginePage API still expects an array + setter, so we adapt: setter diffs current
  // vs incoming and translates to put/delete on the db.
  const rules = window.useEntities('rules');

  // One-time migration: pull any legacy rules out of localStorage into IndexedDB, then clear it.
  useEffectApp(() => {
    (async () => {
      try {
        const legacy = localStorage.getItem('lattice.rules');
        if (!legacy) return;
        const parsed = JSON.parse(legacy);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          localStorage.removeItem('lattice.rules');
          return;
        }
        const existing = await window.db.list('rules');
        const existingIds = new Set(existing.map(r => r.id));
        for (const r of parsed) if (!existingIds.has(r.id)) await window.db.put('rules', r);
        localStorage.removeItem('lattice.rules');
      } catch (e) {
        console.warn('[app] rules migration skipped', e);
      }
    })();
  }, []);

  const setRules = useCallbackApp((updater) => {
    const next = typeof updater === 'function' ? updater(rules) : updater;
    const nextIds = new Set(next.map(r => r.id));
    const prevIds = new Set(rules.map(r => r.id));
    for (const r of next) window.db.put('rules', r);
    for (const id of prevIds) if (!nextIds.has(id)) window.db.delete('rules', id);
  }, [rules]);

  // ⌘K palette
  useEffectApp(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navStyle = tweaks.navStyle || 'sidebar';
  const showSidebar = navStyle === 'sidebar' || navStyle === 'hybrid';
  const showTopRail = navStyle === 'top';

  // Route-level permission gate. Pages that should restrict access by role
  // declare the permission here; if the current user lacks it, we render
  // a Forbidden panel instead of the page. Routes not in this map are
  // unrestricted.
  const ROUTE_PERMISSIONS = {
    accession:     'ACCESSION',
    instruments:   'EDIT_INTERFACES',
    interfaces:    'EDIT_INTERFACES',
    rules:         'EDIT_RULES',
    tests:         'EDIT_TEST_CATALOG',
    clients:       'EDIT_LAB_CONFIG',
    locations:     'EDIT_LAB_CONFIG',
    labels:        'EDIT_LABEL_TEMPLATES',
    mappers:       'EDIT_INTERFACES',
    qc:            'RESOLVE_QC',
    notifications: 'EDIT_LAB_CONFIG',
    users:         'EDIT_USERS',
  };

  const Forbidden = ({ route, perm }) => (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32 }}>
      <div className="panel" style={{ padding: 32, maxWidth: 440, textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink-900)', marginBottom: 8 }}>
          Your role doesn't allow this
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-500)', lineHeight: 1.6, marginBottom: 14 }}>
          The <span className="mono">{route}</span> page requires the
          <span className="mono"> {perm}</span> permission. Talk to a Lab Director or IT Admin if you need access, or sign out and use an account that holds that permission.
        </div>
        <button className="btn" data-size="sm" onClick={() => setActive('dashboard')}>Back to Dashboard</button>
      </div>
    </div>
  );

  const activePage = useMemoApp(() => {
    const perm = ROUTE_PERMISSIONS[active];
    if (perm && window.userRoles && window.currentUser
        && !window.userRoles.userHasPermission(window.currentUser.id, perm)) {
      return <Forbidden route={active} perm={perm}/>;
    }
    switch (active) {
      case 'dashboard':   return <DashboardPage/>;
      case 'orders':      return <OrdersPage filterClientId={ordersFilterClientId}
                                              onClearFilter={() => setOrdersFilterClientId(null)}/>;
      case 'specimens':   return <SpecimensPage/>;
      case 'results':     return <ResultsPage/>;
      case 'patients':    return <PatientsPage/>;
      case 'accession':   return <AccessioningPage/>;
      case 'worklists':   return <WorklistsPage/>;
      case 'instruments': return <InstrumentsPage onBack={() => setActive('admin')}/>;
      case 'interfaces':  return <InterfacesPage onBack={() => setActive('admin')}/>;
      case 'rules':       return <RulesEnginePage rules={rules} setRules={setRules} onBack={() => setActive('admin')}/>;
      case 'reports':     return <ReportsPage/>;
      case 'admin':       return <AdminPage onNav={setActive}/>;
      case 'tests':       return <TestCatalogPage onBack={() => setActive('admin')}/>;
      case 'clients':     return <ClientsPage onBack={() => setActive('admin')}/>;
      case 'locations':   return <LocationsPage onBack={() => setActive('admin')}/>;
      case 'labels':      return <LabelsPage onBack={() => setActive('admin')}/>;
      case 'mappers':     return <MappersPage onBack={() => setActive('admin')}/>;
      case 'qc':          return <QcPage onBack={() => setActive('admin')}/>;
      case 'notifications': return <NotificationsPage onBack={() => setActive('admin')}/>;
      case 'users':       return <UsersPage onBack={() => setActive('admin')}/>;
      default:            return <DashboardPage/>;
    }
  }, [active, rules, ordersFilterClientId, authedUser && authedUser.id]);

  // Render the LoginPage until both (a) the auth flag is set AND (b) the
  // user record hydrated. After verify() succeeds, both hold within one
  // event loop tick — current-user.js refresh() runs synchronously after
  // auth flips the localStorage flag.
  if (!authedUser && window.LoginPage) {
    return <window.LoginPage onSuccess={() => bumpAuth(t => t + 1)}/>;
  }

  return (
    <div className="app" data-nav={navStyle}>
      {showSidebar && <Sidebar active={active} onNav={setActive} collapsed={navStyle === 'hybrid'}/>}
      <Topbar onCmdK={() => setCmdOpen(true)}/>
      <main style={{
        gridColumn: showSidebar ? '2 / 3' : '1 / 2',
        gridRow: '2 / 3',
        minHeight: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        background: 'var(--ivory-50)',
      }}>
        {showTopRail && <TopRail active={active} onNav={setActive}/>}
        <div key={active} className="fade-in" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {activePage}
        </div>
        <StatusBar/>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNav={setActive}/>
      <window.NewOrderDrawer open={newOrderOpen} onClose={() => setNewOrderOpen(false)}/>
      <window.EntityDrawer/>
      <CriticalAlerts/>
      <window.NotificationToasts/>
      <window.SafetyConfirmHost/>

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection title="Navigation">
          <window.TweakRadio label="Layout"
            value={tweaks.navStyle}
            onChange={v => setTweak('navStyle', v)}
            options={[
              { value: 'sidebar', label: 'Sidebar' },
              { value: 'hybrid',  label: 'Hybrid' },
              { value: 'top',     label: 'Top rail' },
            ]}/>
        </window.TweakSection>
        <window.TweakSection title="Notes">
          <div style={{ fontSize: 11.5, color: 'var(--ink-400)', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 8px' }}>
              <strong style={{ color: 'var(--ink-700)' }}>Sidebar</strong> — full-text labels, grouped by domain. Best for new operators.
            </p>
            <p style={{ margin: '0 0 8px' }}>
              <strong style={{ color: 'var(--ink-700)' }}>Hybrid</strong> — icon rail. Frees horizontal space for dense work.
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: 'var(--ink-700)' }}>Top rail</strong> — flat horizontal nav. For users who treat the LIS as one screen.
            </p>
          </div>
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
