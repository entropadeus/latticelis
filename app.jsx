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
  // Per-user `preferences.defaultLanding` overrides 'dashboard' when set;
  // useEffect-driven, only fires when the user *id* actually changes.
  useEffectApp(() => {
    if (!authedUser) return;
    const pref = authedUser.preferences && authedUser.preferences.defaultLanding;
    setActive(pref || 'dashboard');
  }, [authedUser && authedUser.id]);
  const [cmdOpen, setCmdOpen] = useStateApp(false);
  const [newOrderOpen, setNewOrderOpen] = useStateApp(false);
  // Optional pinned filter for the Orders page. Set when navigating from
  // a related view (e.g., Dashboard "Top clients" → Orders pinned to that
  // client). Clear via the X chip in the Orders toolbar.
  const [ordersFilterClientId, setOrdersFilterClientId] = useStateApp(null);
  // Optional preselected patient for the Patient Search page. Set when a
  // drawer hands off (e.g. "Open in Patient Search" on a patient drawer).
  // Cleared by PatientsPage once consumed, or by the auto-clear effect
  // below when the user navigates away.
  const [patientsInitialId, setPatientsInitialId] = useStateApp(null);
  const [tweaks, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // Expose a global hook so the command palette, OrdersPage button, and any future
  // shortcut can all open the New Order drawer without prop-drilling.
  useEffectApp(() => {
    window.openNewOrder = () => {
      if (!hasPermission('CREATE_ORDER')) return;
      setNewOrderOpen(true);
    };
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

  // Cross-component "open Patient Search with this patient preselected" hook.
  // Used by the patient entity drawer's "Open in Patient Search" action so the
  // tech lands directly on the record they were viewing, with demographics +
  // order history + recent results already populated.
  useEffectApp(() => {
    window.openPatientInSearch = (patientId) => {
      setPatientsInitialId(patientId || null);
      setActive('patients');
    };
    return () => { delete window.openPatientInSearch; };
  }, []);

  // Drop the preselected patient when the user navigates away from the
  // Patient Search page, so a fresh visit doesn't auto-open a stale record.
  useEffectApp(() => {
    if (active !== 'patients' && patientsInitialId) setPatientsInitialId(null);
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
    if (!hasPermission('EDIT_RULES')) return;
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

  const activePage = useMemoApp(() => {
    switch (active) {
      case 'dashboard':   return <DashboardPage/>;
      case 'orders':      return <OrdersPage filterClientId={ordersFilterClientId}
                                              onClearFilter={() => setOrdersFilterClientId(null)}/>;
      case 'specimens':   return <SpecimensPage/>;
      case 'results':     return <ResultsPage/>;
      case 'patients':    return <PatientsPage initialPatientId={patientsInitialId} onClearInitial={() => setPatientsInitialId(null)}/>;
      case 'accession':   return <AccessioningPage/>;
      case 'worklists':   return <WorklistsPage/>;
      case 'instruments': return <InstrumentsPage onBack={() => setActive('manage')}/>;
      case 'interfaces':  return <InterfacesPage onBack={() => setActive('manage')}/>;
      case 'partners':    return <PartnersPage onBack={() => setActive('manage')}/>;
      case 'hl7-messages': return <MessageLogPage onBack={() => setActive('manage')}/>;
      case 'rules':       return <RulesEnginePage rules={rules} setRules={setRules} onBack={() => setActive('manage')}/>;
      case 'reports':     return <ReportsPage/>;
      // Legacy 'admin' route — the original tile-grid AdminPage is no longer
      // reachable from the sidebar or any AdminCenter tile. Alias to ManagePage
      // so any stray hardcoded nav lands on the new admin hub instead of
      // 404-ing back to Dashboard via the default branch.
      case 'admin':       return <window.ManagePage onNav={setActive}/>;
      case 'tests':       return <TestCatalogPage onBack={() => setActive('manage')}/>;
      case 'clients':     return <ClientsPage onBack={() => setActive('manage')}/>;
      case 'locations':   return <LocationsPage onBack={() => setActive('manage')}/>;
      case 'labels':      return <LabelsPage onBack={() => setActive('manage')}/>;
      case 'mappers':     return <MappersPage onBack={() => setActive('manage')}/>;
      case 'qc':          return <QcPage onBack={() => setActive('manage')}/>;
      case 'notifications': return <NotificationsPage onBack={() => setActive('manage')}/>;
      case 'users':       return <UsersPage onBack={() => setActive('manage')}/>;
      // ── Outreach-shaped buckets (TaskCenter + AdminCenter) ─────────────
      case 'this-location': return <window.ThisLocationPage onNav={setActive}/>;
      case 'preferences':   return <window.PreferencesPage/>;
      case 'admin-reports': return <window.AdminReportsPage onNav={setActive}/>;
      case 'system-setup':  return <window.SystemSetupPage onNav={setActive}/>;
      case 'billing':       return <window.BillingPage onNav={setActive}/>;
      case 'customization': return <window.CustomizationPage onNav={setActive}/>;
      case 'insurance':     return <window.InsurancePage onNav={setActive}/>;
      case 'other-setup':   return <window.OtherSetupPage onNav={setActive}/>;
      case 'patient-setup': return <PatientSetupPage onBack={() => setActive('admin')}/>;
      case 'toxicology':    return <window.ToxicologyPage onNav={setActive}/>;
      // ── Billing sub-pages ──────────────────────────────────────────────
      case 'charge-codes':       return <ChargeCodesPage onBack={() => setActive('billing')}/>;
      case 'claims':             return <ClaimsPage onBack={() => setActive('billing')}/>;
      // ── Insurance sub-pages ────────────────────────────────────────────
      case 'payors':             return <PayorsPage onBack={() => setActive('insurance')}/>;
      case 'plans':              return <PlansPage onBack={() => setActive('insurance')}/>;
      case 'patient-insurance':  return <PatientInsurancePage onBack={() => setActive('insurance')}/>;
      // ── Toxicology sub-pages ───────────────────────────────────────────
      case 'tox-panels':         return <ToxPanelsPage onBack={() => setActive('toxicology')}/>;
      case 'coc':                return <ChainOfCustodyPage onBack={() => setActive('toxicology')}/>;
      case 'manage':        return <window.ManagePage onNav={setActive}/>;
      case 'monitor':       return <window.MonitorPage onNav={setActive}/>;
      default:            return <DashboardPage/>;
    }
  }, [active, rules, ordersFilterClientId, patientsInitialId, authedUser && authedUser.id]);

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
      <Topbar onCmdK={() => setCmdOpen(true)} onNav={setActive}/>
      <main style={{
        gridColumn: showSidebar ? '2 / 3' : '1 / 2',
        gridRow: '2 / 3',
        minHeight: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column',
        background: 'var(--ivory-50)',
      }}>
        {showTopRail && <TopRail active={active} onNav={setActive}/>}
        {/* Page transition. `key={active}` re-mounts on route change so the
            entry animation re-fires; `slide-up` is the out-quint, 6px-lift
            entrance per the design system (out-quint for entries). */}
        <div key={active} className="slide-up" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {activePage}
        </div>
        <StatusBar/>
      </main>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNav={setActive}/>
      <window.NewOrderDrawer open={newOrderOpen} onClose={() => setNewOrderOpen(false)}/>
      <window.EntityDrawer/>
      <CriticalAlerts/>
      <window.NotificationToasts/>
      <window.ResultReportModal/>
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
