// entity-drawer.jsx — Universal detail drawer for specimens, orders, patients.
//
// One drawer that any row can open: rows everywhere call window.openEntity(kind, id)
// and a slide-in panel mounts at the app root, reading the entity + related entities
// from the live store and assembling a timeline from audit_events filtered by id.
//
// Why one component instead of three: the LIS is a graph (Patient→Order→Specimen→Result),
// and the natural drill is the same in every view. A unified drawer means the system
// reads the same way regardless of where you came from.

const { useEffect: useEffectED, useState: useStateED, useMemo: useMemoED } = React;

const EntityDrawer = () => {
  const [target, setTarget] = useStateED(null);  // { kind, id }
  const [tab, setTab] = useStateED('overview');

  useEffectED(() => {
    window.openEntity = (kind, id) => { setTarget({ kind, id }); setTab('overview'); };
    window.closeEntity = () => setTarget(null);
    return () => { delete window.openEntity; delete window.closeEntity; };
  }, []);

  useEffectED(() => {
    if (!target) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setTarget(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);

  if (!target) return null;
  return (
    <>
      <div onClick={() => setTarget(null)} className="backdrop-in" style={{
        position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.16)',
        zIndex: 850,
      }}/>
      <div className="drawer-in" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 560,
        background: 'var(--ivory-50)', borderLeft: '1px solid var(--line-strong)',
        boxShadow: 'var(--shadow-pop)', zIndex: 851,
        display: 'flex', flexDirection: 'column',
      }}>
        <DrawerHeader target={target} onClose={() => setTarget(null)}/>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: '#fff' }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'timeline', label: 'Timeline' },
            { id: 'related',  label: 'Related' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '10px 16px', border: 0, background: 'transparent',
                fontSize: 12.5, fontWeight: tab === t.id ? 500 : 400,
                color: tab === t.id ? 'var(--ink-900)' : 'var(--ink-500)',
                borderBottom: tab === t.id ? '2px solid var(--sage-700)' : '2px solid transparent',
                cursor: 'pointer',
              }}>{t.label}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {tab === 'overview' && <DrawerOverview target={target}/>}
          {tab === 'timeline' && <DrawerTimeline target={target}/>}
          {tab === 'related'  && <DrawerRelated target={target} onOpen={(k, id) => setTarget({ kind: k, id })}/>}
        </div>
      </div>
    </>
  );
};

// ── Header — entity title + state pill + close button ──────────────────────

const DrawerHeader = ({ target, onClose }) => {
  const entity = window.useEntity(collectionFor(target.kind), target.id);
  return (
    <div style={{
      padding: '14px 20px', borderBottom: '1px solid var(--line)',
      display: 'flex', alignItems: 'flex-start', gap: 12, background: '#fff',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-400)', textTransform: 'uppercase', letterSpacing: 0.04, marginBottom: 4 }}>
          {entityKindLabel(target.kind)}
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>
          {entity ? primaryLabel(target.kind, entity) : '—'}
        </div>
        {entity && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 4, display: 'flex', gap: 12 }}>
            <span><span style={{ color: 'var(--ink-300)' }}>id</span> <span className="mono">{target.id.slice(-10)}</span></span>
            {target.kind === 'specimen' && entity.barcode && <span><span style={{ color: 'var(--ink-300)' }}>barcode</span> <span className="mono">{entity.barcode}</span></span>}
            {target.kind === 'order' && entity.orderNumber && <span><span style={{ color: 'var(--ink-300)' }}>order #</span> <span className="mono">{entity.orderNumber}</span></span>}
            {target.kind === 'patient' && entity.mrn && <span><span style={{ color: 'var(--ink-300)' }}>MRN</span> <span className="mono">{entity.mrn}</span></span>}
          </div>
        )}
      </div>
      <button className="btn" data-variant="ghost" data-size="xs" onClick={onClose}>
        Close <span className="kbd" style={{ marginLeft: 4 }}>esc</span>
      </button>
    </div>
  );
};

// ── Overview tab — kind-specific facts ─────────────────────────────────────

const DrawerOverview = ({ target }) => {
  const entity = window.useEntity(collectionFor(target.kind), target.id);
  if (!entity) return <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>Loading…</div>;

  if (target.kind === 'specimen')   return <SpecimenOverview specimen={entity}/>;
  if (target.kind === 'order')      return <OrderOverview order={entity}/>;
  if (target.kind === 'patient')    return <PatientOverview patient={entity}/>;
  if (target.kind === 'result')     return <ResultOverview result={entity}/>;
  if (target.kind === 'instrument') return <InstrumentOverview instrument={entity}/>;
  if (target.kind === 'client')     return <ClientOverview client={entity}/>;
  if (target.kind === 'location')   return <LocationOverview location={entity}/>;
  return <pre style={{ fontSize: 11, color: 'var(--ink-500)' }}>{JSON.stringify(entity, null, 2)}</pre>;
};

// Lightweight overviews for the ancillary entity kinds — they don't need the
// full FactGrid/DrawerLink chrome of clinical entities; a few key fields and
// a count of related work is enough for the use cases (audit trace,
// dashboard click-through, specimen routedTo navigation).

const InstrumentOverview = ({ instrument }) => {
  const recentSpecs = window.useEntities('specimens', s => s.routedTo === instrument.id);
  const recentResults = window.useEntities('results', r => r.instrumentId === instrument.id);
  return (
    <div>
      <FactGrid items={[
        { l: 'Name',     v: instrument.name || '—' },
        { l: 'Vendor',   v: instrument.vendor || '—' },
        { l: 'Model',    v: instrument.model || '—' },
        { l: 'Serial',   v: <span className="mono">{instrument.serial || '—'}</span> },
        { l: 'Status',   v: <span className="pill" data-tone={instrument.status === 'running' ? 'sage' : instrument.status === 'error' ? 'rust' : 'ghost'}>{instrument.status || '—'}</span> },
        { l: 'Tests',    v: (instrument.testIds || []).length + ' supported' },
      ]}/>
      <div style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Routed traffic</div>
        <div style={{ fontSize: 12, color: 'var(--ink-700)' }}>
          {recentSpecs.length} specimen{recentSpecs.length === 1 ? '' : 's'} currently routed ·{' '}
          {recentResults.length} result{recentResults.length === 1 ? '' : 's'} attributed
        </div>
      </div>
    </div>
  );
};

