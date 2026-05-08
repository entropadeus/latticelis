// order-form.jsx — New Order drawer
// Real workflow: pick or create patient, pick or create tests from the catalogue,
// set priority/facility/provider/diagnosis/notes, save.
// On save: persists Order to IndexedDB, publishes order.created.
//
// The drawer auto-creates patients/tests inline so a fresh install is usable
// without first populating an Admin → Test catalogue. Production will move to
// a managed catalogue, but the inline path stays for ad-hoc tests.

const { useState: useStateOF, useEffect: useEffectOF, useMemo: useMemoOF, useRef: useRefOF } = React;

// LocationPicker — dropdown over the active locations. Falls back to a free-text
// input when "Other (specify)" is chosen, so legacy data and unusual cases
// still flow through. Setting a real location clears the free-text field;
// switching to free-text clears the locationId — the order can carry one
// or the other, never both.
const LocationPicker = ({ locationId, setLocationId, facility, setFacility }) => {
  const all = window.useEntities('locations', l => l.active !== false);
  const sorted = useMemoOF(
    () => [...all].sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '')),
    [all]
  );
  const useFree = !locationId && !!facility;
  const choice = useFree ? '__free__' : (locationId || '');

  const onChange = (val) => {
    if (val === '__free__') {
      setLocationId('');
      // keep whatever's in facility so the operator can edit it
    } else {
      setLocationId(val);
      setFacility('');  // FK takes precedence; clear the legacy string
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, flexDirection: 'column' }}>
      <select className="input" value={choice} onChange={e => onChange(e.target.value)}>
        <option value="">— pick a location —</option>
        {sorted.map(l => (
          <option key={l.id} value={l.id}>
            {l.code} — {l.name}{l.type !== 'LAB' ? ` (${l.type.toLowerCase().replace('_',' ')})` : ''}
          </option>
        ))}
        <option value="__free__">Other (specify) …</option>
      </select>
      {useFree && (
        <input className="input" value={facility} onChange={e => setFacility(e.target.value)}
          placeholder="Free-text location (legacy / one-off)"/>
      )}
    </div>
  );
};

const __orderNumber = (existingTodayCount) => {
  const d = new Date();
  const ymd = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  // "L" prefix matches the agent's design-doc decision: filler order # = "L" + YYYYMMDD + seq
  return 'L' + ymd + String((existingTodayCount || 0) + 1).padStart(4, '0');
};

