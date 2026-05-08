const AdminPage = ({ onNav }) => {
  // Each tile declares the permission needed to see it. Tiles without a
  // permission gate are visible to everyone who reached the Admin page
  // (the Admin page itself is gated at the sidebar level via anyPermission).
  const tiles = [
    { id: 'users',        label: 'Users & Roles',     desc: 'Manage users, roles, permissions',           icon: 'IconUser',       go: 'users',         permission: 'EDIT_USERS' },
    { id: 'clients',      label: 'Clients',           desc: 'Referring clinics, delivery preferences',    icon: 'IconMap',        go: 'clients',       permission: 'EDIT_LAB_CONFIG' },
    { id: 'locations',    label: 'Locations',         desc: 'Facilities, departments, sites',             icon: 'IconMap',        go: 'locations',     permission: 'EDIT_LAB_CONFIG' },
    { id: 'instruments',  label: 'Instruments',       desc: 'Configure devices and connectivity',         icon: 'IconInstrument', go: 'instruments',   permission: 'EDIT_INTERFACES' },
    { id: 'interfaces',   label: 'Interfaces',        desc: 'HL7 integrations and endpoints',             icon: 'IconInterface',  go: 'interfaces',    permission: 'EDIT_INTERFACES' },
    { id: 'tests',        label: 'Test Catalog',      desc: 'Tests, panels, analytes, LOINC',             icon: 'IconBeaker',     go: 'tests',         permission: 'EDIT_TEST_CATALOG' },
    { id: 'mappers',      label: 'Mappers (LML)',     desc: 'Inbound/outbound format scripts',            icon: 'IconBranch',     go: 'mappers',       permission: 'EDIT_INTERFACES' },
    { id: 'qc',           label: 'QC (Westgard)',     desc: 'Control levels, runs, rule violations',      icon: 'IconBeaker',     go: 'qc',            permission: 'RESOLVE_QC' },
    { id: 'rules',        label: 'Rules Engine',      desc: 'Order routing, validation, reflex logic',    icon: 'IconRules',      go: 'rules',         permission: 'EDIT_RULES' },
    { id: 'ranges',       label: 'Reference Ranges',  desc: 'Ranges by test, age, sex, population',       icon: 'IconReports',    go: 'tests',         permission: 'EDIT_TEST_CATALOG' },
    { id: 'notifications',label: 'Notifications',     desc: 'TAT thresholds, alert routing, recent breaches', icon: 'IconBell',  go: 'notifications', permission: 'EDIT_LAB_CONFIG' },
    { id: 'labels',       label: 'Labels & Printing', desc: 'Label templates, printers, formats',         icon: 'IconLabel',      go: 'labels',        permission: 'EDIT_LABEL_TEMPLATES' },
    { id: 'audit',        label: 'Audit & Compliance',desc: 'Audit log, retention, access reviews',       icon: 'IconShield',     go: 'reports' },
  ].filter(t => {
    if (!t.permission) return true;
    if (!window.userRoles || !window.currentUser) return true;
    return window.userRoles.userHasPermission(window.currentUser.id, t.permission);
  });
  const canRestoreSnapshot = hasPermission('RESTORE_SNAPSHOT');

  const exportSnapshot = async () => {
    const snap = await window.db.exportAll();
    const json = JSON.stringify(snap, null, 2);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lattice-lis-${ts}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const [importPreview, setImportPreview] = useStateOS(null);

  // Test hook so a non-file-dialog code path can drive the modal (for E2E tests).
  // The file-input flow is the user's normal entry point; this exists because
  // synthetic click events on detached <input type=file> can't carry a File.
  useEffectOS(() => {
    window.__previewImport = async (snap) => {
      if (!hasPermission('RESTORE_SNAPSHOT')) return;
      try {
        const diff = await window.db.diffSnapshot(snap);
        setImportPreview({ snap, diff, fileName: '(programmatic)' });
      } catch (e) {
        await safetyNotice({ tone: 'danger', title: 'Restore blocked', message: e.message });
      }
    };
    return () => { delete window.__previewImport; };
  }, []);

  const importSnapshot = async () => {
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      if (!hasPermission('RESTORE_SNAPSHOT')) return;
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      let snap;
      try { snap = JSON.parse(text); }
      catch (e) {
        await safetyNotice({ tone: 'danger', title: 'Invalid JSON', message: e.message });
        return;
      }
      try {
        const diff = await window.db.diffSnapshot(snap);
        setImportPreview({ snap, diff, fileName: file.name });
      } catch (e) {
        await safetyNotice({ tone: 'danger', title: 'Restore blocked', message: e.message });
      }
    };
    input.click();
  };

  const confirmImport = async () => {
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    if (!importPreview) return;
    const totalAdded = Object.values(importPreview.diff.collections || {}).reduce((n, c) => n + (c.added || 0), 0);
    const totalRemoved = Object.values(importPreview.diff.collections || {}).reduce((n, c) => n + (c.removed || 0), 0);
    const totalModified = Object.values(importPreview.diff.collections || {}).reduce((n, c) => n + (c.modified || 0), 0);
    const ask = await safetyConfirm({
      id: 'admin.database.restore',
      tone: 'danger',
      title: 'Restore database',
      message: 'This wipes the current browser database, re-checks the snapshot diff, then restores the selected file.',
      facts: [
        safetyFact('file', importPreview.fileName),
        safetyFact('added', totalAdded),
        safetyFact('removed', totalRemoved),
        safetyFact('modified', totalModified),
        safetyFact('records', importPreview.diff.validation ? importPreview.diff.validation.totalRecords : '-'),
        safetyFact('bytes', importPreview.diff.validation ? importPreview.diff.validation.totalBytes : '-'),
        safetyFact('warnings', importPreview.diff.validation && importPreview.diff.validation.warnings.length ? importPreview.diff.validation.warnings.join('; ') : 'none'),
        safetyFact('snapshot version', importPreview.snap.version),
      ],
      requireTypedText: 'RESTORE',
      entityType: 'database',
      entityId: 'all',
      confirmLabel: 'Restore database',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    try {
      const freshDiff = await window.db.diffSnapshot(importPreview.snap);
      setImportPreview({ ...importPreview, diff: freshDiff });
      const r = await window.db.importAll(importPreview.snap, { allowVersionSkew: true });
      setImportPreview(null);
      await safetyNotice({
        tone: 'info',
        title: 'Restore complete',
        message: `Restored ${r.restored} records (${r.skipped} unknown collections skipped).`,
      });
    } catch (e) {
      await safetyNotice({ tone: 'danger', title: 'Import failed', message: e.message });
    }
  };

  const resetDb = async () => {
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    const snap = await window.db.exportAll();
    const counts = Object.entries(snap.collections || {}).map(([name, rows]) => `${name}:${(rows || []).length}`).join(' ');
    const ask = await safetyConfirm({
      id: 'admin.database.reset',
      tone: 'danger',
      title: 'Reset database',
      message: 'This wipes every collection in the browser database. Export first if anything matters.',
      facts: [safetyFact('collections', counts || 'empty'), safetyFact('version', snap.version)],
      requireTypedText: 'RESET',
      entityType: 'database',
      entityId: 'all',
      confirmLabel: 'Reset database',
      audit: false,
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    await window.db.dropAll();
    if (window.events) {
      window.events.publish('operator.safety.confirmed', {
        actor: currentActorId(),
        actionId: 'admin.database.reset',
        entityType: 'database',
        entityId: 'all',
        typedText: ask.typedText,
      });
    }
    await safetyNotice({ tone: 'info', title: 'Database reset', message: 'Database cleared.' });
  };

  const [seeding, setSeeding] = useStateOS(false);
  const seedDemo = async () => {
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    if (!window.seed) { await safetyNotice({ tone: 'danger', title: 'Seed unavailable', message: 'Seed module not loaded.' }); return; }
    const ask = await safetyConfirm({
      id: 'admin.demo.seed',
      tone: 'warning',
      title: 'Seed demo data',
      message: 'This clears prior __demo_ records, then generates realistic demo patients, orders, specimens, results, QC chains, and audit history. Non-demo data is left alone.',
      facts: [safetyFact('scope', '__demo_ records only'), safetyFact('non-demo data', 'preserved')],
      entityType: 'database',
      entityId: 'demo',
      confirmLabel: 'Seed demo',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    setSeeding(true);
    try {
      const summary = await window.seed.demo();
      await safetyNotice({
        tone: 'info',
        title: 'Demo data seeded',
        message: Object.entries(summary).map(([k,v]) => k + ': ' + v).join(' | '),
      });
    } catch (e) {
      console.error('[admin] seed failed', e);
      await safetyNotice({ tone: 'danger', title: 'Seed failed', message: e.message });
    } finally {
      setSeeding(false);
    }
  };
  const clearDemo = async () => {
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    if (!window.seed) { await safetyNotice({ tone: 'danger', title: 'Seed unavailable', message: 'Seed module not loaded.' }); return; }
    const ask = await safetyConfirm({
      id: 'admin.demo.clear',
      tone: 'danger',
      title: 'Clear demo data',
      message: 'This removes all records marked with the __demo_ prefix.',
      facts: [safetyFact('scope', '__demo_ records')],
      entityType: 'database',
      entityId: 'demo',
      confirmLabel: 'Clear demo',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RESTORE_SNAPSHOT')) return;
    const removed = await window.seed.clear();
    await safetyNotice({ tone: 'info', title: 'Demo data cleared', message: 'Removed ' + removed + ' demo records.' });
  };

  return (
    <Page label="Admin">
      <PageHeader title="Admin" sub="System configuration and governance."
        actions={[
          <button key="seed" className="btn" data-size="sm" data-variant="primary" onClick={seedDemo}
            disabled={seeding || !canRestoreSnapshot}
            title={permissionTitle(canRestoreSnapshot, 'Seed demo data', 'restore or reset data')}>
            {seeding ? 'Seeding…' : 'Seed demo'}
          </button>,
          <button key="seedClr" className="btn" data-size="sm" onClick={clearDemo}
            disabled={seeding || !canRestoreSnapshot}
            title={permissionTitle(canRestoreSnapshot, 'Clear demo data', 'restore or reset data')}>Clear demo</button>,
          <button key="exp" className="btn" data-size="sm" onClick={exportSnapshot}>Export</button>,
          <button key="imp" className="btn" data-size="sm" onClick={importSnapshot}
            disabled={!canRestoreSnapshot}
            title={permissionTitle(canRestoreSnapshot, 'Import snapshot', 'restore or reset data')}>Import</button>,
          <button key="rst" className="btn" data-size="sm" data-variant="danger" onClick={resetDb}
            disabled={!canRestoreSnapshot}
            title={permissionTitle(canRestoreSnapshot, 'Reset database', 'restore or reset data')}>Reset</button>,
        ]}/>
      {/* Environment strip — honest about prototype status. The amber dot
          signals "this is not production"; the tooltip explains where to
          find the actual capability roster (the Build Ledger). */}
      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {[
          { l: 'Environment', v: (
            <span title="Pre-production prototype. Tier 6 items (real MLLP transport, auth/MFA, FHIR R4, real Zebra-over-TCP) are deferred. See Build Ledger for what ships vs. defers.">
              <span className="dot" data-tone="warn" style={{ marginRight: 6 }}/>Prototype
            </span>
          ) },
          { l: 'Build', v: <span className="mono" title="Cache-bust build identifier">{(window.__LIS_VERSION || '0.x') + ''}</span> },
          { l: 'Database', v: <><span className="dot" data-tone="ok" style={{ marginRight: 6 }}/>IndexedDB</> },
          { l: 'System time', v: new Date().toISOString().slice(0,16).replace('T', ' ') + ' UTC' },
        ].map((s, i) => (
          <div key={s.l} style={{ padding: '12px 16px', borderRight: i < 3 ? '1px solid var(--line)' : 'none' }}>
            <div className="section-title" style={{ fontSize: 10 }}>{s.l}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-900)', marginTop: 2, display: 'flex', alignItems: 'center' }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {tiles.map(t => {
          const Ico = window[t.icon];
          return (
            <button key={t.id} onClick={() => t.go && onNav(t.go)}
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

      {importPreview && (
        <ImportPreviewModal preview={importPreview}
          canRestoreSnapshot={canRestoreSnapshot}
          onConfirm={confirmImport}
          onCancel={() => setImportPreview(null)}/>
      )}
    </Page>
  );
};

// Modal showing the diff before import-wipe-restore. Counts only — per-record
// drill-down would be a future iteration.
const ImportPreviewModal = ({ preview, onConfirm, onCancel, canRestoreSnapshot }) => {
  const { snap, diff, fileName } = preview;
  const collEntries = useMemoOS(() => {
    return Object.entries(diff.collections)
      .filter(([, c]) => c.added || c.removed || c.modified || c.currentCount || c.incomingCount)
      .sort((a, b) => {
        const aChanges = a[1].added + a[1].removed + a[1].modified;
        const bChanges = b[1].added + b[1].removed + b[1].modified;
        return bChanges - aChanges;
      });
  }, [diff]);
  const totalAdded   = collEntries.reduce((n, [, c]) => n + c.added, 0);
  const totalRemoved = collEntries.reduce((n, [, c]) => n + c.removed, 0);
  const totalModified= collEntries.reduce((n, [, c]) => n + c.modified, 0);
  const validation = diff.validation || { warnings: [], totalRecords: null };

  return (
    <div onClick={onCancel} className="backdrop-in" style={{
      position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} className="scale-in" style={{
        background: '#fff', borderRadius: 8, width: 720, maxWidth: '90vw',
        maxHeight: '85vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Restore preview</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>
            {fileName} · version {snap.version}
            {!diff.versionMatch && <span style={{ color: 'var(--err-700)', marginLeft: 6 }}>(current is {diff.currentVersion} — version skew override required)</span>}
            {snap.exportedAt && <span> · exported {new Date(snap.exportedAt).toISOString().slice(0,16).replace('T',' ')}</span>}
          </div>
        </div>

        <div style={{ padding: '10px 16px', background: 'var(--ivory-50)', borderBottom: '1px solid var(--line)', display: 'flex', gap: 16 }}>
          <div><span className="section-title" style={{ fontSize: 9 }}>Added</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--ok-700)', fontWeight: 500 }}>+{totalAdded}</span></div>
          <div><span className="section-title" style={{ fontSize: 9 }}>Removed</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--err-700)', fontWeight: 500 }}>−{totalRemoved}</span></div>
          <div><span className="section-title" style={{ fontSize: 9 }}>Modified</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--warn-700)', fontWeight: 500 }}>~{totalModified}</span></div>
          {validation.totalRecords != null && (
            <div><span className="section-title" style={{ fontSize: 9 }}>Records</span> <span className="mono tnum" style={{ marginLeft: 6, color: 'var(--ink-500)', fontWeight: 500 }}>{validation.totalRecords}</span></div>
          )}
          {diff.unknownInSnapshot.length > 0 && (
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-500)' }}>
              <span className="pill" data-tone="amber">{diff.unknownInSnapshot.length}</span> unknown collection(s) will be skipped: {diff.unknownInSnapshot.join(', ')}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
          {validation.warnings && validation.warnings.length > 0 && (
            <div style={{ margin: '10px 8px', padding: '8px 10px', border: '1px solid var(--warn-200)', background: 'var(--warn-50)', borderRadius: 6, color: 'var(--warn-800)', fontSize: 11.5 }}>
              {validation.warnings.join('; ')}
            </div>
          )}
          {collEntries.length === 0 ? (
            <div className="empty" style={{ padding: 40 }}>
              <div className="empty-title">Snapshot matches current state</div>
              <div className="empty-sub">Nothing would change.</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th style={{ width: 80 }}>Current</th>
                  <th style={{ width: 80 }}>Incoming</th>
                  <th style={{ width: 70 }}>Added</th>
                  <th style={{ width: 70 }}>Removed</th>
                  <th style={{ width: 80 }}>Modified</th>
                  <th style={{ width: 80 }}>Unchanged</th>
                </tr>
              </thead>
              <tbody>
                {collEntries.map(([name, c]) => (
                  <tr key={name}>
                    <td><span className="mono">{name}</span></td>
                    <td className="mono tnum" style={{ color: 'var(--ink-500)' }}>{c.currentCount}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-500)' }}>{c.incomingCount}</td>
                    <td className="mono tnum" style={{ color: c.added ? 'var(--ok-700)' : 'var(--ink-300)' }}>{c.added ? '+' + c.added : '—'}</td>
                    <td className="mono tnum" style={{ color: c.removed ? 'var(--err-700)' : 'var(--ink-300)' }}>{c.removed ? '−' + c.removed : '—'}</td>
                    <td className="mono tnum" style={{ color: c.modified ? 'var(--warn-700)' : 'var(--ink-300)' }}>{c.modified ? '~' + c.modified : '—'}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-300)' }}>{c.unchanged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--err-700)' }}>This wipes the current database before restoring.</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" onClick={onCancel}>Cancel</button>
          <button className="btn" data-size="sm" data-variant="primary" onClick={onConfirm}
            disabled={!canRestoreSnapshot}
            title={permissionTitle(canRestoreSnapshot, 'Restore snapshot', 'restore or reset data')}>Restore now</button>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  DashboardPage, OrdersPage, SpecimensPage, ResultsPage, PatientsPage,
  WorklistsPage, InstrumentsPage, InterfacesPage, ReportsPage, AdminPage,
  TestCatalogPage, ClientsPage, LocationsPage, LabelsPage, MappersPage, QcPage,
  NotificationsPage,
  PageHeader, Page, EmptyTable,
  TatPill,
});
