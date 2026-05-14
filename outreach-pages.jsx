// outreach-pages.jsx — TaskCenter / AdminCenter bucket pages.
//
// Outreach-shaped navigation puts categories first (System Setup, Billing,
// Insurance, …) and lets existing Lattice pages live inside those categories
// as tiles. This file defines:
//
//   • OutreachBucketPage — generic tile-grid bucket layout (reuses the
//     Admin tile pattern so the visual language stays consistent).
//   • TaskCenter-only pages: ThisLocationPage, PreferencesPage.
//   • AdminCenter buckets: SystemSetup, Billing, Customization, Insurance,
//     OtherSetup, PatientSetup, Toxicology, Manage, Monitor, AdminReports.
//
// Buckets that map 1:1 to an existing page (Personnel→users, Rules→rules,
// Device Engine Setup→interfaces, Order Choice Setup→tests) route directly
// in app.jsx — no stub here for those.

const { useState: useStateOR, useEffect: useEffectOR, useMemo: useMemoOR } = React;

// ===== Generic bucket page =====
//
// `tiles` is an array of { id, label, desc, icon, go, permission?, external? }.
// If `go` is set, clicking navigates to that route id via `onNav`. `external`
// is a one-shot side effect (open drawer, run action) — for now unused but
// the signature is reserved.
const OutreachBucketPage = ({ title, sub, tiles, onNav, label, actions, extra }) => {
  const visible = (tiles || []).filter(t => {
    if (!t.permission) return true;
    if (!window.userRoles || !window.currentUser) return true;
    return window.userRoles.userHasPermission(window.currentUser.id, t.permission);
  });
  return (
    <Page label={label || title}>
      <PageHeader title={title} sub={sub} actions={actions}/>
      {extra}
      {visible.length === 0 ? (
        <div className="panel" style={{ padding: '56px 24px', textAlign: 'center' }}>
          <div className="empty-icon" style={{ margin: '0 auto 10px' }}><IconInbox size={18}/></div>
          <div className="empty-title">Nothing wired up here yet</div>
          <div className="empty-sub">
            This bucket exists so the Outreach-style navigation reads complete.
            Sub-pages will land here as the matching feature ships.
          </div>
        </div>
      ) : (
        <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {visible.map(t => {
            const Ico = window[t.icon] || window.IconReports;
            return (
              <button key={t.id} onClick={() => t.go && onNav && onNav(t.go)}
                className="panel lift"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '14px 16px', textAlign: 'left',
                  cursor: 'pointer', background: '#fff',
                  transition: 'background var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--ivory-100)'; e.currentTarget.style.borderColor = 'var(--line-strong)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'var(--line)'; }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6,
                  background: 'var(--ivory-100)',
                  display: 'grid', placeItems: 'center',
                  color: 'var(--ink-500)', flexShrink: 0,
                }}>
                  <Ico size={16}/>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-900)' }}>{t.label}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>{t.desc}</div>
                </div>
                <IconChevRight size={13} style={{ color: 'var(--ink-300)' }}/>
              </button>
            );
          })}
        </div>
      )}
    </Page>
  );
};

