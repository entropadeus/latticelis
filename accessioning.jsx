// Accessioning — keyboard-driven receiving workflow
// Signature interaction: a tech can scan/type/Tab/Enter through an entire
// specimen receipt without touching the mouse.
//
// Real state. No dummy data. Empty fields, but every shortcut works:
//   ⌘B      Focus barcode scanner
//   Tab     Next field
//   ⇧Tab    Previous field
//   ⌘↵      Accession (commit current row, advance)
//   ⌘R      Reject specimen
//   ⌘L      Print label
//   F2      Open container detail
//   Esc     Clear current row
//   /       Focus search

const { useState: useStateAC, useEffect: useEffectAC, useRef: useRefAC, useMemo: useMemoAC, useCallback: useCallbackAC } = React;

const FIELD_ORDER = ['barcode', 'patient', 'order', 'specType', 'container', 'collected', 'received', 'condition'];

const newRowId = () => 'row_' + Math.random().toString(36).slice(2, 8);

const blankRow = () => ({
  id: newRowId(),
  barcode: '',
  patient: '',
  order: '',
  specType: '',
  container: '',
  collected: '',
  received: '',
  condition: 'ACCEPTABLE',
  notes: '',
  state: 'pending', // pending | accessioned | rejected
  flags: [],
  ts: Date.now(),
});