const ClientOverview = ({ client }) => {
  const orders = window.useEntities('orders', o => o.clientId === client.id);
  return (
    <div>
      <FactGrid items={[
        { l: 'Code',     v: <span className="mono">{client.code || '—'}</span> },
        { l: 'Name',     v: client.name || '—' },
        { l: 'Type',     v: (client.type || '—').toLowerCase().replace('_',' ') },
        { l: 'Contact',  v: client.contactName || '—' },
        { l: 'Phone',    v: <span className="mono">{client.phone || '—'}</span> },
        { l: 'Fax',      v: <span className="mono">{client.fax || '—'}</span> },
        { l: 'Delivery', v: client.deliveryChannel ? <><span className="pill" data-tone="info">{client.deliveryChannel}</span>{client.deliveryEndpoint ? <span className="mono" style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-500)' }}>{client.deliveryEndpoint}</span> : null}</> : '—' },
      ]}/>
      <div style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Orders ({orders.length})</div>
        <div style={{ fontSize: 12 }}>
          <a href="#" onClick={e => { e.preventDefault(); window.openOrdersFilteredByClient && window.openOrdersFilteredByClient(client.id); }}
            style={{ color: 'var(--sage-700)' }}>
            Open Orders filtered to this client →
          </a>
        </div>
      </div>
    </div>
  );
};

const LocationOverview = ({ location }) => {
  const orders = window.useEntities('orders', o => o.locationId === location.id);
  const parent = window.useEntity('locations', location.parentId);
  return (
    <div>
      <FactGrid items={[
        { l: 'Code',     v: <span className="mono">{location.code || '—'}</span> },
        { l: 'Name',     v: location.name || '—' },
        { l: 'Type',     v: (location.type || '—').toLowerCase().replace('_',' ') },
        { l: 'Parent',   v: parent ? <span><span className="mono">{parent.code}</span> · {parent.name}</span> : '—' },
        { l: 'Phone',    v: <span className="mono">{location.phone || '—'}</span> },
        { l: 'Hours',    v: location.hours || '—' },
        { l: 'Active',   v: location.active === false ? 'inactive' : 'active' },
      ]}/>
      {location.departments && location.departments.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="section-title" style={{ marginBottom: 6 }}>Departments</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {location.departments.map(d => <span key={d} className="pill" data-tone="ghost" style={{ fontSize: 10.5 }}>{d.toLowerCase().replace('_',' ')}</span>)}
          </div>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Orders ({orders.length})</div>
        <div style={{ fontSize: 12, color: 'var(--ink-500)' }}>
          {orders.length === 0 ? 'No orders yet pinned to this location.' : `${orders.length} order${orders.length === 1 ? '' : 's'} are processed at this location.`}
        </div>
      </div>
    </div>
  );
};

const SpecimenOverview = ({ specimen }) => {
  const order = window.useEntity('orders', specimen.orderId);
  const patient = window.useEntity('patients', specimen.patientId);
  const instrument = window.useEntity('instruments', specimen.routedTo);
  const cond = (window.schema && window.schema.SPECIMEN_CONDITIONS || []).find(c => c.id === specimen.condition);
  const results = window.useEntities('results', r => r.specimenId === specimen.id);

  // Routed-to display: prefer the instrument's friendly name when we can
  // resolve it; fall back to the raw id with a graceful "(unknown)" tag.
  const routedToDisplay = specimen.routedTo
    ? (
      <a href="#" onClick={e => {
          e.preventDefault();
          if (instrument && window.openEntity) window.openEntity('instrument', instrument.id);
          else if (window.__navTo) window.__navTo('instruments');
        }}
        style={{ color: 'var(--sage-700)' }}
        title={instrument ? `Open ${instrument.name}` : 'Open Instrument Manager'}>
        {instrument
          ? <><span style={{ fontWeight: 500 }}>{instrument.name}</span> <span className="mono" style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-400)' }}>{instrument.vendor || ''}</span></>
          : <span className="mono">{specimen.routedTo}</span>}
      </a>
    )
    : '—';

  return (
    <div>
      <FactGrid items={[
        { l: 'Accession',  v: <span className="mono">{specimen.accessionNumber || '—'}</span> },
        { l: 'Barcode',    v: <span className="mono">{specimen.barcode || '—'}</span> },
        { l: 'Type',       v: specimen.type || '—' },
        { l: 'Container',  v: specimen.container || '—' },
        { l: 'State',      v: <SpecStatePill state={specimen.state}/> },
        { l: 'Condition',  v: cond ? <span className="pill" data-tone={cond.tone}>{cond.label}</span> : '—' },
        { l: 'Routed to',  v: routedToDisplay },
        { l: 'Collected',  v: <span className="mono">{fmtTs(specimen.collectedAt)}</span> },
        { l: 'Received',   v: <span className="mono">{fmtTs(specimen.receivedAt)}</span> },
        { l: 'Reject reason', v: specimen.rejectReason || '—', skipIfBlank: !specimen.rejectReason },
      ]}/>
      <DrawerLink label="Patient" entity={patient} kind="patient"
        text={patient ? `${patient.mrn} · ${[patient.lastName, patient.firstName].filter(Boolean).join(', ')}` : '—'}/>
      <DrawerLink label="Order" entity={order} kind="order"
        text={order ? `${order.orderNumber} · ${order.testIds.length} test${order.testIds.length === 1 ? '' : 's'}` : '—'}/>
      {specimen.flags && specimen.flags.length > 0 && (
        <PillRow label="Flags" items={specimen.flags} tone="info"/>
      )}
      {specimen.notes && (
        <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }}>
          <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Notes</div>
          <div style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'pre-wrap' }}>{specimen.notes}</div>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        {/* Re-key on order id so the inner useEntities filter (which closes over
            `order`) remounts when the order becomes available. Without this, the
            filter is captured at first render with order=null and never re-fires. */}
        <ResultsForSpecimen key={order ? order.id : 'no-order'}
          specimen={specimen} order={order} results={results}/>
      </div>
    </div>
  );
};

