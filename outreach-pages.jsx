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

const { useState: useStateOR, useEffect: useEffectOR } = React;

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
// Location-scoped operational view. For the first cut, surfaces the active
// location chip + counts; deeper filters land when the location switcher in
// the topbar becomes interactive.
const ThisLocationPage = ({ onNav }) => {
  const orders = window.useEntities('orders');
  const specimens = window.useEntities('specimens');
  const locations = window.useEntities('locations');
  const activeLoc = (locations || []).find(l => l.active !== false) || (locations || [])[0] || null;
  const locId = activeLoc && activeLoc.id;
  const myOrders = (orders || []).filter(o => !locId || o.locationId === locId);
  const mySpecs  = (specimens || []).filter(s => !locId || s.locationId === locId);
  return (
    <Page label="This Location">
      <PageHeader title="This Location"
        sub={activeLoc ? `Scoped to ${activeLoc.name || activeLoc.code || activeLoc.id}. Switch via the topbar.` : 'No location selected — operating across all locations.'}/>
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {[
          { l: 'Orders here', v: myOrders.length, go: 'orders' },
          { l: 'Samples here', v: mySpecs.length, go: 'specimens' },
          { l: 'Pending verification', v: myOrders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').length, go: 'results' },
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
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink-900)', marginTop: 4 }}>{s.v}</div>
          </button>
        ))}
      </div>
      <div className="empty" style={{ padding: '40px 24px' }}>
        <div className="empty-title">Deeper location queues land next</div>
        <div className="empty-sub">Pickups due, courier route, location-scoped activity feed.</div>
      </div>
    </Page>
  );
};

// ===== TaskCenter > My Preferences =====
// Per-user surface that points at the existing Tweaks panel for theme/density.
// Future home for default landing tab, notification toggles, default location.
const PreferencesPage = () => {
  const cur = window.currentUser || {};
  return (
    <Page label="My Preferences">
      <PageHeader title="My Preferences"
        sub="Per-user settings. Theme and density currently live in the Tweaks panel (bottom-right floating)."/>
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
      <div className="empty" style={{ padding: '40px 24px' }}>
        <div className="empty-title">More preferences land next</div>
        <div className="empty-sub">Default landing tab, notification toggles, default location, time-zone overrides.</div>
      </div>
    </Page>
  );
};

// ===== AdminCenter bucket configs =====
//
// Buckets that aggregate existing pages route via tiles; pure-stub buckets
// render the empty-bucket state in OutreachBucketPage.

// Lab Identity — edit the fields that appear on printed result reports.
// Reads/writes the singleton lab_config row (id = schema.LAB_CONFIG_ID).
const LabIdentityPage = ({ onBack }) => {
  const cfg = window.useEntity('lab_config', window.schema && window.schema.LAB_CONFIG_ID);
  const [form, setForm] = useStateOR({
    labName: '', labClia: '', labDirectorName: '', labPhone: '', labAddress: '',
  });
  const [saved, setSaved] = useStateOR(false);

  useEffectOR(() => {
    if (!cfg) return;
    setForm({
      labName:         cfg.labName         || '',
      labClia:         cfg.labClia         || '',
      labDirectorName: cfg.labDirectorName || '',
      labPhone:        cfg.labPhone        || '',
      labAddress:      cfg.labAddress      || '',
    });
  }, [cfg && cfg.id]);

  const handleSave = async () => {
    const base = cfg || (window.schema ? window.schema.newLabConfig() : { id: window.schema && window.schema.LAB_CONFIG_ID });
    await window.db.put('lab_config', { ...base, ...form });
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  const LabeledField = ({ label, k, placeholder }) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 4 }}>{label}</label>
      <input className="input" value={form[k]} placeholder={placeholder || ''}
        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}/>
    </div>
  );

  return (
    <Page label="Lab Identity">
      <PageHeader title="Lab Identity"
        sub="Shown on printed result reports and PDF exports."
        actions={[
          { label: saved ? 'Saved ✓' : 'Save', onClick: handleSave, tone: saved ? 'positive' : 'primary' },
          { label: 'Back', onClick: onBack },
        ]}/>
      <div className="panel" style={{ maxWidth: 520, padding: '20px 24px' }}>
        <LabeledField label="Lab name"            k="labName"         placeholder="e.g. Acme Regional Laboratory"/>
        <LabeledField label="CLIA number"          k="labClia"         placeholder="e.g. 12D3456789"/>
        <LabeledField label="Laboratory director"  k="labDirectorName" placeholder="e.g. Jane Smith, MD"/>
        <LabeledField label="Phone"                k="labPhone"        placeholder="e.g. (555) 123-4567"/>
        <LabeledField label="Address"              k="labAddress"      placeholder="e.g. 100 Lab Dr, Suite 1, City, ST 00000"/>
      </div>
    </Page>
  );
};

// System Setup used to surface "Snapshot & Migration" as a tile that drilled
// into the legacy AdminPage. Those actions now live in the Manage page header
// (the AdminCenter > Manage route), so this bucket is empty for the moment.
const SystemSetupPage = ({ onNav }) => (
  <OutreachBucketPage title="System Setup" label="System Setup"
    sub="Lab identity, audit retention. (Snapshot tools moved to Manage.)"
    onNav={onNav}
    tiles={[
      { id: 'lab-identity', label: 'Lab Identity', desc: 'Lab name, CLIA, director — shown on result reports', icon: 'IconReports', go: 'lab-identity', permission: 'EDIT_LAB_CONFIG' },
    ]}/>
);

const BillingPage = ({ onNav }) => (
  <OutreachBucketPage title="Billing" label="Billing"
    sub="Charge codes, fee schedules, client pricing, claim status."
    onNav={onNav} tiles={[]}/>
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
    onNav={onNav} tiles={[]}/>
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

const PatientSetupPage = ({ onNav }) => (
  <OutreachBucketPage title="Patient Setup" label="Patient Setup"
    sub="MRN format, required demographics, duplicate-merge rules."
    onNav={onNav} tiles={[]}/>
);

const ToxicologyPage = ({ onNav }) => (
  <OutreachBucketPage title="Toxicology" label="Toxicology"
    sub="Chain-of-custody, confirmation cascade, UDS panels."
    onNav={onNav} tiles={[]}/>
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
  LabIdentityPage,
  SystemSetupPage, BillingPage, CustomizationPage, InsurancePage,
  OtherSetupPage, PatientSetupPage, ToxicologyPage,
  ManagePage, MonitorPage, AdminReportsPage,
});