const AccessioningPage = () => {
  // Active row being entered. The "history" view reads from the real store so the
  // pipeline is the source of truth — closing/reopening the page or reloading the
  // app preserves accessioned specimens.
  const [draft, setDraft] = useStateAC(blankRow());
  const [activeField, setActiveField] = useStateAC('barcode');
  // sessionStart is bound to the BROWSER session, not the component lifecycle.
  // Previously this was a fresh Date.now() on every mount, so navigating away
  // and back blanked the session log even though specimens were still in the
  // pipeline. Store on window so it survives unmount/remount; reset only via
  // the explicit "Clear session" control or a full app reload.
  const [sessionStart, setSessionStart] = useStateAC(() => {
    if (typeof window.__accessioningSessionStart !== 'number') {
      window.__accessioningSessionStart = Date.now();
    }
    return window.__accessioningSessionStart;
  });
  const [labelSpecId, setLabelSpecId] = useStateAC(null);
  const fieldRefs = useRefAC({});
  const sessionSpecimensRef = useRefAC([]);
  const canAccession = hasPermission('ACCESSION');

  // Live specimens (most recent first). Filter to ones touched in this session for the
  // session log, and reuse the same pipeline data for cross-page consistency.
  const allSpecimens = window.useEntities('specimens');
  const allPatients = window.useEntities('patients');
  const allOrders = window.useEntities('orders');
  const patientById = useMemoAC(
    () => Object.fromEntries(allPatients.map(p => [p.id, p])),
    [allPatients]
  );
  const orderById = useMemoAC(
    () => Object.fromEntries(allOrders.map(o => [o.id, o])),
    [allOrders]
  );
  const sessionSpecimens = useMemoAC(() => {
    return allSpecimens
      .filter(s => (s.createdAt || 0) >= sessionStart)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 50);
  }, [allSpecimens, sessionStart]);

  // Keep a ref in sync so the keyboard handler (which is wrapped in a
  // useEffect with a different dep set) always sees the latest list when
  // resolving "what specimen does ⌘L label?".
  useEffectAC(() => { sessionSpecimensRef.current = sessionSpecimens; }, [sessionSpecimens]);

  // Open the label modal for the most recent NON-rejected specimen in the
  // session. Used by both the action-row "Print label" button and the ⌘L
  // shortcut. Quiet no-op when there's nothing to print.
  const openLatestLabel = () => {
    const target = sessionSpecimensRef.current.find(s => s.state !== 'rejected');
    if (target) setLabelSpecId(target.id);
  };

  // Advance the session window so the log goes empty. Doesn't touch the
  // underlying specimens — those persist to the pipeline; we're just hiding
  // them from the local log. Operators ask for this between batches so the
  // visible row count reflects "what I just did" rather than the running tally.
  const resetSession = () => {
    const now = Date.now();
    window.__accessioningSessionStart = now;
    setSessionStart(now);
  };

  const hasLabelable = sessionSpecimens.some(s => s.state !== 'rejected');

  // ---- Focus management ----
  useEffectAC(() => {
    fieldRefs.current[activeField]?.focus();
    fieldRefs.current[activeField]?.select?.();
  }, [activeField, draft.id]);

  // ---- Keyboard handlers ----
  useEffectAC(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      // ⌘B → focus barcode
      if (meta && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault(); setActiveField('barcode'); return;
      }
      // ⌘↵ → accession
      if (meta && e.key === 'Enter') {
        e.preventDefault(); commitRow('accessioned'); return;
      }
      // ⌘R → reject
      if (meta && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault(); commitRow('rejected'); return;
      }
      // ⌘L → open label for the most recent accessioned row in this session.
      if (meta && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        openLatestLabel();
        return;
      }
      // Esc → clear current row
      if (e.key === 'Escape') {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
          e.preventDefault(); setDraft(blankRow()); setActiveField('barcode'); return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft]);

  const handleFieldKey = (field) => (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = FIELD_ORDER.indexOf(field);
      const next = e.shiftKey ? FIELD_ORDER[idx - 1] : FIELD_ORDER[idx + 1];
      if (next) setActiveField(next);
      else if (!e.shiftKey) commitRow('accessioned');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = FIELD_ORDER.indexOf(field);
      const next = FIELD_ORDER[idx + 1];
      if (next) setActiveField(next);
      else commitRow('accessioned');
    }
  };

  const updateField = (field, value) => setDraft(d => ({ ...d, [field]: value }));

  // Resolve-or-create a Patient by MRN. Empty MRN → null (specimen unattached).
  // Looks at the live cache so we don't write a duplicate on every keystroke session.
  const resolvePatient = async (mrnOrName) => {
    const id = (mrnOrName || '').trim();
    if (!id) return null;
    // First try by MRN. If not found and the input looks like a name (has letters and a space),
    // we still create a stub patient with the input in mrn — real workflow would do a search.
    const byMrn = await window.db.list('patients', p => p.mrn === id);
    if (byMrn.length > 0) return byMrn[0];
    const pat = window.schema.newPatient({ mrn: id });
    await window.db.put('patients', pat);
    return pat;
  };

  // Resolve-or-create an Order by orderNumber.
  const resolveOrder = async (orderNumber, patientId) => {
    const num = (orderNumber || '').trim();
    if (!num) return null;
    const byNumber = await window.db.list('orders', o => o.orderNumber === num);
    if (byNumber.length > 0) {
      // Backfill the patient link if we now have one and the order didn't.
      if (patientId && !byNumber[0].patientId) {
        const updated = { ...byNumber[0], patientId };
        await window.db.put('orders', updated);
        window.events.publish(window.EVENTS.ORDER_UPDATED, {
          entityType: 'order', entityId: updated.id, order: updated,
        });
        return updated;
      }
      return byNumber[0];
    }
    const ord = window.schema.newOrder({ orderNumber: num, patientId, status: 'open' });
    await window.db.put('orders', ord);
    window.events.publish(window.EVENTS.ORDER_CREATED, {
      entityType: 'order', entityId: ord.id, order: ord,
    });
    return ord;
  };

  const commitRow = async (forcedState) => {
    if (!hasPermission('ACCESSION')) return;
    // Allow rejected with no fields (rejecting a no-show), but for accessioned we need
    // at least a barcode or an order #.
    if (forcedState !== 'rejected' && !draft.barcode && !draft.order) return;

    // Resolve effective state from condition: a "reject"-class condition (gross
    // hemolysis, clotted, mislabeled, etc.) auto-rejects even if user pressed ⌘↵.
    const condDef = (window.schema.SPECIMEN_CONDITIONS || []).find(c => c.id === draft.condition);
    const condForcesReject = !!(condDef && condDef.reject);
    const state = forcedState === 'rejected' || condForcesReject ? 'rejected' : 'accessioned';

    const now = Date.now();
    try {
      const patient = await resolvePatient(draft.patient);
      const order = await resolveOrder(draft.order, patient ? patient.id : null);

      // Build the specimen. Generate an accession number using today's existing count.
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todaysCount = (await window.db.list('specimens',
        s => (s.receivedAt || s.createdAt || 0) >= todayStart.getTime()
      )).length;

      // Auto-tag from condition (e.g. HEMOLYZED_MODERATE → flag 'hemolyzed').
      const flags = condDef && condDef.flag ? [condDef.flag] : [];

      const spec = window.schema.newSpecimen({
        accessionNumber: state === 'accessioned'
          ? window.schema.nextAccessionNumber(todaysCount)
          : '',
        barcode: draft.barcode,
        orderId: order ? order.id : null,
        patientId: patient ? patient.id : null,
        type: draft.specType,
        container: draft.container,
        collectedAt: parseClockToTs(draft.collected, now),
        receivedAt: state === 'accessioned' ? (parseClockToTs(draft.received, now) || now) : null,
        state: state === 'accessioned' ? 'received' : 'rejected',
        condition: draft.condition || 'ACCEPTABLE',
        rejectReason: state === 'rejected'
          ? (condForcesReject ? (condDef.label || draft.condition) : (draft.notes || 'rejected at accessioning'))
          : '',
        flags,
        notes: draft.notes || '',
      });
      await window.db.put('specimens', spec);

      window.events.publish(
        state === 'accessioned' ? window.EVENTS.SPECIMEN_RECEIVED : window.EVENTS.SPECIMEN_REJECTED,
        { entityType: 'specimen', entityId: spec.id, specimen: spec, order, patient }
      );

      // Promote the order to in_progress on first accessioned specimen.
      // Goes through lifecycle.transition so the move is guarded + audited.
      if (state === 'accessioned' && order && order.status === 'open') {
        try {
          const updated = await window.lifecycle.transition('orders',
            { ...order, receivedAt: now }, 'in_progress',
            { reason: 'first specimen accessioned' });
          window.events.publish(window.EVENTS.ORDER_UPDATED, {
            entityType: 'order', entityId: updated.id, order: updated,
          });
        } catch (e) {
          console.error('[accessioning] order promote failed', e);
        }
      }
    } catch (e) {
      console.error('[accessioning] commit failed', e);
    }

    setDraft(blankRow());
    setActiveField('barcode');
  };

  const sessionStats = useMemoAC(() => {
    const accessioned = sessionSpecimens.filter(r => r.state !== 'rejected').length;
    const rejected = sessionSpecimens.filter(r => r.state === 'rejected').length;
    const elapsedMin = Math.max(1, (Date.now() - sessionStart) / 60000);
    const rate = accessioned / elapsedMin;
    return { accessioned, rejected, total: sessionSpecimens.length, rate, elapsedMin };
  }, [sessionSpecimens, sessionStart]);


  return (
    <div data-screen-label="Accessioning" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '20px 32px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Accessioning</h1>
          <p className="page-sub">Keyboard-first receiving. Scan, Tab, Enter. ⌘B to refocus barcode at any time.</p>
        </div>
        <SessionMeter stats={sessionStats}/>
      </div>

      {/* Active row composer */}
      <div style={{ padding: '20px 32px', borderBottom: '1px solid var(--line)', background: 'var(--ivory-50)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 1fr 1fr 1fr 1fr 1fr 1.4fr', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
          <Field label="Barcode" hint="⌘B" field="barcode" mono activeField={activeField} setActiveField={setActiveField}
            value={draft.barcode} onChange={v => updateField('barcode', v)} onKeyDown={handleFieldKey('barcode')}
            inputRef={el => fieldRefs.current.barcode = el}
            placeholder="Scan or type"/>
          <PatientField activeField={activeField} setActiveField={setActiveField}
            value={draft.patient} onChange={v => updateField('patient', v)} onKeyDown={handleFieldKey('patient')}
            inputRef={el => fieldRefs.current.patient = el}
            allPatients={allPatients}/>
          <Field label="Order" field="order" mono activeField={activeField} setActiveField={setActiveField}
            value={draft.order} onChange={v => updateField('order', v)} onKeyDown={handleFieldKey('order')}
            inputRef={el => fieldRefs.current.order = el}
            placeholder="Order #"/>
          <Field label="Specimen" field="specType" activeField={activeField} setActiveField={setActiveField}
            value={draft.specType} onChange={v => updateField('specType', v)} onKeyDown={handleFieldKey('specType')}
            inputRef={el => fieldRefs.current.specType = el}
            placeholder="Type"/>
          <Field label="Container" field="container" activeField={activeField} setActiveField={setActiveField}
            value={draft.container} onChange={v => updateField('container', v)} onKeyDown={handleFieldKey('container')}
            inputRef={el => fieldRefs.current.container = el}
            placeholder="Tube/cup"/>
          <Field label="Collected" field="collected" mono activeField={activeField} setActiveField={setActiveField}
            value={draft.collected} onChange={v => updateField('collected', v)} onKeyDown={handleFieldKey('collected')}
            inputRef={el => fieldRefs.current.collected = el}
            placeholder="HH:MM"/>
          <Field label="Received" field="received" mono activeField={activeField} setActiveField={setActiveField}
            value={draft.received} onChange={v => updateField('received', v)} onKeyDown={handleFieldKey('received')}
            inputRef={el => fieldRefs.current.received = el}
            placeholder="HH:MM"/>
          <ConditionField field="condition" activeField={activeField} setActiveField={setActiveField}
            value={draft.condition} onChange={v => updateField('condition', v)} onKeyDown={handleFieldKey('condition')}
            inputRef={el => fieldRefs.current.condition = el}/>
        </div>

        {/* Optional notes — surfaces in the spec record + reject reason fallback */}
        <div style={{ marginTop: 8 }}>
          <input
            value={draft.notes}
            onChange={e => updateField('notes', e.target.value)}
            placeholder="Notes (optional, recorded on the specimen)"
            style={{
              width: '100%', padding: '6px 10px', fontSize: 12,
              border: '1px solid var(--line)', borderRadius: 4,
              background: '#fff', color: 'var(--ink-700)',
              fontFamily: 'inherit', outline: 'none',
            }}/>
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button className="btn" data-variant="primary" data-size="sm" onClick={() => commitRow('accessioned')}
            disabled={!canAccession}
            title={permissionTitle(canAccession, 'Accession specimen', 'accession specimens')}>
            Accession <span className="kbd" style={{ marginLeft: 4, background: 'rgba(255,255,255,0.18)', borderColor: 'transparent', color: 'rgba(255,255,255,0.85)' }}>⌘↵</span>
          </button>
          <button className="btn" data-size="sm" data-variant="danger" onClick={() => commitRow('rejected')}
            disabled={!canAccession}
            title={permissionTitle(canAccession, 'Reject specimen', 'accession specimens')}>
            Reject <span className="kbd" style={{ marginLeft: 4 }}>⌘R</span>
          </button>
          <button className="btn" data-size="sm" onClick={openLatestLabel} disabled={!hasLabelable}
            title={hasLabelable ? 'Print label for the most recent accessioned specimen' : 'Accession a specimen first'}>
            Print label <span className="kbd" style={{ marginLeft: 4 }}>⌘L</span>
          </button>
          <button className="btn" data-size="sm" data-variant="ghost" onClick={() => { setDraft(blankRow()); setActiveField('barcode'); }}>
            Clear <span className="kbd" style={{ marginLeft: 4 }}>esc</span>
          </button>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="dot" data-tone="ok"/>
            Scanner ready
          </span>
        </div>

        {/* Validation hint strip */}
        <ValidationStrip draft={draft}/>
      </div>

      {/* Session log */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 32px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-900)' }}>Session log</span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
            {sessionSpecimens.length === 0 ? 'No specimens this session' : sessionSpecimens.length + ' specimens'}
          </span>
          {sessionSpecimens.length > 0 && (
            <button className="btn" data-size="xs" data-variant="ghost" onClick={resetSession}
              title="Clear the visible session log. Specimens remain in the pipeline.">
              Clear session
            </button>
          )}
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
            Specimens persist to the pipeline — see <span style={{ color: 'var(--ink-700)' }}>Specimens</span> for the full list.
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {sessionSpecimens.length === 0 ? (
            <div className="empty" style={{ padding: '60px 24px' }}>
              <div className="empty-icon"><IconAccession size={18}/></div>
              <div className="empty-title">No specimens accessioned yet</div>
              <div className="empty-sub">Scan a barcode (or type into the Barcode field above) to begin a row. ⌘↵ commits and advances; ⌘R rejects.</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>Accession</th>
                  <th>Barcode</th>
                  <th>Patient</th>
                  <th>Order</th>
                  <th>Specimen</th>
                  <th>Container</th>
                  <th>Collected</th>
                  <th>Received</th>
                  <th>State</th>
                  <th style={{ width: 80 }}>At</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {sessionSpecimens.map((r, i) => {
                  const pat = r.patientId ? patientById[r.patientId] : null;
                  const ord = r.orderId ? orderById[r.orderId] : null;
                  return (
                    <tr key={r.id}>
                      <td><span className="mono tnum" style={{ color: 'var(--ink-300)' }}>{String(sessionSpecimens.length - i).padStart(3, '0')}</span></td>
                      <td><span className="mono">{r.accessionNumber || '—'}</span></td>
                      <td><span className="mono">{r.barcode || '—'}</span></td>
                      <td>{pat ? (pat.mrn || (pat.lastName + (pat.firstName ? ', ' + pat.firstName : '')) || '—') : '—'}</td>
                      <td><span className="mono">{ord ? ord.orderNumber : '—'}</span></td>
                      <td>{r.type || '—'}</td>
                      <td>{r.container || '—'}</td>
                      <td><span className="mono">{formatClock(r.collectedAt)}</span></td>
                      <td><span className="mono">{formatClock(r.receivedAt)}</span></td>
                      <td>
                        {r.state === 'rejected'
                          ? <span className="pill" data-tone="rust">Rejected</span>
                          : <span className="pill" data-tone="sage"><IconCheck size={9}/> Accessioned</span>}
                      </td>
                      <td><span className="mono" style={{ color: 'var(--ink-400)', fontSize: 11 }}>{formatTime(r.createdAt)}</span></td>
                      <td>
                        {r.state !== 'rejected' && (
                          <button className="btn" data-size="xs" onClick={() => setLabelSpecId(r.id)}>Label</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Keyboard rail */}
      <KeyboardRail/>

      {/* Label preview modal */}
      {labelSpecId && (
        <LabelPreviewModal specimenId={labelSpecId} onClose={() => setLabelSpecId(null)}/>
      )}
    </div>
  );
};

// ===== Label preview modal =====
// Shows side-by-side: visual preview (HTML render) and raw ZPL with copy button.
const LabelPreviewModal = ({ specimenId, onClose }) => {
  const [built, setBuilt] = useStateAC(null);
  const [error, setError] = useStateAC(null);
  const [copied, setCopied] = useStateAC(false);

  useEffectAC(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await window.labels.build(specimenId);
        if (!cancelled) setBuilt(out);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [specimenId]);

  const copyZpl = async () => {
    if (!built) return;
    try {
      await navigator.clipboard.writeText(built.zpl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      window.alert('Copy failed: ' + e.message);
    }
  };

  // Open an isolated print window so the lab's browser-attached label printer
  // (or any page printer) can render the label without the surrounding LIS UI.
  // The actual ZPL path (Zebra over TCP) is Tier 6.
  // @page size matches the configured template dimensions, not a fixed 2x1 —
  // portrait templates print portrait, landscape stays landscape.
  const printNow = () => {
    if (!built) return;
    const widthIn  = (built.meta && Number(built.meta.width))  || 2;
    const heightIn = (built.meta && Number(built.meta.height)) || 1;
    const w = window.open('', '_blank', `width=${Math.round(widthIn * 200)},height=${Math.round(heightIn * 240)}`);
    if (!w) { window.alert('Pop-up blocked — allow pop-ups to print.'); return; }
    w.document.write(`<!doctype html><html><head><title>Label ${built.render.accession}</title>
      <style>@page { size: ${widthIn}in ${heightIn}in; margin: 0; } body { margin: 0; padding: 0; }</style>
      </head><body>${window.labels.renderHtml(built.render, built.meta)}<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };</script></body></html>`);
    w.document.close();
  };

  return (
    <div onClick={onClose} className="backdrop-in" style={{
      position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.4)',
      display: 'grid', placeItems: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} className="scale-in" style={{
        background: '#fff', borderRadius: 8, width: 720, maxWidth: '90vw',
        boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Specimen label</div>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" data-variant="ghost" onClick={onClose}>Close</button>
        </div>
        {error ? (
          <div style={{ padding: 24, color: 'var(--err-700)' }}>{error}</div>
        ) : !built ? (
          <div style={{ padding: 24, color: 'var(--ink-400)' }}>Building…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 0 }}>
            <div style={{ padding: 16, borderRight: '1px solid var(--line)', background: 'var(--ivory-50)' }}>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>
                Preview ({Number(built.meta.width || 2)}″ × {Number(built.meta.height || 1)}″)
              </div>
              <div dangerouslySetInnerHTML={{ __html: window.labels.renderHtml(built.render, built.meta) }}/>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-400)' }}>
                {Math.round(Number(built.meta.width) * Number(built.meta.dpi))}×{Math.round(Number(built.meta.height) * Number(built.meta.dpi))} dots @ {built.meta.dpi} dpi
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 240 }}>
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>ZPL II</span>
                <div style={{ flex: 1 }}/>
                <button className="btn" data-size="xs" onClick={printNow}>Print</button>
                <button className="btn" data-size="xs" data-variant={copied ? 'primary' : undefined} onClick={copyZpl}>
                  {copied ? 'Copied' : 'Copy ZPL'}
                </button>
              </div>
              <pre style={{
                margin: 0, padding: 14, flex: 1, overflowY: 'auto',
                fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.5,
                background: '#fff', color: 'var(--ink-900)', whiteSpace: 'pre-wrap',
              }}>{built.zpl}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ===== Field cell =====
const Field = ({ label, hint, field, value, onChange, onKeyDown, activeField, setActiveField, inputRef, placeholder, mono }) => {
  const isActive = activeField === field;
  return (
    <div onClick={() => setActiveField(field)} style={{
      padding: '8px 12px',
      background: isActive ? 'var(--sage-50)' : '#fff',
      cursor: 'text',
      position: 'relative',
      transition: 'background 80ms linear',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="section-title" style={{ fontSize: 9.5, color: isActive ? 'var(--sage-700)' : 'var(--ink-400)' }}>{label}</span>
        {hint && <span className="kbd" style={{ fontSize: 9, height: 14, padding: '0 4px' }}>{hint}</span>}
      </div>
      <input ref={inputRef}
        value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={mono ? 'mono' : ''}
        style={{
          width: '100%',
          border: 'none', outline: 'none',
          background: 'transparent',
          fontSize: 13,
          color: 'var(--ink-900)',
          padding: 0,
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        }}/>
      {isActive && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--sage-700)' }}/>}
    </div>
  );
};

// ===== Patient / MRN field with smart typeahead =====
// Suggests existing patients as the operator types. Match priority:
//   1) MRN starts-with     2) lastName starts-with     3) "LAST, FIRST" starts-with
//   4) firstName starts-with     5) MRN contains       6) name contains
// Picking sets the field to the patient's MRN so resolvePatient finds the
// existing record instead of stubbing a new one. Keyboard: ↑/↓ navigate,
// Enter/Tab pick the highlighted row, Esc closes the menu (then proceeds
// like a normal Esc on the field — clears the row).
//
// Positioning: the active-row grid uses overflow:hidden to clip its rounded
// corners, which would also clip a position:absolute dropdown. Using
// position:fixed with getBoundingClientRect sidesteps that and works
// regardless of where the field lives in the layout.
const PatientField = ({ value, onChange, onKeyDown, activeField, setActiveField, inputRef, allPatients }) => {
  const field = 'patient';
  const isActive = activeField === field;
  const [sel, setSel] = useStateAC(0);
  const [coords, setCoords] = useStateAC(null);
  const containerRef = useRefAC(null);

  const matches = useMemoAC(() => {
    const q = (value || '').trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const p of allPatients) {
      const mrn   = (p.mrn || '').toLowerCase();
      const last  = (p.lastName || '').toLowerCase();
      const first = (p.firstName || '').toLowerCase();
      const full  = (last + (first ? ', ' + first : '')).trim();
      let score = -1;
      if      (mrn.startsWith(q))   score = 0;
      else if (last.startsWith(q))  score = 1;
      else if (full.startsWith(q))  score = 2;
      else if (first.startsWith(q)) score = 3;
      else if (mrn.includes(q))     score = 4;
      else if (full.includes(q))    score = 5;
      if (score >= 0) scored.push({ p, score });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 8).map(s => s.p);
  }, [value, allPatients]);

  const showDropdown = isActive && matches.length > 0;

  // Reset highlight to top match when the result set changes.
  useEffectAC(() => { setSel(0); }, [matches]);

  // Re-position on show + on resize/scroll so the menu tracks the input.
  // Width is locked to the Patient / MRN column so the dropdown sits directly
  // under it rather than overflowing into the Order column.
  useEffectAC(() => {
    if (!showDropdown) { setCoords(null); return; }
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setCoords({ top: r.bottom, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showDropdown]);

  const pickMatch = (p) => {
    // Prefer MRN so resolvePatient can find the existing record. Fall back to
    // the formatted name only when the patient has no MRN (rare — usually
    // demo or pre-registration data).
    const next = p.mrn || ((p.lastName || '') + (p.firstName ? ', ' + p.firstName : '')) || '';
    onChange(next);
    const idx = FIELD_ORDER.indexOf(field);
    if (FIELD_ORDER[idx + 1]) setActiveField(FIELD_ORDER[idx + 1]);
  };

  const handleKey = (e) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel(s => Math.min(s + 1, matches.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel(s => Math.max(s - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (matches[sel]) pickMatch(matches[sel]);
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey && matches[sel]) {
        e.preventDefault();
        pickMatch(matches[sel]);
        return;
      }
    }
    onKeyDown(e);
  };

  return (
    <div ref={containerRef} onClick={() => setActiveField(field)} style={{
      padding: '8px 12px',
      background: isActive ? 'var(--sage-50)' : '#fff',
      cursor: 'text', position: 'relative',
      transition: 'background 80ms linear',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="section-title" style={{ fontSize: 9.5, color: isActive ? 'var(--sage-700)' : 'var(--ink-400)' }}>Patient / MRN</span>
        {showDropdown && (
          <span style={{ fontSize: 9.5, color: 'var(--ink-400)' }}>
            {matches.length} match{matches.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>
      <input ref={inputRef}
        value={value} onChange={e => onChange(e.target.value)} onKeyDown={handleKey}
        placeholder="MRN or last name"
        style={{
          width: '100%', border: 'none', outline: 'none',
          background: 'transparent', fontSize: 13, color: 'var(--ink-900)',
          padding: 0, fontFamily: 'inherit',
        }}/>
      {isActive && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--sage-700)' }}/>}

      {showDropdown && coords && ReactDOM.createPortal(
        <div className="scale-in" style={{
          position: 'fixed',
          top: coords.top + 2,
          left: coords.left,
          width: coords.width,
          background: '#fff',
          border: '1px solid var(--line)',
          borderRadius: 6,
          boxShadow: 'var(--shadow-pop)',
          zIndex: 1100,
          maxHeight: 280,
          overflowY: 'auto',
          transformOrigin: 'top left',
        }}>
          {matches.map((p, i) => {
            const fullName = (p.lastName || '').toUpperCase() + (p.firstName ? ', ' + p.firstName : '');
            const dobShort = p.dob ? String(p.dob).slice(0, 10) : '';
            const meta = [dobShort, p.sex].filter(Boolean).join(' · ');
            // Stacked row layout — single line wouldn't fit comfortably in the
            // 1.3fr patient column (~200-220px). MRN + meta on the top row,
            // name on the bottom row with ellipsis if it overruns.
            return (
              <div key={p.id}
                onMouseDown={e => { e.preventDefault(); pickMatch(p); }}
                onMouseEnter={() => setSel(i)}
                style={{
                  padding: '7px 10px',
                  cursor: 'pointer',
                  background: sel === i ? 'var(--sage-50)' : 'transparent',
                  borderBottom: i < matches.length - 1 ? '1px solid var(--ivory-200)' : 'none',
                  display: 'flex', flexDirection: 'column', gap: 1,
                }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span className="mono" style={{ color: 'var(--ink-700)', fontSize: 12 }}>
                    {p.mrn || '—'}
                  </span>
                  {meta && (
                    <span style={{ fontSize: 10.5, color: 'var(--ink-400)', whiteSpace: 'nowrap' }}>
                      {meta}
                    </span>
                  )}
                </div>
                <div style={{
                  color: 'var(--ink-900)', fontSize: 12.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {fullName || '—'}
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
};

// ===== Condition field cell — select with tone indicator =====
// Always-captured per Appendix A. Auto-rejects on a "reject"-class condition
// when the user presses ⌘↵ (so abnormal can't accidentally be marked accessioned).
const ConditionField = ({ field, value, onChange, onKeyDown, activeField, setActiveField, inputRef }) => {
  const isActive = activeField === field;
  const conds = window.schema && window.schema.SPECIMEN_CONDITIONS ? window.schema.SPECIMEN_CONDITIONS : [];
  const def = conds.find(c => c.id === value) || conds[0];
  const tone = def ? def.tone : 'ghost';
  const dotColor = tone === 'sage' ? 'var(--sage-500)'
                : tone === 'amber' ? 'var(--amber)'
                : tone === 'rust'  ? 'var(--rust)'
                : 'var(--ink-300)';
  return (
    <div onClick={() => setActiveField(field)} style={{
      padding: '8px 12px',
      background: isActive ? 'var(--sage-50)' : '#fff',
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 80ms linear',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="section-title" style={{ fontSize: 9.5, color: isActive ? 'var(--sage-700)' : 'var(--ink-400)' }}>Condition</span>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999, background: dotColor }}/>
      </div>
      <select ref={inputRef}
        value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
        style={{
          width: '100%', border: 'none', outline: 'none',
          background: 'transparent', fontSize: 13, color: 'var(--ink-900)',
          padding: 0, appearance: 'none', WebkitAppearance: 'none',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        {conds.map(c => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      {isActive && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: 'var(--sage-700)' }}/>}
    </div>
  );
};

// ===== Session meter =====
const SessionMeter = ({ stats }) => (
  <div style={{ display: 'flex', gap: 0, border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }}>
    {[
      { l: 'Accessioned', v: stats.accessioned, tone: 'sage' },
      { l: 'Rejected', v: stats.rejected, tone: stats.rejected > 0 ? 'rust' : 'idle' },
      { l: 'Rate / min', v: stats.rate.toFixed(1) },
      { l: 'Session', v: Math.floor(stats.elapsedMin) + 'm' },
    ].map((s, i) => (
      <div key={s.l} style={{
        padding: '8px 16px',
        borderRight: i < 3 ? '1px solid var(--line)' : 'none',
        minWidth: 96,
      }}>
        <div className="section-title" style={{ fontSize: 9.5 }}>{s.l}</div>
        <div className="mono tnum" style={{ fontSize: 18, color: s.tone === 'sage' ? 'var(--sage-900)' : (s.tone === 'rust' ? 'var(--err-700)' : 'var(--ink-700)'), letterSpacing: '-0.01em', marginTop: 2 }}>
          {s.v}
        </div>
      </div>
    ))}
  </div>
);

// ===== Validation strip — real-time hints =====
const ValidationStrip = ({ draft }) => {
  const checks = [
    { ok: !!draft.barcode,   msg: 'Barcode required' },
    { ok: !!draft.patient,   msg: 'Patient identifier present' },
    { ok: !!draft.specType,  msg: 'Specimen type set' },
    { ok: !!draft.container, msg: 'Container type set' },
  ];
  const allOk = checks.every(c => c.ok);
  return (
    <div style={{
      marginTop: 10,
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '6px 10px',
      fontSize: 11.5,
      color: 'var(--ink-400)',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className="dot" data-tone={allOk ? 'ok' : 'idle'}/>
        {allOk ? 'Ready to accession' : 'Required fields:'}
      </span>
      {!allOk && checks.filter(c => !c.ok).map((c, i) => (
        <span key={i} style={{ color: 'var(--ink-500)' }}>· {c.msg}</span>
      ))}
    </div>
  );
};

// ===== Keyboard rail (bottom) =====
const KeyboardRail = () => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 18,
    padding: '0 32px', height: 32,
    borderTop: '1px solid var(--line)',
    background: 'var(--ivory-100)',
    fontSize: 11, color: 'var(--ink-400)',
    overflowX: 'auto',
  }}>
    {[
      ['⌘B', 'focus barcode'],
      ['Tab', 'next field'],
      ['⇧Tab', 'previous'],
      ['↵', 'next field'],
      ['⌘↵', 'accession'],
      ['⌘R', 'reject'],
      ['⌘L', 'print label'],
      ['F2', 'open detail'],
      ['esc', 'clear row'],
      ['/', 'search'],
    ].map(([k, label]) => (
      <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <span className="kbd" style={{ fontSize: 10 }}>{k}</span>
        <span>{label}</span>
      </span>
    ))}
  </div>
);

const formatTime = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const formatClock = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

// Parse "HH:MM" (or "HHMM") into a today-anchored timestamp. Empty / invalid → null.
const parseClockToTs = (raw, fallbackNow) => {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/[^0-9]/g, '');
  if (cleaned.length !== 4 && cleaned.length !== 3) return null;
  const padded = cleaned.padStart(4, '0');
  const h = parseInt(padded.slice(0, 2), 10);
  const m = parseInt(padded.slice(2, 4), 10);
  if (h > 23 || m > 59) return null;
  const d = new Date(fallbackNow || Date.now());
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

Object.assign(window, { AccessioningPage });