// Combined results view + manual entry form for the specimen drawer.
// Shows existing results, plus a "Enter results manually" section for any
// tests on the order that don't have a result yet (chemistry off the bench,
// pathology, microbiology — anywhere the simulator/instrument doesn't apply).
const ResultsForSpecimen = ({ specimen, order, results }) => {
  const [entering, setEntering] = useStateED(false);
  const tests = window.useEntities('tests', t => order && order.testIds && order.testIds.includes(t.id));

  const resultedTestIds = useMemoED(() => new Set(results.map(r => r.testId)), [results]);
  const pendingTests = useMemoED(
    () => tests.filter(t => !resultedTestIds.has(t.id)),
    [tests, resultedTestIds]
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span className="section-title">Results ({results.length})</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
          {pendingTests.length > 0 ? `${pendingTests.length} test${pendingTests.length === 1 ? '' : 's'} pending` : 'all tests resulted'}
        </span>
        <div style={{ flex: 1 }}/>
        {pendingTests.length > 0 && !entering && (
          <button className="btn" data-size="xs" onClick={() => setEntering(true)}>
            Enter results manually
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No results yet.</div>
      ) : <ResultMiniTable results={results}/>}

      {entering && (
        <ManualResultEntry
          specimen={specimen}
          tests={pendingTests}
          onClose={() => setEntering(false)}
        />
      )}
    </div>
  );
};

// Resolve the demographic-aware reference range for a test, mirroring what
// the simulator does. Returns { low, high, units, source, matchedRange }
// where source ∈ 'matched' | 'default' | 'none' | 'fallback' (no resolver).
const __pickRange = (test, patient) => {
  if (window.referenceRanges && typeof window.referenceRanges.pick === 'function') {
    return window.referenceRanges.pick(test, { patient, asOf: Date.now() });
  }
  // No resolver loaded — fall back to test defaults so the form still works.
  return {
    low: test.refRangeLow, high: test.refRangeHigh,
    units: test.units || '', source: 'fallback', matchedRange: null,
  };
};