const NewOrderDrawer = ({ open, onClose }) => {
  const allPatients = window.useEntities('patients');
  const allTests = window.useEntities('tests');
  const allOrders = window.useEntities('orders');
  const allClients = window.useEntities('clients');

  const [clientId, setClientId] = useStateOF(null);
  const [clientQ, setClientQ] = useStateOF('');
  const [draftClient, setDraftClient] = useStateOF(null);

  const [patientId, setPatientId] = useStateOF(null);
  const [patientQ, setPatientQ] = useStateOF('');
  const [draftPatient, setDraftPatient] = useStateOF(null);

  const [selectedTestIds, setSelectedTestIds] = useStateOF([]);
  const [testQ, setTestQ] = useStateOF('');
  const [draftTest, setDraftTest] = useStateOF(null);

  const [priority, setPriority] = useStateOF('routine');
  const [locationId, setLocationId] = useStateOF('');
  const [facility, setFacility] = useStateOF('');
  const [providerName, setProviderName] = useStateOF('');
  const [diagnosisCodes, setDiagnosisCodes] = useStateOF('');
  const [notes, setNotes] = useStateOF('');
  const [deliveryChannel, setDeliveryChannel] = useStateOF('');
  const [deliveryEndpoint, setDeliveryEndpoint] = useStateOF('');

  const [saving, setSaving] = useStateOF(false);
  const [error, setError] = useStateOF('');
  const canCreateOrder = hasPermission('CREATE_ORDER');
  const canEditLabConfig = hasPermission('EDIT_LAB_CONFIG');
  const canEditTestCatalog = hasPermission('EDIT_TEST_CATALOG');

  const firstFieldRef = useRefOF(null);

  // Reset on each open
  useEffectOF(() => {
    if (!open) return;
    setClientId(null); setClientQ(''); setDraftClient(null);
    setPatientId(null); setPatientQ(''); setDraftPatient(null);
    setSelectedTestIds([]); setTestQ(''); setDraftTest(null);
    setPriority('routine'); setFacility(''); setProviderName('');
    setDiagnosisCodes(''); setNotes('');
    setSaving(false); setError('');
    setTimeout(() => firstFieldRef.current && firstFieldRef.current.focus(), 0);
  }, [open]);

  // Esc closes (only while open)
  useEffectOF(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const matchingClients = useMemoOF(() => {
    const q = clientQ.trim().toLowerCase();
    if (!q) return allClients.filter(c => c.active !== false).slice(0, 8);
    return allClients.filter(c => {
      if (c.active === false) return false;
      const blob = [c.code, c.name, c.contactName].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    }).slice(0, 8);
  }, [allClients, clientQ]);

  const matchingPatients = useMemoOF(() => {
    const q = patientQ.trim().toLowerCase();
    if (!q) return [];
    return allPatients.filter(p => {
      const blob = [p.mrn, p.lastName, p.firstName].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    }).slice(0, 8);
  }, [allPatients, patientQ]);

  const matchingTests = useMemoOF(() => {
    const q = testQ.trim().toLowerCase();
    if (!q) return [];
    return allTests.filter(t => {
      if (selectedTestIds.includes(t.id)) return false;
      const blob = [t.code, t.name, t.shortName, t.loinc].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    }).slice(0, 8);
  }, [allTests, testQ, selectedTestIds]);

  const selectedClient = clientId ? allClients.find(c => c.id === clientId) : null;
  const selectedPatient = patientId ? allPatients.find(p => p.id === patientId) : null;
  const selectedTests = useMemoOF(
    () => selectedTestIds.map(id => allTests.find(t => t.id === id)).filter(Boolean),
    [selectedTestIds, allTests]
  );

  const startNewClient = () => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    setDraftClient({ code: clientQ.trim().toUpperCase(), name: '', type: 'CLINIC', deliveryChannel: 'fax', deliveryEndpoint: '' });
  };
  const commitNewClient = async () => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return null;
    if (!draftClient) return null;
    if (!draftClient.code || !draftClient.name) {
      setError('New client needs a code and name.');
      return null;
    }
    const c = window.schema.newClient(draftClient);
    await window.db.put('clients', c);
    setClientId(c.id);
    setDraftClient(null);
    setClientQ('');
    setError('');
    return c;
  };

  const startNewPatient = () => {
    setDraftPatient({ mrn: patientQ.trim(), lastName: '', firstName: '', dob: '', sex: '' });
  };
  const commitNewPatient = async () => {
    if (!draftPatient) return null;
    if (!draftPatient.mrn || !draftPatient.lastName) {
      setError('New patient needs at least MRN and last name.');
      return null;
    }
    const pat = window.schema.newPatient(draftPatient);
    await window.db.put('patients', pat);
    setPatientId(pat.id);
    setDraftPatient(null);
    setPatientQ('');
    setError('');
    return pat;
  };

  const startNewTest = () => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return;
    setDraftTest({ code: testQ.trim(), name: '', units: '' });
  };
  const commitNewTest = async () => {
    if (!hasPermission('EDIT_TEST_CATALOG')) return null;
    if (!draftTest) return null;
    if (!draftTest.code || !draftTest.name) {
      setError('New test needs at least code and name.');
      return null;
    }
    const t = window.schema.newTest(draftTest);
    await window.db.put('tests', t);
    setSelectedTestIds(ids => [...ids, t.id]);
    setDraftTest(null);
    setTestQ('');
    setError('');
    return t;
  };

  const removeTest = (id) => setSelectedTestIds(ids => ids.filter(x => x !== id));

  const save = async () => {
    if (!hasPermission('CREATE_ORDER')) return;
    setError('');
    let pid = patientId;
    if (!pid && draftPatient) {
      const p = await commitNewPatient();
      if (!p) return;
      pid = p.id;
    }
    if (!pid) { setError('Pick or create a patient.'); return; }
    if (selectedTestIds.length === 0) { setError('Add at least one test.'); return; }

    setSaving(true);
    try {
      // Resolve client (if a draft is active, commit it first)
      let cid = clientId;
      if (!cid && draftClient) {
        const c = await commitNewClient();
        if (!c) return;
        cid = c.id;
      }

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const t = todayStart.getTime();
      const todayCount = allOrders.filter(o => (o.orderedAt || o.createdAt || 0) >= t).length;

      if (!hasPermission('CREATE_ORDER')) return;
      const order = window.schema.newOrder({
        orderNumber: __orderNumber(todayCount),
        patientId: pid,
        clientId: cid,
        priority,
        status: 'open',
        testIds: [...selectedTestIds],
        locationId: locationId || null,
        // Keep `facility` as a free-text fallback when no location is picked.
        // When a location is picked, the resolved name lands here too so older
        // displays that read `facility` continue to render something useful.
        facility: locationId ? '' : facility.trim(),
        providerId: providerName.trim() || null,
        diagnosisCodes: diagnosisCodes.split(',').map(s => s.trim()).filter(Boolean),
        notes: notes.trim(),
        deliveryChannel: deliveryChannel || '',
        deliveryEndpoint: deliveryEndpoint.trim() || '',
      });
      await window.db.put('orders', order);
      window.events.publish(window.EVENTS.ORDER_CREATED, {
        entityType: 'order', entityId: order.id, order,
      });
      onClose();
    } catch (e) {
      console.error('[NewOrderDrawer] save failed', e);
      setError('Failed to save order: ' + (e.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div onClick={onClose} className="backdrop-in" style={{
        position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.16)',
        zIndex: 900,
      }}/>
      <div className="drawer-in" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 540,
        background: 'var(--ivory-50)', borderLeft: '1px solid var(--line-strong)',
        boxShadow: 'var(--shadow-pop)', zIndex: 901,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* header */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 12, background: '#fff',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)' }}>New order</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>
              Pick or create a patient, then add tests.
            </div>
          </div>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={onClose}>
            Close <span className="kbd" style={{ marginLeft: 4 }}>esc</span>
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          <OrderSection title="Client" sub={selectedClient ? null : 'Referring clinic / outreach customer'}>
            {selectedClient ? (
              <ClientChip client={selectedClient} onClear={() => setClientId(null)}/>
            ) : draftClient ? (
              <NewClientFields draft={draftClient} setDraft={setDraftClient}
                onCancel={() => setDraftClient(null)}/>
            ) : (
              <div>
                <input className="input" placeholder="Search code, name, contact…"
                  value={clientQ} onChange={e => setClientQ(e.target.value)}/>
                {(clientQ || matchingClients.length > 0) && (
                  <Suggestions>
                    {matchingClients.length === 0 ? (
                      <SuggestionEmpty>No matching client.</SuggestionEmpty>
                    ) : matchingClients.map(c => (
                      <SuggestionRow key={c.id} onClick={() => { setClientId(c.id); setClientQ(''); }}>
                        <span className="mono">{c.code}</span>
                        <span style={{ marginLeft: 10 }}>{c.name || '—'}</span>
                        <span style={{ marginLeft: 10, color: 'var(--ink-400)' }}>· {c.type.toLowerCase()}</span>
                        {c.deliveryChannel && <span style={{ marginLeft: 10, color: 'var(--ink-400)' }}>delivers via {c.deliveryChannel}</span>}
                      </SuggestionRow>
                    ))}
                    <SuggestionAction onClick={startNewClient}
                      disabled={!canEditLabConfig}
                      title={permissionTitle(canEditLabConfig, 'Add new client', 'edit lab configuration')}>
                      + Add new client {clientQ ? `(code "${clientQ.toUpperCase()}")` : ''}
                    </SuggestionAction>
                  </Suggestions>
                )}
              </div>
            )}
          </OrderSection>

          <OrderSection title="Patient">
            {selectedPatient ? (
              <PatientChip patient={selectedPatient} onClear={() => setPatientId(null)}/>
            ) : draftPatient ? (
              <NewPatientFields draft={draftPatient} setDraft={setDraftPatient}
                onCancel={() => setDraftPatient(null)}/>
            ) : (
              <div>
                <input ref={firstFieldRef} className="input"
                  placeholder="Search MRN, last or first name…"
                  value={patientQ} onChange={e => setPatientQ(e.target.value)}/>
                {patientQ && (
                  <Suggestions>
                    {matchingPatients.length === 0 ? (
                      <SuggestionEmpty>No matching patient.</SuggestionEmpty>
                    ) : matchingPatients.map(p => (
                      <SuggestionRow key={p.id} onClick={() => { setPatientId(p.id); setPatientQ(''); }}>
                        <span className="mono">{p.mrn || '—'}</span>
                        <span style={{ marginLeft: 10 }}>
                          {[p.lastName, p.firstName].filter(Boolean).join(', ') || '—'}
                        </span>
                        {p.dob && <span style={{ marginLeft: 10, color: 'var(--ink-400)' }}>DOB {p.dob}</span>}
                      </SuggestionRow>
                    ))}
                    <SuggestionAction onClick={startNewPatient}>
                      + Create new patient {patientQ ? `(MRN "${patientQ}")` : ''}
                    </SuggestionAction>
                  </Suggestions>
                )}
              </div>
            )}
          </OrderSection>

          <OrderSection title="Tests" sub={selectedTests.length > 0 ? `${selectedTests.length} selected` : null}>
            {selectedTests.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {selectedTests.map(t => (
                  <span key={t.id} className="pill" data-tone="info" style={{ height: 24, padding: '0 8px' }}>
                    <span className="mono">{t.code}</span>
                    <span style={{ marginLeft: 6 }}>{t.shortName || t.name}</span>
                    <button type="button" onClick={() => removeTest(t.id)}
                      style={{
                        background: 'transparent', border: 0, color: 'inherit',
                        cursor: 'pointer', marginLeft: 4, fontSize: 13, padding: 0, lineHeight: 1,
                      }}>×</button>
                  </span>
                ))}
              </div>
            )}
            {draftTest ? (
              <NewTestFields draft={draftTest} setDraft={setDraftTest}
                onCancel={() => setDraftTest(null)} onCommit={commitNewTest}
                canEditTestCatalog={canEditTestCatalog}/>
            ) : (
              <div>
                <input className="input" placeholder="Search test catalogue (code, name, LOINC)…"
                  value={testQ} onChange={e => setTestQ(e.target.value)}/>
                {testQ && (
                  <Suggestions>
                    {matchingTests.length === 0 ? (
                      <SuggestionEmpty>No matching test.</SuggestionEmpty>
                    ) : matchingTests.map(t => (
                      <SuggestionRow key={t.id} onClick={() => { setSelectedTestIds(ids => [...ids, t.id]); setTestQ(''); }}>
                        <span className="mono">{t.code}</span>
                        <span style={{ marginLeft: 10 }}>{t.name}</span>
                        {t.units && <span style={{ marginLeft: 10, color: 'var(--ink-400)' }}>{t.units}</span>}
                      </SuggestionRow>
                    ))}
                    <SuggestionAction onClick={startNewTest}
                      disabled={!canEditTestCatalog}
                      title={permissionTitle(canEditTestCatalog, 'Add new test', 'edit the test catalog')}>
                      + Add new test {testQ ? `(code "${testQ}")` : ''}
                    </SuggestionAction>
                  </Suggestions>
                )}
              </div>
            )}
          </OrderSection>

          <OrderSection title="Details">
            <FieldRow label="Priority">
              <SegSelect
                options={[
                  { id: 'routine', label: 'Routine' },
                  { id: 'asap',    label: 'ASAP' },
                  { id: 'stat',    label: 'STAT' },
                ]}
                value={priority} onChange={setPriority}/>
            </FieldRow>
            <FieldRow label="Location">
              <LocationPicker locationId={locationId} setLocationId={setLocationId}
                facility={facility} setFacility={setFacility}/>
            </FieldRow>
            <FieldRow label="Provider">
              <input className="input" value={providerName} onChange={e => setProviderName(e.target.value)}
                placeholder="Ordering provider name"/>
            </FieldRow>
            <FieldRow label="Diagnosis (ICD-10)">
              <input className="input" value={diagnosisCodes} onChange={e => setDiagnosisCodes(e.target.value)}
                placeholder="Comma-separated, e.g., E11.9, I10"/>
            </FieldRow>
            <FieldRow label="Notes">
              <textarea className="input" value={notes} onChange={e => setNotes(e.target.value)}
                style={{ height: 64, padding: 8, resize: 'vertical' }} placeholder="Optional"/>
            </FieldRow>
            <FieldRow label="Delivery override">
              <div style={{ display: 'flex', gap: 6 }}>
                <select className="input" value={deliveryChannel}
                  onChange={e => setDeliveryChannel(e.target.value)}
                  style={{ maxWidth: 140 }}>
                  <option value="">— inherit from client —</option>
                  <option value="fax">Fax</option>
                  <option value="hl7">HL7</option>
                  <option value="portal">Portal</option>
                  <option value="email">Email</option>
                  <option value="print">Print</option>
                  <option value="manual">Manual</option>
                </select>
                <input className="input mono" value={deliveryEndpoint}
                  onChange={e => setDeliveryEndpoint(e.target.value)}
                  placeholder={deliveryChannel ? 'Endpoint (fax #, URL, …)' : 'Inherits client endpoint'}
                  disabled={!deliveryChannel}
                  style={{ flex: 1 }}/>
              </div>
            </FieldRow>
          </OrderSection>

          {error && (
            <div style={{
              padding: '8px 12px', borderRadius: 5,
              background: 'var(--rust-soft)', color: 'var(--err-700)',
              fontSize: 12, marginTop: 8,
            }}>{error}</div>
          )}
        </div>

        {/* footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--line)',
          display: 'flex', gap: 8, background: '#fff',
        }}>
          <button className="btn" data-size="sm" onClick={onClose} disabled={saving}>Cancel</button>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-variant="primary" data-size="sm" onClick={save}
            disabled={saving || !canCreateOrder}
            title={permissionTitle(canCreateOrder, 'Create order', 'create orders')}>
            {saving ? 'Saving…' : 'Create order'}
          </button>
        </div>
      </div>
    </>
  );
};

// ── Section / row helpers ──────────────────────────────────────────────────

const OrderSection = ({ title, sub, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
      <span className="section-title">{title}</span>
      {sub && <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{sub}</span>}
    </div>
    {children}
  </div>
);

const FieldRow = ({ label, children }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, alignItems: 'center', marginBottom: 8 }}>
    <span className="field-label">{label}</span>
    <div>{children}</div>
  </div>
);

// ── Suggestion list (shared by patient + test typeaheads) ──────────────────

const Suggestions = ({ children }) => (
  <div style={{
    marginTop: 6, border: '1px solid var(--line)', borderRadius: 6,
    background: '#fff', overflow: 'hidden',
  }}>{children}</div>
);

const SuggestionRow = ({ onClick, children }) => (
  <button type="button" onClick={onClick}
    onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '8px 12px', border: 0, background: 'transparent',
      fontSize: 12.5, color: 'var(--ink-700)',
      borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
    }}>{children}</button>
);

const SuggestionEmpty = ({ children }) => (
  <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-400)' }}>{children}</div>
);

const SuggestionAction = ({ onClick, children, disabled, title }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title}
    style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '8px 12px', border: 0, background: 'var(--ivory-100)',
      fontSize: 12, color: 'var(--sage-700)', fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.55 : 1,
    }}>{children}</button>
);

// ── Client bits ────────────────────────────────────────────────────────────

const ClientChip = ({ client, onClear }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    padding: 10, border: '1px solid var(--info)', borderRadius: 6,
    background: 'var(--info-soft)',
  }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-900)' }}>
        <span className="mono">{client.code || '—'}</span>
        <span style={{ marginLeft: 10, fontWeight: 500 }}>{client.name || '—'}</span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginTop: 2 }}>
        {(client.type || 'CLINIC').toLowerCase()}
        {client.deliveryChannel && <span style={{ marginLeft: 10 }}>· delivery: {client.deliveryChannel}{client.deliveryEndpoint ? ` (${client.deliveryEndpoint})` : ''}</span>}
      </div>
    </div>
    <button className="btn" data-variant="ghost" data-size="xs" onClick={onClear}>Change</button>
  </div>
);

const NewClientFields = ({ draft, setDraft, onCancel }) => (
  <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, background: '#fff' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-700)', flex: 1 }}>New client</span>
      <button className="btn" data-variant="ghost" data-size="xs" onClick={onCancel}>Cancel</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
      <Labeled label="Code">
        <input className="input mono" value={draft.code} autoFocus
          onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))}/>
      </Labeled>
      <Labeled label="Name">
        <input className="input" value={draft.name} placeholder="St Joseph Family Clinic"
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}/>
      </Labeled>
      <Labeled label="Type">
        <select className="input" value={draft.type}
          onChange={e => setDraft(d => ({ ...d, type: e.target.value }))}>
          <option value="CLINIC">Clinic</option>
          <option value="HOSPITAL">Hospital</option>
          <option value="PHYSICIAN_OFFICE">Physician office</option>
          <option value="OTHER">Other</option>
        </select>
      </Labeled>
      <Labeled label="Delivery channel">
        <select className="input" value={draft.deliveryChannel}
          onChange={e => setDraft(d => ({ ...d, deliveryChannel: e.target.value }))}>
          <option value="fax">Fax</option>
          <option value="hl7">HL7</option>
          <option value="portal">Portal</option>
          <option value="email">Email</option>
          <option value="print">Print/Courier</option>
        </select>
      </Labeled>
    </div>
    <div style={{ marginTop: 8 }}>
      <Labeled label="Delivery endpoint">
        <input className="input mono" value={draft.deliveryEndpoint}
          placeholder="fax #, HL7 endpoint id, portal URL…"
          onChange={e => setDraft(d => ({ ...d, deliveryEndpoint: e.target.value }))}/>
      </Labeled>
    </div>
  </div>
);

// ── Patient bits ───────────────────────────────────────────────────────────

const PatientChip = ({ patient, onClear }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 12,
    padding: 10, border: '1px solid var(--sage-200)', borderRadius: 6,
    background: 'var(--sage-50)',
  }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-900)' }}>
        <span className="mono">{patient.mrn || '—'}</span>
        <span style={{ marginLeft: 10, fontWeight: 500 }}>
          {[patient.lastName, patient.firstName].filter(Boolean).join(', ') || 'No name on file'}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>
        {patient.dob ? 'DOB ' + patient.dob : 'DOB —'}
        {patient.sex && <span style={{ marginLeft: 10 }}>{patient.sex}</span>}
      </div>
    </div>
    <button className="btn" data-variant="ghost" data-size="xs" onClick={onClear}>Change</button>
  </div>
);

const NewPatientFields = ({ draft, setDraft, onCancel }) => (
  <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, background: '#fff' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-700)', flex: 1 }}>New patient</span>
      <button className="btn" data-variant="ghost" data-size="xs" onClick={onCancel}>Cancel</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <Labeled label="MRN">
        <input className="input mono" value={draft.mrn} autoFocus
          onChange={e => setDraft(d => ({ ...d, mrn: e.target.value }))}/>
      </Labeled>
      <Labeled label="Last name">
        <input className="input" value={draft.lastName}
          onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}/>
      </Labeled>
      <Labeled label="First name">
        <input className="input" value={draft.firstName}
          onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}/>
      </Labeled>
      <Labeled label="DOB">
        <input className="input mono" placeholder="YYYY-MM-DD" value={draft.dob}
          onChange={e => setDraft(d => ({ ...d, dob: e.target.value }))}/>
      </Labeled>
      <Labeled label="Sex">
        <select className="input" value={draft.sex}
          onChange={e => setDraft(d => ({ ...d, sex: e.target.value }))}>
          <option value="">—</option>
          <option value="F">F</option>
          <option value="M">M</option>
          <option value="X">X</option>
        </select>
      </Labeled>
    </div>
  </div>
);

const NewTestFields = ({ draft, setDraft, onCancel, onCommit, canEditTestCatalog }) => (
  <div style={{ border: '1px solid var(--line)', borderRadius: 6, padding: 10, background: '#fff' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-700)', flex: 1 }}>New test</span>
      <button className="btn" data-variant="ghost" data-size="xs" onClick={onCancel}>Cancel</button>
      <button className="btn" data-variant="primary" data-size="xs" onClick={onCommit}
        disabled={!canEditTestCatalog}
        title={permissionTitle(canEditTestCatalog, 'Add test', 'edit the test catalog')}>Add</button>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 8 }}>
      <Labeled label="Code">
        <input className="input mono" value={draft.code} autoFocus
          onChange={e => setDraft(d => ({ ...d, code: e.target.value }))}/>
      </Labeled>
      <Labeled label="Name">
        <input className="input" value={draft.name} placeholder="e.g., Sodium"
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}/>
      </Labeled>
      <Labeled label="Units">
        <input className="input mono" value={draft.units} placeholder="mmol/L"
          onChange={e => setDraft(d => ({ ...d, units: e.target.value }))}/>
      </Labeled>
    </div>
  </div>
);

const Labeled = ({ label, children }) => (
  <div>
    <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>{label}</div>
    {children}
  </div>
);

Object.assign(window, { NewOrderDrawer });