// ===== TaskCenter > This Location =====
//
// Location-scoped operational view with three panels:
//   • KPIs (orders / specimens / pending / active location)
//   • Pickups due — orders collected but not yet received at the lab,
//     scoped to the active location. Drives the courier dispatch queue.
//   • Courier route — locations in the courier circuit, ordered by
//     pickup time. Click → switch active location (placeholder until
//     the topbar location switcher lands).
//   • Activity feed — recent audit events for this location's orders.
const ThisLocationPage = ({ onNav }) => {
  const orders = window.useEntities('orders');
  const specimens = window.useEntities('specimens');
  const locations = window.useEntities('locations');
  const audits = window.useEntities('audit_events');
  const patients = window.useEntities('patients');

  // Active-location resolution: user preference first, then first active loc.
  const cur = window.currentUser || {};
  const prefLocId = cur.preferences && cur.preferences.defaultLocationId;
  const activeLoc = (locations || []).find(l => l.id === prefLocId)
                 || (locations || []).find(l => l.active !== false)
                 || (locations || [])[0] || null;
  const locId = activeLoc && activeLoc.id;
  const myOrders = useMemoOR(() => (orders || []).filter(o => !locId || o.locationId === locId), [orders, locId]);
  const mySpecs  = useMemoOR(() => (specimens || []).filter(s => !locId || (s.orderId && (orders || []).some(o => o.id === s.orderId && o.locationId === locId))), [specimens, orders, locId]);

  // Pickups due: specimens with collectedAt set but no pickedUpAt yet.
  // Scoped via order.locationId join.
  const pickupsDue = useMemoOR(() => {
    return mySpecs.filter(s => s.collectedAt && !s.pickedUpAt && !s.receivedAt)
                 .sort((a, b) => (a.collectedAt || 0) - (b.collectedAt || 0))
                 .slice(0, 30);
  }, [mySpecs]);

  // Courier route: every active location ordered by code/name. Stand-in
  // for a real route — when locations get a `pickupSequence` field, sort
  // by that instead.
  const courierRoute = useMemoOR(() => {
    return (locations || []).filter(l => l.active !== false)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [locations]);

  // Activity feed: audit events touching orders or specimens with this
  // locationId, newest first, capped at 30.
  const myOrderIds = useMemoOR(() => new Set(myOrders.map(o => o.id)), [myOrders]);
  const mySpecIds  = useMemoOR(() => new Set(mySpecs.map(s => s.id)), [mySpecs]);
  const recentActivity = useMemoOR(() => {
    return (audits || []).filter(a => {
      if (!locId) return true;
      if (a.entityType === 'order' && myOrderIds.has(a.entityId)) return true;
      if (a.entityType === 'specimen' && mySpecIds.has(a.entityId)) return true;
      return false;
    }).sort((a, b) => (b.ts || b.createdAt || 0) - (a.ts || a.createdAt || 0)).slice(0, 30);
  }, [audits, locId, myOrderIds, mySpecIds]);

  const patientById = useMemoOR(() => Object.fromEntries((patients || []).map(p => [p.id, p])), [patients]);

  return (
    <Page label="This Location">
      <PageHeader title="This Location"
        sub={activeLoc ? `Scoped to ${activeLoc.name || activeLoc.code || activeLoc.id}.` : 'No location selected — operating across all locations.'}/>
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
        {[
          { l: 'Orders here', v: myOrders.length, go: 'orders' },
          { l: 'Samples here', v: mySpecs.length, go: 'specimens' },
          { l: 'Pickups due', v: pickupsDue.length, tone: pickupsDue.length > 0 ? 'amber' : null },
          { l: 'Pending', v: myOrders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length, go: 'results' },
          { l: 'Active location', v: activeLoc ? (activeLoc.name || activeLoc.code) : '—' },
        ].map((s, i, arr) => (
          <button key={s.l} onClick={() => s.go && onNav && onNav(s.go)}
            style={{
              padding: '14px 16px',
              borderRight: i < arr.length - 1 ? '1px solid var(--line)' : 'none',
              background: 'transparent', border: 0,
              borderLeft: 0, borderTop: 0, borderBottom: 0,
              borderRightStyle: i < arr.length - 1 ? 'solid' : 'none',
              borderRightWidth: i < arr.length - 1 ? 1 : 0,
              borderRightColor: 'var(--line)',
              textAlign: 'left',
              cursor: s.go ? 'pointer' : 'default',
              transition: 'background var(--dur-fast) var(--ease-standard)',
            }}
            onMouseEnter={e => { if (s.go) e.currentTarget.style.background = 'var(--ivory-100)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <div className="section-title" style={{ fontSize: 10 }}>{s.l}</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: s.tone === 'amber' ? 'var(--warn-700)' : 'var(--ink-900)', marginTop: 4 }}>{s.v}</div>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
        {/* Pickups due ----------------------------------- */}
        <div className="panel">
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
            <div className="section-title" style={{ fontSize: 11 }}>Pickups due ({pickupsDue.length})</div>
          </div>
          {pickupsDue.length === 0 ? (
            <div className="empty" style={{ padding: '24px 16px' }}>
              <div className="empty-title">All caught up</div>
              <div className="empty-sub">No specimens collected here that haven't been picked up.</div>
            </div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Accession</th><th>Patient</th><th>Collected</th><th>Type</th></tr></thead>
              <tbody>
                {pickupsDue.map(s => {
                  const p = patientById[s.patientId];
                  return (
                    <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => onNav && onNav('specimens')}>
                      <td><span className="mono">{s.accessionNumber || s.barcode}</span></td>
                      <td>{p ? <span><span className="mono">{p.mrn}</span> · {p.lastName}, {p.firstName}</span> : '—'}</td>
                      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{formatDateTime(s.collectedAt)}</span></td>
                      <td><span className="pill" data-tone="ghost">{s.type || '—'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Courier route ---------------------------------- */}
        <div className="panel">
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
            <div className="section-title" style={{ fontSize: 11 }}>Courier route ({courierRoute.length})</div>
          </div>
          {courierRoute.length === 0 ? (
            <div className="empty" style={{ padding: '24px 16px' }}>
              <div className="empty-sub">No locations configured.</div>
            </div>
          ) : (
            <div>
              {courierRoute.slice(0, 12).map((l, i) => (
                <div key={l.id}
                  style={{
                    padding: '10px 14px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--line-soft)',
                    background: l.id === locId ? 'var(--sage-50)' : '#fff',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 11,
                    background: l.id === locId ? 'var(--sage-500)' : 'var(--ivory-200)',
                    color: l.id === locId ? '#fff' : 'var(--ink-500)',
                    display: 'grid', placeItems: 'center',
                    fontSize: 11, fontWeight: 500,
                  }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-900)' }}>{l.name || l.code}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>{l.code}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity feed --------------------------------- */}
      <div className="panel">
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
          <div className="section-title" style={{ fontSize: 11 }}>Recent activity at this location</div>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="xs" data-variant="ghost" onClick={() => onNav && onNav('reports')}>Full activity log</button>
        </div>
        {recentActivity.length === 0 ? (
          <div className="empty" style={{ padding: '24px 16px' }}>
            <div className="empty-sub">No recent activity here.</div>
          </div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {recentActivity.map(a => (
              <div key={a.id}
                style={{ padding: '8px 14px', borderTop: '1px solid var(--line-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)', width: 130 }}>{formatDateTime(a.ts || a.createdAt)}</span>
                <span className="pill" data-tone="ghost" style={{ height: 18, padding: '0 6px', fontSize: 10.5 }}>{a.type}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-700)' }}>{a.entityType} · <span className="mono" style={{ color: 'var(--ink-400)' }}>{(a.entityId || '').slice(-8)}</span></span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{a.actor}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
};

// ===== TaskCenter > My Preferences =====
//
// Per-user settings persisted on `user.preferences`. The keys here are
// consumed by:
//   • app.jsx defaultLanding (initial route after login)
//   • notification-toasts.jsx mutedNotifKinds (suppress toast)
//   • formatDateTime / display helpers tzPref
//   • this-location's location picker default
//   • Tweaks panel densityPref override
const LANDING_TABS = [
  { id: '',           label: 'Dashboard (default)' },
  { id: 'dashboard',  label: 'Dashboard' },
  { id: 'orders',     label: 'Orders' },
  { id: 'specimens',  label: 'Specimens' },
  { id: 'results',    label: 'Results' },
  { id: 'patients',   label: 'Patient Search' },
  { id: 'accession',  label: 'Accessioning' },
  { id: 'reports',    label: 'Activity Log' },
];
const NOTIF_KINDS = [
  { id: 'system',   label: 'System',   desc: 'TAT breaches, simulator hiccups, lab-wide alerts.' },
  { id: 'role',     label: 'Role',     desc: 'Messages targeted at a role you hold (supervisor, MT, director).' },
  { id: 'user',     label: 'User',     desc: 'Messages addressed to you directly.' },
  { id: 'provider', label: 'Provider', desc: 'Provider callbacks, critical-result outreach.' },
];
const TZ_OPTIONS = [
  { id: '',     label: 'Browser local (default)' },
  { id: 'lab',  label: 'Lab time zone' },
  { id: 'utc',  label: 'UTC' },
];
const DENSITY_OPTIONS = [
  { id: '',            label: 'Use global setting' },
  { id: 'comfortable', label: 'Comfortable (taller rows)' },
  { id: 'compact',     label: 'Compact (denser rows)' },
];

const PreferencesPage = () => {
  const cur = window.currentUser || {};
  const [draft, setDraft] = useStateOR(null);
  const [savedFlash, setSavedFlash] = useStateOR(false);

  useEffectOR(() => {
    const p = (cur && cur.preferences) || {};
    setDraft({
      defaultLanding: p.defaultLanding || '',
      defaultLocationId: p.defaultLocationId || '',
      mutedNotifKinds: p.mutedNotifKinds || [],
      tzPref: p.tzPref || '',
      densityPref: p.densityPref || '',
      keyboardHints: p.keyboardHints !== false,
    });
  }, [cur && cur.id]);

  const locations = window.useEntities('locations');

  if (!cur || !cur.id || !draft) {
    return (
      <Page label="My Preferences">
        <PageHeader title="My Preferences" sub="Loading…"/>
      </Page>
    );
  }

  const save = async () => {
    const existing = await window.db.get('users', cur.id);
    if (!existing) return;
    const next = { ...existing, preferences: { ...draft }, updatedAt: Date.now() };
    await window.db.put('users', next);
    if (window.currentUser && window.currentUser.id === cur.id) {
      window.currentUser = { ...window.currentUser, preferences: { ...draft } };
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const toggleMute = (kind) => {
    setDraft(d => {
      const arr = Array.isArray(d.mutedNotifKinds) ? [...d.mutedNotifKinds] : [];
      const i = arr.indexOf(kind);
      if (i >= 0) arr.splice(i, 1); else arr.push(kind);
      return { ...d, mutedNotifKinds: arr };
    });
  };

  return (
    <Page label="My Preferences">
      <PageHeader title="My Preferences"
        sub="Per-user settings. Theme tweaks live in the floating Tweaks panel; this page covers durable preferences that persist on your user record."
        actions={[
          <button key="s" className="btn" data-size="sm" data-variant="primary" onClick={save}>
            {savedFlash ? 'Saved ✓' : 'Save changes'}
          </button>,
        ]}/>

      <div className="panel" style={{ padding: 20, marginBottom: 14 }}>
        <div className="section-title" style={{ fontSize: 10 }}>Identity</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>Name</div>
            <div style={{ fontSize: 13, color: 'var(--ink-900)', marginTop: 2 }}>
              {[cur.firstName, cur.lastName].filter(Boolean).join(' ') || cur.username || '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>Username</div>
            <div className="mono" style={{ fontSize: 12.5, color: 'var(--ink-900)', marginTop: 2 }}>{cur.username || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>Email</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-900)', marginTop: 2 }}>{cur.email || '—'}</div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <div className="section-title" style={{ fontSize: 11, marginBottom: 10 }}>Defaults</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div>
            <div className="field-label">Default landing tab</div>
            <select className="input" value={draft.defaultLanding} onChange={e => setDraft(d => ({ ...d, defaultLanding: e.target.value }))} style={{ width: '100%' }}>
              {LANDING_TABS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>The page you see right after sign-in.</div>
          </div>
          <div>
            <div className="field-label">Default location override</div>
            <select className="input" value={draft.defaultLocationId} onChange={e => setDraft(d => ({ ...d, defaultLocationId: e.target.value }))} style={{ width: '100%' }}>
              <option value="">— Use lab-active —</option>
              {(locations || []).filter(l => l.active !== false).map(l => (
                <option key={l.id} value={l.id}>{l.code} · {l.name}</option>
              ))}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>Pins "This Location" to your home draw station even when other locations are active.</div>
          </div>
          <div>
            <div className="field-label">Time-zone display</div>
            <select className="input" value={draft.tzPref} onChange={e => setDraft(d => ({ ...d, tzPref: e.target.value }))} style={{ width: '100%' }}>
              {TZ_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>How timestamps render across the app.</div>
          </div>
          <div>
            <div className="field-label">Table density</div>
            <select className="input" value={draft.densityPref} onChange={e => setDraft(d => ({ ...d, densityPref: e.target.value }))} style={{ width: '100%' }}>
              {DENSITY_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 4 }}>Overrides the global density tweak just for you.</div>
          </div>
          <div>
            <div className="field-label">Keyboard hints</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <input type="checkbox" checked={draft.keyboardHints !== false}
                onChange={e => setDraft(d => ({ ...d, keyboardHints: e.target.checked }))}/>
              Show shortcut chips on hover
            </label>
          </div>
        </div>
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <div className="section-title" style={{ fontSize: 11, marginBottom: 6 }}>Notification mutes</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 10 }}>
          Muted kinds skip toasts and the in-app bell but still write to the notifications history.
          Critical-result alerts cannot be muted (patient-safety floor).
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {NOTIF_KINDS.map(k => {
            const muted = (draft.mutedNotifKinds || []).includes(k.id);
            return (
              <button key={k.id} type="button"
                onClick={() => toggleMute(k.id)}
                style={{
                  textAlign: 'left', padding: '10px 12px',
                  background: muted ? 'var(--ivory-100)' : '#fff',
                  border: `1px solid ${muted ? 'var(--line-strong)' : 'var(--line)'}`,
                  borderRadius: 6, cursor: 'pointer',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: muted ? 'var(--ink-400)' : 'var(--ink-900)' }}>{k.label}</span>
                  {muted ? <span className="pill" data-tone="ghost">muted</span> : <span className="pill" data-tone="sage">on</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 3 }}>{k.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    </Page>
  );
};

// ===== AdminCenter bucket configs =====
//
// Buckets that aggregate existing pages route via tiles; pure-stub buckets
// render the empty-bucket state in OutreachBucketPage.

// System Setup used to surface "Snapshot & Migration" as a tile that drilled
// into the legacy AdminPage. Those actions now live in the Manage page header
// (the AdminCenter > Manage route), so this bucket is empty for the moment.
// Lab identity / audit retention sub-pages will land here when they ship.
const SystemSetupPage = ({ onNav }) => (
  <OutreachBucketPage title="System Setup" label="System Setup"
    sub="Lab identity, audit retention. (Snapshot tools moved to Manage.)"
    onNav={onNav}
    tiles={[]}/>
);

const BillingPage = ({ onNav }) => (
  <OutreachBucketPage title="Billing" label="Billing"
    sub="Charge codes, fee schedules, claim status, denials review."
    onNav={onNav}
    tiles={[
      { id: 'charge-codes', label: 'Charge Codes',  desc: 'CPT/HCPCS codes mapped to tests with default fees', icon: 'IconReports', go: 'charge-codes', permission: 'EDIT_LAB_CONFIG' },
      { id: 'claims',       label: 'Claims',        desc: 'One claim per order — open, submitted, paid, denied', icon: 'IconReports', go: 'claims',       permission: 'EDIT_LAB_CONFIG' },
    ]}/>
);

const CustomizationPage = ({ onNav }) => (
  <OutreachBucketPage title="Customization" label="Customization"
    sub="Labels, reference ranges, notifications, look-and-feel."
    onNav={onNav}
    tiles={[
      { id: 'labels',        label: 'Labels & Printing', desc: 'ZPL templates, printer formats',          icon: 'IconLabel',   go: 'labels',        permission: 'EDIT_LABEL_TEMPLATES' },
      { id: 'notifications', label: 'Notifications',     desc: 'TAT thresholds, alert routing',           icon: 'IconBell',    go: 'notifications', permission: 'EDIT_LAB_CONFIG' },
      { id: 'ranges',        label: 'Reference Ranges',  desc: 'Ranges by test, age, sex, population',    icon: 'IconReports', go: 'tests',         permission: 'EDIT_TEST_CATALOG' },
    ]}/>
);

const InsurancePage = ({ onNav }) => (
  <OutreachBucketPage title="Insurance" label="Insurance"
    sub="Payors, plans, eligibility, prior authorization."
    onNav={onNav}
    tiles={[
      { id: 'payors',             label: 'Payors',              desc: 'Carriers — commercial, Medicare, Medicaid, TRICARE',  icon: 'IconShield',  go: 'payors',             permission: 'EDIT_LAB_CONFIG' },
      { id: 'plans',              label: 'Plans',               desc: 'Per-payor products (PPO, HMO, Medicare A, …)',         icon: 'IconShield',  go: 'plans',              permission: 'EDIT_LAB_CONFIG' },
      { id: 'patient-insurance',  label: 'Patient Insurance',   desc: 'Member enrollments, eligibility, primary/secondary',   icon: 'IconUser',    go: 'patient-insurance',  permission: 'EDIT_LAB_CONFIG' },
    ]}/>
);

const OtherSetupPage = ({ onNav }) => (
  <OutreachBucketPage title="Other Setup" label="Other Setup"
    sub="Locations, referring clients, format mappers, holiday schedules."
    onNav={onNav}
    tiles={[
      { id: 'locations', label: 'Locations',     desc: 'Facilities, departments, sites',     icon: 'IconMap',    go: 'locations', permission: 'EDIT_LAB_CONFIG' },
      { id: 'clients',   label: 'Clients',       desc: 'Referring clinics, delivery prefs',  icon: 'IconMap',    go: 'clients',   permission: 'EDIT_LAB_CONFIG' },
      { id: 'mappers',   label: 'Mappers (LML)', desc: 'Inbound/outbound format scripts',    icon: 'IconBranch', go: 'mappers',   permission: 'EDIT_INTERFACES' },
    ]}/>
);

// PatientSetupPage lives in patient-setup-pages.jsx as a direct config page
// (no buckets — it's a single form). Routed in app.jsx.

const ToxicologyPage = ({ onNav }) => (
  <OutreachBucketPage title="Toxicology" label="Toxicology"
    sub="Chain-of-custody, confirmation cascade, UDS panels."
    onNav={onNav}
    tiles={[
      { id: 'tox-panels',    label: 'UDS Panels',         desc: '5-panel, 10-panel, pain-mgmt — analytes, cutoffs, cascade', icon: 'IconBeaker', go: 'tox-panels',    permission: 'EDIT_TEST_CATALOG' },
      { id: 'coc',           label: 'Chain of Custody',   desc: 'Seal, breaks, close-out — forensic / DOT / employer',       icon: 'IconShield', go: 'coc',           permission: 'ACCESSION' },
    ]}/>
);

// Manage is the operational/admin hub now — quality oversight tiles plus the
// snapshot/demo controls (Seed demo / Clear demo / Export local / Import local)
// in the header. The controls live in a shared hook (`useSnapshotActions` in
// admin-pages.jsx) so AdminPage and ManagePage render the same widget without
// drift.
const ManagePage = ({ onNav }) => {
  const snap = window.useSnapshotActions ? window.useSnapshotActions() : { actions: null, modal: null };
  return (
    <OutreachBucketPage title="Manage" label="Manage"
      sub="Operational oversight — quality control, re-routes, recollects, snapshot management."
      onNav={onNav}
      actions={snap.actions ? [snap.actions] : null}
      extra={snap.modal}
      tiles={[
        { id: 'qc',          label: 'QC (Westgard)',  desc: 'Control levels, runs, rule violations',  icon: 'IconBeaker',     go: 'qc',          permission: 'RESOLVE_QC' },
        { id: 'instruments', label: 'Instruments',    desc: 'Connected devices, simulator controls',  icon: 'IconInstrument', go: 'instruments', permission: 'EDIT_INTERFACES' },
      ]}/>
  );
};

const MonitorPage = ({ onNav }) => (
  <OutreachBucketPage title="Monitor" label="Monitor"
    sub="Real-time queues, interface health, instrument status."
    onNav={onNav}
    tiles={[
      { id: 'instruments', label: 'Instruments',   desc: 'Connected devices, live status',     icon: 'IconInstrument', go: 'instruments', permission: 'EDIT_INTERFACES' },
      { id: 'interfaces',  label: 'Interfaces',    desc: 'HL7 integrations and endpoints',     icon: 'IconInterface',  go: 'interfaces',  permission: 'EDIT_INTERFACES' },
      { id: 'reports',     label: 'Activity log',  desc: 'Audit trail across the system',      icon: 'IconReports',    go: 'reports' },
    ]}/>
);

// Admin-side Reports — for now mirrors the Activity log surface. Splits from
// the TaskCenter Reports view once user-facing saved reports land.
const AdminReportsPage = ({ onNav }) => (
  <OutreachBucketPage title="Reports" label="Admin Reports"
    sub="Operational and audit reports. User-facing saved reports live under TaskCenter."
    onNav={onNav}
    tiles={[
      { id: 'reports', label: 'Activity log', desc: 'Audit trail across the system', icon: 'IconReports', go: 'reports' },
    ]}/>
);

Object.assign(window, {
  OutreachBucketPage,
  ThisLocationPage, PreferencesPage,
  SystemSetupPage, BillingPage, CustomizationPage, InsurancePage,
  OtherSetupPage, ToxicologyPage,
  ManagePage, MonitorPage, AdminReportsPage,
});