const ManualResultEntry = ({ specimen, tests, onClose }) => {
  const patient = window.useEntity('patients', specimen && specimen.patientId);

  // Resolve a fresh range per test once the patient is loaded. Recomputes when
  // patient or tests change. Snapshot fields land on the result record at save.
  const ranges = useMemoED(() => {
    const out = {};
    for (const t of tests) out[t.id] = __pickRange(t, patient);
    return out;
  }, [tests, patient]);

  const [draft, setDraft] = useStateED(() =>
    tests.reduce((acc, t) => ({
      ...acc,
      [t.id]: { value: '', units: t.units || '', flag: '', comments: '', verifyNow: false },
    }), {})
  );
  const [saving, setSaving] = useStateED(false);

  // Auto-flag based on the resolved demographic range. Numeric values get
  // L / H if outside; non-numeric strings stay flagless (handled by rules
  // downstream if they need to mark "POSITIVE" or similar as A/AA).
  const flagFor = (testId, raw) => {
    if (raw === '' || raw == null) return '';
    const v = Number(raw);
    if (isNaN(v)) return '';
    const r = ranges[testId];
    if (!r) return '';
    if (r.low  != null && v < Number(r.low))  return 'L';
    if (r.high != null && v > Number(r.high)) return 'H';
    return '';
  };

  const setVal = (testId, key, value) => {
    setDraft(d => {
      const next = { ...d, [testId]: { ...d[testId], [key]: value } };
      if (key === 'value') next[testId].flag = flagFor(testId, value);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const actor = window.currentUser ? window.currentUser.id : 'unknown';
      for (const test of tests) {
        const entry = draft[test.id];
        if (!entry || entry.value === '') continue;

        const value = isNaN(Number(entry.value)) ? entry.value : Number(entry.value);
        const range = ranges[test.id] || { low: test.refRangeLow, high: test.refRangeHigh, source: 'fallback', matchedRange: null };
        const verifyNow = !!entry.verifyNow;

        // Build the record. If the operator opted to verify on save we bake
        // status='final' + verifiedBy/At into the record itself rather than
        // round-tripping through lifecycle.transition — this is a CREATE so
        // there's no transition guard to satisfy, and we still publish the
        // verified event so the lifecycle watcher and any auto-release rules
        // see it.
        const baseInit = {
          specimenId: specimen.id, testId: test.id,
          value, units: entry.units || range.units || test.units || '',
          refRangeLow: range.low == null ? null : range.low,
          refRangeHigh: range.high == null ? null : range.high,
          refRangeSource: range.source || 'none',
          refRangeId: range.matchedRange ? range.matchedRange.id : null,
          flag: entry.flag || flagFor(test.id, entry.value),
          comments: entry.comments || '',
          enteredManually: true, enteredBy: actor,
        };
        const result = window.schema.newResult(verifyNow
          ? { ...baseInit, status: 'final', verifiedBy: actor, verifiedAt: Date.now() }
          : { ...baseInit, status: 'preliminary' }
        );

        await window.db.put('results', result);
        // RESULT_RECEIVED fires for both paths so rules (critical-flag, reflex,
        // delta-check) cascade exactly like a simulator-emitted result would.
        window.events.publish(window.EVENTS.RESULT_RECEIVED, {
          entityType: 'result', entityId: result.id, result, specimen, test,
          manual: true, actor,
        });
        if (verifyNow) {
          window.events.publish(window.EVENTS.RESULT_VERIFIED, {
            entityType: 'result', entityId: result.id, result, actor,
            via: 'manual-entry-verify-on-save',
          });
        }
      }
      onClose();
    } catch (e) {
      console.error('[manual-entry] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  if (tests.length === 0) {
    return (
      <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, color: 'var(--ink-500)' }}>
        All tests on this order already have a result.
      </div>
    );
  }

  const filledCount = Object.values(draft).filter(d => d && d.value !== '').length;
  const verifyNowCount = Object.values(draft).filter(d => d && d.value !== '' && d.verifyNow).length;

  // Per-row range display: prefer the demographically-resolved range over the
  // test's default. A small "matched"/"default" pill shows which one applied.
  const rangeDisplay = (testId) => {
    const r = ranges[testId];
    if (!r || r.low == null || r.high == null) return { text: '—', tone: null };
    return {
      text: `${r.low}–${r.high}`,
      tone: r.source === 'matched' ? 'sage' : r.source === 'default' ? 'ghost' : null,
    };
  };

  return (
    <div style={{ marginTop: 12, padding: 12, background: '#fff', border: '1px solid var(--line-strong)', borderRadius: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-900)', flex: 1 }}>Manual result entry</span>
        <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
          {filledCount} of {tests.length} filled{verifyNowCount > 0 ? ` · ${verifyNowCount} verify-on-save` : ''}
        </span>
        <button className="btn" data-variant="ghost" data-size="xs" onClick={onClose}>Cancel</button>
      </div>
      <table className="tbl" style={{ fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ width: 80 }}>Test</th>
            <th style={{ width: 110 }}>Value</th>
            <th style={{ width: 80 }}>Units</th>
            <th style={{ width: 110 }}>Ref range</th>
            <th style={{ width: 50 }}>Flag</th>
            <th>Comments</th>
            <th style={{ width: 80 }}>Verify</th>
          </tr>
        </thead>
        <tbody>
          {tests.map(t => {
            const entry = draft[t.id] || { value: '', units: '', flag: '', comments: '', verifyNow: false };
            const rd = rangeDisplay(t.id);
            return (
              <tr key={t.id}>
                <td><span className="mono">{t.code}</span></td>
                <td>
                  <input className="input mono" value={entry.value}
                    onChange={e => setVal(t.id, 'value', e.target.value)}
                    placeholder={t.name}
                    style={{ height: 26 }}/>
                </td>
                <td>
                  <input className="input mono" value={entry.units}
                    onChange={e => setVal(t.id, 'units', e.target.value)}
                    style={{ height: 26 }}/>
                </td>
                <td>
                  <span className="mono tnum" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{rd.text}</span>
                  {rd.tone && (
                    <span className="pill" data-tone={rd.tone} style={{ fontSize: 9.5, marginLeft: 6 }}>
                      {ranges[t.id].source}
                    </span>
                  )}
                </td>
                <td>
                  {entry.flag ? <ResultFlagInline flag={entry.flag}/> : <span style={{ color: 'var(--ink-300)' }}>—</span>}
                </td>
                <td>
                  <input className="input" value={entry.comments}
                    onChange={e => setVal(t.id, 'comments', e.target.value)}
                    placeholder="Optional"
                    style={{ height: 26, fontSize: 11.5 }}/>
                </td>
                <td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, color: 'var(--ink-700)' }}
                    title="Mark this result as final and stamp verified-by on save">
                    <input type="checkbox" checked={!!entry.verifyNow}
                      onChange={e => setVal(t.id, 'verifyNow', e.target.checked)}/>
                    on save
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 10.5, color: 'var(--ink-400)', flex: 1 }}>
          Range source: <span className="pill" data-tone="sage" style={{ fontSize: 9.5 }}>matched</span> = patient demographics matched a test-specific range. <span className="pill" data-tone="ghost" style={{ fontSize: 9.5 }}>default</span> = test's catalog-wide range. Unverified results stay <em>preliminary</em> until verified separately.
        </span>
        <button className="btn" data-size="sm" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn" data-variant="primary" data-size="sm" onClick={save} disabled={saving || filledCount === 0}>
          {saving ? 'Saving…' : `Save ${filledCount} result${filledCount === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
};

const ResultFlagInline = ({ flag }) => {
  const tone = ({ L: 'info', H: 'amber', LL: 'rust', HH: 'rust', A: 'amber', AA: 'rust' })[flag] || 'ghost';
  return <span className="pill" data-tone={tone}>{flag}</span>;
};

const OrderOverview = ({ order }) => {
  const patient = window.useEntity('patients', order.patientId);
  const client  = window.useEntity('clients', order.clientId);
  const location = window.useEntity('locations', order.locationId);
  const specs = window.useEntities('specimens', s => order && s.orderId === order.id);
  const tests = window.useEntities('tests', t => order && order.testIds && order.testIds.includes(t.id));
  // Display: prefer locationId → location.name; fall back to free-text facility.
  const facilityDisplay = location
    ? <span><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{location.code}</span> <span style={{ marginLeft: 6 }}>{location.name}</span></span>
    : (order.facility || '—');
  return (
    <div>
      {/* Outreach: client pinned at the top of the order overview. */}
      {client && (
        <div style={{
          marginBottom: 12, padding: 10,
          border: '1px solid var(--info)', borderRadius: 6,
          background: 'var(--info-soft)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: 0.06, marginBottom: 2 }}>Client</div>
            <div style={{ fontSize: 13, color: 'var(--ink-900)' }}>
              <span className="mono">{client.code}</span>
              <span style={{ marginLeft: 8, fontWeight: 500 }}>{client.name}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
              {(client.type || 'CLINIC').toLowerCase()}
              {client.deliveryChannel && <span style={{ marginLeft: 10 }}>· delivery: {client.deliveryChannel}</span>}
            </div>
          </div>
        </div>
      )}
      <FactGrid items={[
        { l: 'Order #',   v: <span className="mono">{order.orderNumber || '—'}</span> },
        { l: 'Status',    v: <OrderStatusPill s={order.status}/> },
        { l: 'Priority',  v: <PriorityTone p={order.priority}/> },
        { l: 'Facility',  v: facilityDisplay },
        { l: 'Provider',  v: order.providerId || '—' },
        { l: 'Ordered',   v: <span className="mono">{fmtTs(order.orderedAt)}</span> },
        { l: 'Diagnosis', v: order.diagnosisCodes && order.diagnosisCodes.length ? order.diagnosisCodes.join(', ') : '—' },
      ]}/>
      <DrawerLink label="Patient" entity={patient} kind="patient"
        text={patient ? `${patient.mrn} · ${[patient.lastName, patient.firstName].filter(Boolean).join(', ')}` : '—'}/>
      <OrderTatBlock order={order}/>
      <div style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Tests on this order ({tests.length})</div>
        {tests.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>—</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tests.map(t => (
              <span key={t.id} className="pill" data-tone="ghost"
                style={{ height: 22, padding: '0 8px' }}>
                <span className="mono">{t.code}</span>
                <span style={{ marginLeft: 6 }}>{t.shortName || t.name}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Specimens ({specs.length})</div>
        {specs.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No specimens yet for this order.</div>
        ) : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>Accession</th><th>Type</th><th>State</th><th>Received</th><th></th></tr></thead>
            <tbody>
              {specs.map(s => (
                <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => window.openEntity('specimen', s.id)}>
                  <td><span className="mono">{s.accessionNumber || '—'}</span></td>
                  <td>{s.type || '—'}</td>
                  <td><SpecStatePill state={s.state}/></td>
                  <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{fmtTs(s.receivedAt)}</span></td>
                  <td><span style={{ color: 'var(--ink-300)', fontSize: 14 }}>›</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// Inline TAT progress for the order drawer. Reads thresholds from the singleton
// `lab_config` row (or its defaults if the row hasn't been written yet) and
// uses `tatWatcher.classify` to keep the math in one place. Hidden for terminal
// orders — they no longer have a meaningful TAT clock.
const OrderTatBlock = ({ order }) => {
  const cfg = window.useEntity('lab_config', window.schema && window.schema.LAB_CONFIG_ID);
  const tests = window.useEntities('tests');
  const testById = useMemoED(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  if (!order) return null;
  if (order.status === 'completed' || order.status === 'cancelled') return null;
  if (!window.tatWatcher) return null;
  const { level, elapsedMin, rawElapsedMin, pausedMin, thresholdMin, thresholdSource, thresholdTestId, warnAtMin } = window.tatWatcher.classify(order, cfg, Date.now(), testById);
  if (thresholdMin == null) return null;

  const pct = Math.min(125, Math.max(0, (elapsedMin / thresholdMin) * 100));
  const tone = level === 'breach' ? 'rust' : level === 'warn' ? 'amber' : 'sage';
  const barColor = level === 'breach' ? 'var(--rust)' : level === 'warn' ? 'var(--amber)' : 'var(--sage-500)';
  const fmt = (m) => m == null ? '—' : (m < 60 ? Math.round(m) + 'm' : (m / 60).toFixed(1).replace(/\.0$/, '') + 'h');

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span className="section-title">Turnaround time</span>
        <span style={{ flex: 1 }}/>
        <span className="pill" data-tone={tone} style={{ fontSize: 10.5, height: 18 }}>
          {level === 'breach' ? 'Breached' : level === 'warn' ? 'At risk' : 'On time'}
        </span>
      </div>
      <div style={{
        position: 'relative', height: 8, borderRadius: 999,
        background: 'var(--ivory-200)', overflow: 'hidden', marginBottom: 6,
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: Math.min(100, pct) + '%',
          background: barColor,
          transition: 'width var(--dur-base) var(--ease-out)',
        }}/>
        {/* Warn-threshold tick mark */}
        {warnAtMin != null && (
          <div style={{
            position: 'absolute', top: -2, bottom: -2,
            left: ((warnAtMin / thresholdMin) * 100) + '%',
            width: 1, background: 'var(--ink-400)', opacity: 0.5,
          }} title="Warn threshold"/>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5 }}>
        <span className="mono tnum" style={{ color: 'var(--ink-700)', fontWeight: 500 }}>{fmt(elapsedMin)}</span>
        <span style={{ color: 'var(--ink-400)' }}>elapsed</span>
        <span style={{ flex: 1 }}/>
        <span className="mono tnum" style={{ color: level === 'breach' ? 'var(--err-700)' : 'var(--ink-500)' }}>
          {Math.round(pct)}%
        </span>
        <span style={{ color: 'var(--ink-400)' }}>of {fmt(thresholdMin)} target</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 10.5, color: 'var(--ink-400)' }}>
        <span>{thresholdSource === 'test' ? 'Test target' : 'Priority target'}</span>
        {thresholdSource === 'test' && thresholdTestId && testById[thresholdTestId] && (
          <span className="mono">{testById[thresholdTestId].code}</span>
        )}
        {(pausedMin || order.tatPauseStartedAt) ? (
          <>
            <span>·</span>
            <span className="mono tnum">{fmt(pausedMin || 0)}</span>
            <span>paused of {fmt(rawElapsedMin || elapsedMin)} raw</span>
          </>
        ) : null}
      </div>
    </div>
  );
};

const PatientOverview = ({ patient }) => {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(null);
  const startEdit = () => { setDraft({ phone: patient.phone || '', email: patient.email || '', preferredContact: patient.preferredContact || '' }); setEditing(true); };
  const cancel = () => { setDraft(null); setEditing(false); };
  const save = async () => {
    await window.db.put('patients', { ...patient, ...draft });
    cancel();
  };
  return (
    <div>
      <FactGrid items={[
        { l: 'MRN',       v: <span className="mono">{patient.mrn || '—'}</span> },
        { l: 'Name',      v: [patient.lastName, patient.firstName].filter(Boolean).join(', ') || '—' },
        { l: 'DOB',       v: <span className="mono">{patient.dob || '—'}</span> },
        { l: 'Sex',       v: patient.sex || '—' },
      ]}/>
      <div style={{ marginTop: 12, padding: 12, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <span className="section-title" style={{ fontSize: 9.5 }}>Contact</span>
          <span style={{ flex: 1 }}/>
          {!editing && <button className="btn" data-size="xs" onClick={startEdit}>Edit</button>}
          {editing && <button className="btn" data-size="xs" data-variant="ghost" onClick={cancel}>Cancel</button>}
          {editing && <button className="btn" data-size="xs" data-variant="primary" onClick={save} style={{ marginLeft: 4 }}>Save</button>}
        </div>
        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div className="section-title" style={{ fontSize: 9, marginBottom: 3 }}>Phone</div>
              <input className="input mono" value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="555-555-5555"/>
            </div>
            <div>
              <div className="section-title" style={{ fontSize: 9, marginBottom: 3 }}>Email</div>
              <input className="input" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="patient@example.com"/>
            </div>
            <div style={{ gridColumn: '1 / 3' }}>
              <div className="section-title" style={{ fontSize: 9, marginBottom: 3 }}>Preferred contact</div>
              <select className="input" value={draft.preferredContact} onChange={e => setDraft({ ...draft, preferredContact: e.target.value })}>
                <option value="">— inherit / no preference —</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="mail">Mail</option>
                <option value="portal">Patient portal</option>
              </select>
            </div>
          </div>
        ) : (
          <FactGrid items={[
            { l: 'Phone',     v: <span className="mono">{patient.phone || '—'}</span> },
            { l: 'Email',     v: <span className="mono">{patient.email || '—'}</span> },
            { l: 'Preferred', v: patient.preferredContact ? <span className="pill" data-tone="info">{patient.preferredContact}</span> : <span style={{ color: 'var(--ink-400)' }}>—</span> },
          ]}/>
        )}
      </div>
      <button className="btn" data-variant="primary" data-size="sm" style={{ marginTop: 12 }}
        onClick={() => { window.closeEntity(); window.__navTo && window.__navTo('patients'); }}>
        Open in Patient Search
      </button>
    </div>
  );
};

const ResultOverview = ({ result }) => {
  const specimen = window.useEntity('specimens', result.specimenId);
  const test = window.useEntity('tests', result.testId);
  // Walk backward through correctionOf to assemble the chain. We show the
  // chain inline so the audit trail is visible from the drawer; releases of
  // older versions remain inspectable. The newest record is the one being
  // displayed in the FactGrid above.
  const chain = window.useEntities('results',
    r => r.specimenId === result.specimenId && r.testId === result.testId);
  const sortedChain = useMemoED(() => {
    return [...chain].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [chain]);
  const isCorrection = !!result.correctionOf;
  const wasSuperseded = !!result.supersededByResultId;

  // The "Correct this result" button opens a global modal via window.openCorrection
  // — the modal lives at the page level so it works whether you got here from
  // the Results page or via Activity Log click-through.
  const openCorrect = () => {
    if (window.openCorrectionFor) window.openCorrectionFor(result.id);
    else window.alert('Correction UI not available on this page.');
  };

  // Eligibility: a result can be corrected when it's already been verified
  // (status final or corrected). Pending/preliminary results should be edited
  // via the manual-entry path, not through corrections.
  const correctable = (result.status === 'final' || result.status === 'corrected') && !wasSuperseded;

  return (
    <div>
      {wasSuperseded && (
        <div style={{
          marginBottom: 10, padding: 10,
          background: 'var(--amber-soft)', border: '1px solid var(--line-strong)', borderRadius: 4,
          fontSize: 12, color: 'var(--warn-700)',
        }}>
          <strong>Superseded.</strong> This result has been corrected. The newer version is part of the displayed record.
        </div>
      )}
      {isCorrection && (
        <div style={{
          marginBottom: 10, padding: 10,
          background: 'var(--info-soft)', border: '1px solid var(--line-strong)', borderRadius: 4,
          fontSize: 12, color: 'var(--info)',
        }}>
          <strong>Corrected record.</strong> This supersedes a prior result for the same test on this specimen.
          {result.correctionReason && <span style={{ marginLeft: 6, color: 'var(--ink-700)' }}>Reason: {result.correctionReason}</span>}
        </div>
      )}
      <FactGrid items={[
        { l: 'Test',     v: test ? <><span className="mono">{test.code}</span> <span style={{ marginLeft: 4 }}>{test.name}</span></> : '—' },
        { l: 'Value',    v: <span className="mono tnum" style={{ fontWeight: 500 }}>{result.value != null ? result.value : '—'} {result.units || ''}</span> },
        { l: 'Ref range', v: result.refRangeLow != null ? `${result.refRangeLow}–${result.refRangeHigh}` : '—' },
        { l: 'Flag',     v: result.flag || '—' },
        { l: 'Status',   v: result.status },
        { l: 'Verified', v: result.verifiedAt ? `${fmtTs(result.verifiedAt)} by ${result.verifiedBy || '—'}` : 'pending' },
        { l: 'Released', v: result.releasedAt ? `${fmtTs(result.releasedAt)} by ${result.releasedBy || '—'}` : 'not released', skipIfBlank: !result.releasedAt && !result.verifiedAt },
        { l: 'Corrected', v: result.correctedAt ? `${fmtTs(result.correctedAt)} by ${result.correctedBy || '—'}` : null, skipIfBlank: !result.correctedAt },
      ]}/>
      <DrawerLink label="Specimen" entity={specimen} kind="specimen"
        text={specimen ? specimen.accessionNumber : '—'}/>
      {result.comments && (
        <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }}>
          <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Comments</div>
          <div style={{ fontSize: 12, color: 'var(--ink-700)', whiteSpace: 'pre-wrap' }}>{result.comments}</div>
        </div>
      )}

      {/* Correction history. Shown when chain length > 1. The chain is built
          by collecting all results for the same (specimen, test) pair and
          sorting chronologically — the linked-list traversal via correctionOf
          gives the same ordering but listing all rows is robust against
          partially-malformed chains (e.g. a missing supersededByResultId
          stamp from an older code path). */}
      {sortedChain.length > 1 && (
        <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }}>
          <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>
            Correction history ({sortedChain.length} versions)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sortedChain.map((r, i) => {
              const isCurrent = r.id === result.id;
              const prior = i > 0 ? sortedChain[i - 1] : null;
              const valueChanged = prior && String(r.value) !== String(prior.value);
              return (
                <div key={r.id} onClick={() => !isCurrent && window.openEntity && window.openEntity('result', r.id)}
                  style={{
                    padding: 8, borderRadius: 4,
                    background: isCurrent ? 'var(--sage-50)' : 'var(--ivory-50)',
                    border: isCurrent ? '1px solid var(--sage-500)' : '1px solid var(--line-soft)',
                    cursor: isCurrent ? 'default' : 'pointer',
                    fontSize: 11.5,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="pill" data-tone={isCurrent ? 'sage' : (r.status === 'corrected' ? 'info' : 'ghost')} style={{ fontSize: 10 }}>
                      {i === 0 ? 'original' : 'v' + (i + 1)}
                    </span>
                    <span className="mono tnum" style={{ fontWeight: 500, color: 'var(--ink-900)' }}>
                      {r.value != null ? r.value : '—'} {r.units || ''}
                    </span>
                    {valueChanged && prior && (
                      <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                        (was <span className="mono tnum">{prior.value}</span>)
                      </span>
                    )}
                    <span className="pill" data-tone={r.flag ? (RESULT_FLAG_TONE_INLINE[r.flag] || 'ghost') : 'ghost'} style={{ fontSize: 9.5, marginLeft: 'auto' }}>
                      {r.flag || '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-500)', marginTop: 3 }}>
                    {fmtTs(r.correctedAt || r.verifiedAt || r.createdAt)}
                    {' · '}
                    {r.correctedBy || r.verifiedBy || 'system'}
                    {r.correctionReason && <span> · <em>"{r.correctionReason}"</em></span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {correctable && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" data-size="sm" data-variant="primary" onClick={openCorrect}>
            <IconCorrect/> Correct this result
          </button>
        </div>
      )}

      {(result.deliveryStatus || result.lastHl7Message) && (
        <DeliverySection result={result}/>
      )}
    </div>
  );
};

// Tone map shared with the result-history strip. Mirrors RESULT_FLAG_TONE
// from the shared page helpers but kept local so this file doesn't need to import.
const RESULT_FLAG_TONE_INLINE = { L: 'info', H: 'amber', LL: 'rust', HH: 'rust', A: 'amber', AA: 'rust' };

// Tiny inline icon — pencil-on-line. Custom 1.25px geometric per the design system.
const IconCorrect = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2.5l2.5 2.5L6 12.5H3.5V10L11 2.5z"/>
    <path d="M9.5 4l2.5 2.5"/>
  </svg>
);

const DeliverySection = ({ result }) => {
  const tone = ({ delivered: 'sage', pending: 'amber', failed: 'rust', manual: 'ghost' })[result.deliveryStatus] || 'ghost';
  return (
    <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="section-title" style={{ fontSize: 9.5 }}>Delivery</span>
        <span className="pill" data-tone={tone}>{result.deliveryStatus || 'unknown'}</span>
        {result.deliveredVia && <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>via {result.deliveredVia}{result.deliveredTo ? ' → ' + result.deliveredTo : ''}</span>}
      </div>
      {(result.deliveryAttempts || []).length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 6 }}>
          {result.deliveryAttempts.length} attempt{result.deliveryAttempts.length === 1 ? '' : 's'} ·
          {' '}last {fmtTs(result.deliveryAttempts[result.deliveryAttempts.length - 1].at)}
        </div>
      )}
      {result.lastHl7Message && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--ink-700)' }}>HL7 ORU-R01 payload</summary>
          <pre style={{
            margin: '6px 0 0 0', padding: 8,
            background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 3,
            fontSize: 10.5, lineHeight: 1.5, color: 'var(--ink-700)',
            whiteSpace: 'pre', overflowX: 'auto',
            fontFamily: 'var(--font-mono)',
          }}>{result.lastHl7Message}</pre>
        </details>
      )}
    </div>
  );
};

// ── Timeline tab — audit events filtered by entityId ───────────────────────

const DrawerTimeline = ({ target }) => {
  const events = window.useEntities('audit_events', e => e.entityId === target.id);
  const sorted = useMemoED(() => [...events].sort((a, b) => (b.ts || 0) - (a.ts || 0)), [events]);
  if (sorted.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No events recorded for this entity yet.</div>;
  }
  return (
    <div>
      {sorted.map((ev, i) => (
        <div key={ev.id} style={{
          display: 'grid', gridTemplateColumns: '90px 1fr',
          gap: 10, padding: '8px 0',
          borderBottom: i < sorted.length - 1 ? '1px solid var(--line-soft)' : 'none',
        }}>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>{fmtTs(ev.ts)}</span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--ink-900)' }}>{ev.type}</span>
              {/* Actor + frozen role pill — actor resolves through displayName so a
                  user id renders as their name; system/auto/rules pass through. */}
              {ev.actor && ev.actor !== 'system' && (
                <span style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>
                  · {window.currentUserApi ? window.currentUserApi.displayName(ev.actor) : ev.actor}
                </span>
              )}
              {Array.isArray(ev.actorRoles) && ev.actorRoles.length > 0 && (() => {
                const primary = ev.actorRoles[0];
                const meta = (window.schema && window.schema.ROLE_BY_ID && window.schema.ROLE_BY_ID[primary])
                  || { tone: 'ghost', label: primary };
                return (
                  <span className="pill" data-tone={meta.tone} style={{ fontSize: 9.5 }}
                    title={ev.actorRoles.length > 1 ? `+${ev.actorRoles.length - 1} more: ${ev.actorRoles.slice(1).join(', ')}` : meta.description}>
                    {meta.label}
                  </span>
                );
              })()}
            </div>
            {ev.payload && ev.payload.message && (
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>{ev.payload.message}</div>
            )}
            {ev.payload && ev.payload.ruleName && (
              <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>
                Rule "{ev.payload.ruleName}" → {(ev.payload.actionResults || []).length} action{(ev.payload.actionResults || []).length === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ── Related tab — neighboring entities in the graph ────────────────────────

const DrawerRelated = ({ target, onOpen }) => {
  const entity = window.useEntity(collectionFor(target.kind), target.id);
  if (!entity) return <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>Loading…</div>;
  const links = relatedLinks(target.kind, entity);
  return (
    <div>
      {links.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No related entities.</div>
      ) : links.map(l => (
        <RelatedItem key={l.kind + ':' + l.id} {...l} onOpen={onOpen}/>
      ))}
    </div>
  );
};

const RelatedItem = ({ kind, id, onOpen }) => {
  const entity = window.useEntity(collectionFor(kind), id);
  if (!entity) return null;
  return (
    <button onClick={() => onOpen(kind, id)}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '10px 12px', marginBottom: 6,
        background: '#fff', border: '1px solid var(--line)', borderRadius: 5,
        cursor: 'pointer',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--line-strong)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
      <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>{entityKindLabel(kind)}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-900)' }}>{primaryLabel(kind, entity)}</div>
    </button>
  );
};

const relatedLinks = (kind, entity) => {
  if (kind === 'specimen') {
    const out = [];
    if (entity.orderId) out.push({ kind: 'order', id: entity.orderId });
    if (entity.patientId) out.push({ kind: 'patient', id: entity.patientId });
    return out;
  }
  if (kind === 'order') {
    return entity.patientId ? [{ kind: 'patient', id: entity.patientId }] : [];
  }
  if (kind === 'result') {
    const out = [];
    if (entity.specimenId) out.push({ kind: 'specimen', id: entity.specimenId });
    return out;
  }
  return [];
};

// ── Small helpers / atoms ──────────────────────────────────────────────────

const FactGrid = ({ items }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, columnGap: 14, fontSize: 12 }}>
    {items.filter(i => !i.skipIfBlank).map(i => (
      <React.Fragment key={i.l}>
        <span style={{ color: 'var(--ink-400)' }}>{i.l}</span>
        <span style={{ color: 'var(--ink-900)' }}>{i.v}</span>
      </React.Fragment>
    ))}
  </div>
);

const PillRow = ({ label, items, tone }) => (
  <div style={{ marginTop: 12 }}>
    <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>{label}</div>
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {items.map(i => <span key={i} className="pill" data-tone={tone || 'ghost'} style={{ height: 20, padding: '0 8px' }}>{i}</span>)}
    </div>
  </div>
);

const DrawerLink = ({ label, entity, kind, text }) => (
  <div style={{ marginTop: 12, padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }}>
    <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>{label}</div>
    {entity ? (
      <button onClick={() => window.openEntity(kind, entity.id)}
        style={{
          background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
          fontSize: 12.5, color: 'var(--sage-700)', textDecoration: 'underline',
          fontFamily: 'inherit',
        }}>
        {text}
      </button>
    ) : <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>{text}</div>}
  </div>
);

const ResultMiniTable = ({ results }) => (
  <table className="tbl" style={{ fontSize: 11.5 }}>
    <thead><tr><th>Test</th><th>Value</th><th>Flag</th><th>Status</th></tr></thead>
    <tbody>
      {results.map(r => (
        <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => window.openEntity && window.openEntity('result', r.id)}>
          <td><MiniTestCode testId={r.testId}/></td>
          <td className="mono tnum" style={{ fontWeight: 500 }}>{r.value} {r.units}</td>
          <td>{r.flag || '—'}</td>
          <td>{r.status}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const MiniTestCode = ({ testId }) => {
  const t = window.useEntity('tests', testId);
  return <span className="mono">{t ? t.code : '—'}</span>;
};

const SpecStatePill = ({ state }) => {
  const tone = ({ pending: 'ghost', in_transit: 'amber', received: 'sage', in_analysis: 'info', completed: 'slate', rejected: 'rust' })[state] || 'ghost';
  const label = ({ pending: 'Pending', in_transit: 'In transit', received: 'Received', in_analysis: 'In analysis', completed: 'Completed', rejected: 'Rejected' })[state] || state;
  return <span className="pill" data-tone={tone}>{label}</span>;
};
const OrderStatusPill = ({ s }) => {
  const tone = ({ open: 'sage', in_progress: 'info', completed: 'slate', cancelled: 'ghost' })[s] || 'ghost';
  const label = ({ open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })[s] || s;
  return <span className="pill" data-tone={tone}>{label}</span>;
};
const PriorityTone = ({ p }) => {
  const tone = ({ stat: 'rust', asap: 'amber', routine: 'ghost' })[p] || 'ghost';
  const label = p === 'stat' ? 'STAT' : p === 'asap' ? 'ASAP' : 'Routine';
  return <span className="pill" data-tone={tone}>{label}</span>;
};

const fmtTs = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sameDay = d.getTime() >= today.getTime();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

const collectionFor = (kind) => ({
  specimen: 'specimens', order: 'orders', patient: 'patients', result: 'results',
  instrument: 'instruments', client: 'clients', location: 'locations',
})[kind];
const entityKindLabel = (kind) => ({
  specimen: 'Specimen', order: 'Order', patient: 'Patient', result: 'Result',
  instrument: 'Instrument', client: 'Client', location: 'Location',
})[kind] || kind;
const primaryLabel = (kind, e) => {
  if (kind === 'specimen') return e.accessionNumber || e.barcode || e.id.slice(-8);
  if (kind === 'order')    return e.orderNumber || e.id.slice(-8);
  if (kind === 'patient')  return [e.lastName, e.firstName].filter(Boolean).join(', ') || e.mrn || e.id.slice(-8);
  if (kind === 'result')   return 'Result ' + e.id.slice(-8);
  if (kind === 'instrument') return e.name || e.serial || e.id.slice(-8);
  if (kind === 'client')     return e.name || e.code || e.id.slice(-8);
  if (kind === 'location')   return e.name || e.code || e.id.slice(-8);
  return e.id;
};

Object.assign(window, { EntityDrawer });
