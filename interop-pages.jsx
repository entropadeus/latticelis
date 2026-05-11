const INTAKE_LIMITS = {
  payloadBytes: 512 * 1024,
  rows: 250,
  testsPerOrder: 60,
  fieldChars: 500,
};

const bytesOfText = (text) => {
  const s = text == null ? '' : String(text);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  return s.length;
};

const collectOversizedFields = (value, path = 'payload', out = []) => {
  if (out.length >= 8) return out;
  if (typeof value === 'string' && value.length > INTAKE_LIMITS.fieldChars) {
    out.push(path + ' is ' + value.length + ' chars');
    return out;
  }
  if (Array.isArray(value)) {
    value.slice(0, INTAKE_LIMITS.testsPerOrder + 1).forEach((item, i) => collectOversizedFields(item, path + '[' + i + ']', out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach(k => collectOversizedFields(value[k], path + '.' + k, out));
  }
  return out;
};

const validateMapperPreview = (payload, rows) => {
  const errors = [];
  const bytes = bytesOfText(payload);
  if (bytes > INTAKE_LIMITS.payloadBytes) errors.push('payload is too large (' + bytes + ' bytes)');
  if (!Array.isArray(rows)) errors.push('mapped rows must be an array');
  else {
    if (rows.length > INTAKE_LIMITS.rows) errors.push('too many rows (' + rows.length + ')');
    rows.forEach((row, i) => {
      const tests = Array.isArray(row && row.tests) ? row.tests : [];
      const orderTestIds = row && row.order && row.order.testIds;
      const testCount = tests.length + (Array.isArray(orderTestIds) ? orderTestIds.length : typeof orderTestIds === 'string' ? orderTestIds.split(/[;,]/).filter(Boolean).length : 0);
      if (testCount > INTAKE_LIMITS.testsPerOrder) errors.push('row ' + (i + 1) + ' has too many tests (' + testCount + ')');
    });
    errors.push(...collectOversizedFields(rows, 'rows'));
  }
  return { ok: errors.length === 0, errors, bytes };
};

const validateHl7Intake = (text, parsed) => {
  const errors = [];
  const bytes = bytesOfText(text);
  if (bytes > INTAKE_LIMITS.payloadBytes) errors.push('message is too large (' + bytes + ' bytes)');
  if (parsed && Array.isArray(parsed.tests) && parsed.tests.length > INTAKE_LIMITS.testsPerOrder) {
    errors.push('too many tests (' + parsed.tests.length + ')');
  }
  errors.push(...collectOversizedFields(parsed, 'hl7'));
  return { ok: errors.length === 0, errors, bytes };
};

const confirmConfigChange = (options) => safetyConfirm({
  tone: 'warning',
  requireReason: true,
  reasonLabel: 'Change reason',
  reasonPlaceholder: 'why this control change is safe',
  ...options,
});

const InstrumentsPage = ({ onBack }) => {
  const [simEnabled, setSimEnabled] = useStateOS(window.instrumentSim ? window.instrumentSim.isEnabled() : true);
  const [activity, setActivity] = useStateOS(() => (window.instrumentSim ? window.instrumentSim.getRecent(40) : []));
  const canEditInterfaces = hasPermission('EDIT_INTERFACES');

  // Subscribe to simulator activity events; merge into our buffer.
  React.useEffect(() => {
    if (!window.instrumentSim) return;
    setActivity(window.instrumentSim.getRecent(40));
    const unsub = window.instrumentSim.subscribe(() => {
      setActivity(window.instrumentSim.getRecent(40));
    });
    return unsub;
  }, []);

  const toggleSim = () => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    const next = !simEnabled;
    if (window.instrumentSim) window.instrumentSim.setEnabled(next);
    setSimEnabled(next);
  };

  const counts = useMemoOS(() => {
    const recent = activity.slice(0, 100);
    return {
      scheduled: recent.filter(a => a.kind === 'scheduled').length,
      results:   recent.filter(a => a.kind === 'result').length,
      errors:    recent.filter(a => a.kind === 'error').length,
      flagged:   recent.filter(a => a.kind === 'result' && a.flag).length,
    };
  }, [activity]);

  return (
    <Page label="Instrument Manager">
      <PageHeader title="Instrument Manager" sub="Connected analyzers, QC status, calibration, and message throughput."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []),
          <button key="r" className="btn" data-size="sm"
            onClick={() => { if (!hasPermission('EDIT_INTERFACES')) return; window.instrumentSim && window.instrumentSim.catchUp('manual'); }}
            disabled={!canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Re-scan all in-flight specimens for unfilled tests. Use after a page reload, after re-enabling the simulator, or to recover a stuck specimen.', 'edit interfaces')}>
            Re-scan in-flight
          </button>,
          <button key="t" className="btn" data-size="sm" data-variant={simEnabled ? 'ghost' : 'primary'} onClick={toggleSim}
            disabled={!canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Toggle simulator', 'edit interfaces')}>
            <span className="dot" data-tone={simEnabled ? 'ok' : 'idle'} style={{ marginRight: 6 }}/>
            Simulator: {simEnabled ? 'enabled' : 'disabled'}
          </button>,
          <button key="n" className="btn" data-size="sm"
            disabled={!canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Connect analyzer', 'edit interfaces')}><IconPlus size={13}/> Connect analyzer</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Scheduled (recent)" value={counts.scheduled}/>
        <KpiPanel label="Results emitted"    value={counts.results}/>
        <KpiPanel label="Out-of-range flags" value={counts.flagged} tone={counts.flagged > 0 ? 'amber' : null}/>
        <KpiPanel label="Errors"             value={counts.errors}  tone={counts.errors > 0 ? 'rust' : null}/>
      </div>

      <div className="panel">
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Simulator activity</span>
          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
            until real ASTM/HL7 interfaces land, this stands in for analyzer hardware
          </span>
        </div>
        {activity.length === 0 ? (
          <div className="empty" style={{ padding: '40px 24px' }}>
            <div className="empty-icon"><IconInstrument size={16}/></div>
            <div className="empty-title">{simEnabled ? 'Waiting for routed specimens' : 'Simulator disabled'}</div>
            <div className="empty-sub">
              {simEnabled
                ? 'Route a specimen to an analyzer (via a routing rule, or set specimen.routedTo manually) and the simulator will emit results within a few seconds.'
                : 'Enable the simulator to auto-generate results when specimens are routed.'}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Time</th><th>Kind</th><th>Accession</th><th>Instrument</th>
                  <th>Test</th><th>Value</th><th>Flag</th><th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a, i) => (
                  <tr key={i + ':' + a.ts}>
                    <td><span className="mono" style={{ fontSize: 11 }}>{formatTime(a.ts)}</span></td>
                    <td><SimKindPill kind={a.kind}/></td>
                    <td><span className="mono">{a.accession || '—'}</span></td>
                    <td><span className="mono" style={{ color: 'var(--ink-500)' }}>{a.instrument || '—'}</span></td>
                    <td>
                      {a.test ? <><span className="mono">{a.test}</span>{a.name && <span style={{ color: 'var(--ink-400)', marginLeft: 4 }}>{a.name}</span>}</> : '—'}
                    </td>
                    <td className="mono tnum">{a.value != null ? a.value + (a.units ? ' ' + a.units : '') : '—'}</td>
                    <td>{a.flag ? <ResultFlagPill flag={a.flag}/> : '—'}</td>
                    <td style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
                      {a.kind === 'scheduled' ? `${a.tests} test${a.tests === 1 ? '' : 's'}, ETA ${formatTime(a.eta)}` :
                       a.kind === 'skipped' ? a.reason :
                       a.kind === 'error' ? a.error : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Page>
  );
};

const KpiPanel = ({ label, value, tone }) => {
  const color = tone === 'rust'  ? 'var(--err-700)'
              : tone === 'amber' ? 'var(--warn-700)'
              : value === 0      ? 'var(--ink-300)'
              : 'var(--ink-900)';
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="section-title" style={{ fontSize: 10 }}>{label}</div>
      <div className="mono tnum" style={{ fontSize: 22, color, marginTop: 2 }}>{value}</div>
    </div>
  );
};

const SIM_KIND_TONE = { scheduled: 'info', result: 'sage', skipped: 'ghost', error: 'rust' };
const SimKindPill = ({ kind }) => (
  <span className="pill" data-tone={SIM_KIND_TONE[kind] || 'ghost'}>{kind || '—'}</span>
);

// ===== Interfaces =====
const InterfacesPage = ({ onBack }) => {
  const interfaces = window.useEntities('interfaces');
  const canEditInterfaces = hasPermission('EDIT_INTERFACES');
  const counts = useMemoOS(() => ({
    inbound:  interfaces.filter(i => i.direction === 'inbound' || i.direction === 'bidirectional').length,
    outbound: interfaces.filter(i => i.direction === 'outbound' || i.direction === 'bidirectional').length,
    healthy:  interfaces.filter(i => i.status === 'idle' || i.status === 'running').length,
    errors:   interfaces.filter(i => i.status === 'error').length,
    queued:   0,
  }), [interfaces]);

  return (
    <Page label="Interfaces">
      <PageHeader title="Interfaces" sub="HL7 endpoints, MLLP listeners, file drops, and reference lab integrations."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            disabled={!canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Add interface', 'edit interfaces')}><IconPlus size={13}/> Add interface</button>,
        ]}/>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Inbound" value={counts.inbound}/>
        <KpiPanel label="Outbound" value={counts.outbound}/>
        <KpiPanel label="Healthy" value={counts.healthy}/>
        <KpiPanel label="Errors (24h)" value={counts.errors} tone={counts.errors > 0 ? 'rust' : null}/>
        <KpiPanel label="Queue depth" value={counts.queued}/>
      </div>

      <Hl7IntakePanel/>

      <div style={{ marginTop: 12 }}>
        <MapperIntakePanel/>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        {interfaces.length === 0 ? (
          <EmptyTable
            columns={['Interface','Direction','Protocol','Endpoint','Last message','Status']}
            message="No interfaces configured"
            sub="Real network listeners (MLLP, file drop) are Tier 6. The HL7 Intake above lets you exercise the same parser without networking."/>
        ) : (
          <table className="tbl">
            <thead><tr><th>Interface</th><th>Direction</th><th>Protocol</th><th>Endpoint</th><th>Last message</th><th>Status</th></tr></thead>
            <tbody>
              {interfaces.map(i => (
                <tr key={i.id}>
                  <td>{i.name || '—'}</td>
                  <td><span className="pill" data-tone="ghost">{i.direction || '—'}</span></td>
                  <td><span className="mono">{i.protocol || '—'}</span></td>
                  <td><span className="mono" style={{ color: 'var(--ink-500)' }}>{i.endpoint || '—'}</span></td>
                  <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(i.lastSeenAt)}</span></td>
                  <td><span className="pill" data-tone={i.status === 'error' ? 'rust' : i.status === 'running' ? 'sage' : 'ghost'}>{i.status || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  );
};

// ── Mapper Intake — partner CSV/JSON via a Lattice Mapper (LML) script.
// Demonstrates that adding a new partner format is just writing a small mapper,
// not a code change. The same downstream events fire (`order.created`).
const MapperIntakePanel = () => {
  const mappers = window.useEntities('mappers', m => m.active !== false);
  const inboundMappers = useMemoOS(() => {
    return mappers.filter(m => {
      const parsed = window.mappers && window.mappers.parse(m.text || '');
      return parsed && parsed.meta && parsed.meta.direction === 'inbound';
    });
  }, [mappers]);
  const clients = window.useEntities('clients');

  const [mapperId, setMapperId] = useStateOS(null);
  const [payload, setPayload] = useStateOS('');
  const [clientId, setClientId] = useStateOS(null);
  const [preview, setPreview] = useStateOS(null);
  const [committing, setCommitting] = useStateOS(false);
  const [result, setResult] = useStateOS(null);
  const canEditInterfaces = hasPermission('EDIT_INTERFACES');

  const mapperRecord = mapperId ? mappers.find(m => m.id === mapperId) : (inboundMappers[0] || null);
  const parsedMapper = useMemoOS(() => mapperRecord ? window.mappers.parse(mapperRecord.text) : null, [mapperRecord]);
  const meta = parsedMapper && parsedMapper.meta;

  const samplePayload = useMemoOS(() => {
    if (!meta) return '';
    if (meta.format === 'csv') {
      return 'MRN,LastName,FirstName,DOB,Sex,OrderID,Priority,TestCodes,Provider,Site,OrderDate,CollectedDate,ReceivedDate\n' +
             'MRN-1001,Doe,Jane,04/12/1985,F,EMR-9001,R,GLU;NA,Dr Smith,Outreach Clinic A,2026-05-08,2026-05-08,2026-05-08\n' +
             'MRN-1002,Smith,John,07/03/1972,M,EMR-9002,S,CMP;TSH,Dr Patel,Outreach Clinic A,2026-05-08,2026-05-08,2026-05-08';
    }
    if (meta.format === 'json') {
      return JSON.stringify([
        { patient: { mrn: 'MRN-2001', lastName: 'Doe', firstName: 'Jane', dob: '1985-04-12', sex: 'F' },
          order: { orderNumber: 'JSON-9001', placerOrderNumber: 'JSON-9001', priority: 'routine', testIds: ['GLU', 'NA'], providerId: 'Dr Smith', orderedAt: '2026-05-08' } },
      ], null, 2);
    }
    return '';
  }, [meta]);

  const fillSample = () => { setPayload(samplePayload); setPreview(null); setResult(null); };
  const reset = () => { setPayload(''); setPreview(null); setResult(null); };

  const runPreview = () => {
    if (!parsedMapper || !window.mappers) return;
    if (parsedMapper.errors && parsedMapper.errors.length > 0) {
      setPreview({ error: 'Mapper has parse errors: ' + parsedMapper.errors.join('; ') });
      return;
    }
    try {
      const result = meta.format === 'json'
        ? window.mappers.applyInboundJson(parsedMapper, payload)
        : window.mappers.applyInboundCsv(parsedMapper, payload);
      const check = validateMapperPreview(payload, result.rows || []);
      if (!check.ok) {
        setPreview({ error: 'Intake blocked: ' + check.errors.slice(0, 4).join('; ') });
        return;
      }
      setPreview(result);
      setResult(null);
    } catch (e) {
      setPreview({ error: e.message });
    }
  };

  const ingest = async () => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    if (!preview || !preview.rows) return;
    const check = validateMapperPreview(payload, preview.rows);
    if (!check.ok) {
      await safetyNotice({ tone: 'danger', title: 'Mapper ingest blocked', message: check.errors.slice(0, 4).join('; ') });
      return;
    }
    const first = preview.rows[0] || {};
    const ask = await safetyConfirm({
      id: 'interface.mapper.ingest',
      tone: 'warning',
      title: 'Ingest mapped orders',
      message: 'This creates or updates patient, test, and order records from pasted interface data.',
      facts: [
        safetyFact('mapper', mapperRecord ? mapperRecord.name : '-'),
        safetyFact('rows', preview.rows.length),
        safetyFact('bytes', check.bytes),
        safetyFact('client', clientId || 'none'),
        safetyFact('first mrn', first.patient && first.patient.mrn),
        safetyFact('first order', first.order && (first.order.orderNumber || first.order.placerOrderNumber || first.order.fillerOrderNumber)),
      ],
      requireReason: true,
      reasonLabel: 'Ingest reason',
      reasonPlaceholder: 'source file / interface batch / operator note',
      entityType: 'interface',
      entityId: mapperRecord ? mapperRecord.id : 'mapper-intake',
      confirmLabel: 'Ingest rows',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_INTERFACES')) return;
    const freshCheck = validateMapperPreview(payload, preview.rows);
    if (!freshCheck.ok) {
      await safetyNotice({ tone: 'danger', title: 'Mapper ingest blocked', message: freshCheck.errors.slice(0, 4).join('; ') });
      return;
    }
    setCommitting(true);
    const out = { created: 0, errors: [] };
    try {
      for (const row of preview.rows) {
        const ing = await window.mappers.ingestInboundResult(row, { clientId, mapperName: mapperRecord && mapperRecord.name });
        if (ing.ok) out.created++; else out.errors.push(...ing.errors);
      }
      setResult(out);
    } catch (e) {
      setResult({ created: out.created, errors: [...out.errors, e.message] });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      <div style={{ padding: 14, borderRight: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Generic intake · via Mapper script</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={fillSample} disabled={!meta}>Sample data</button>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={reset}>Clear</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="field-label">Mapper</span>
          <select className="input" value={mapperId || (mapperRecord && mapperRecord.id) || ''}
            onChange={e => { setMapperId(e.target.value); setPayload(''); setPreview(null); setResult(null); }}
            style={{ height: 28, flex: 1 }}>
            {inboundMappers.length === 0 ? (
              <option value="">— no inbound mappers —</option>
            ) : inboundMappers.map(m => (
              <option key={m.id} value={m.id}>{m.name} · {(window.mappers.parse(m.text).meta || {}).format}</option>
            ))}
          </select>
          <button className="btn" data-variant="ghost" data-size="xs"
            onClick={() => window.__navTo && window.__navTo('mappers')}>
            Edit mappers
          </button>
        </div>

        <textarea
          value={payload}
          onChange={e => { setPayload(e.target.value); setPreview(null); setResult(null); }}
          placeholder={meta && meta.format === 'csv'
            ? 'Paste CSV (with header row by default)…'
            : meta && meta.format === 'json'
            ? 'Paste JSON object or array…'
            : 'Pick a mapper above first.'}
          style={{
            width: '100%', minHeight: 160, padding: 8, fontSize: 11.5,
            fontFamily: 'var(--font-mono)', color: 'var(--ink-900)',
            border: '1px solid var(--line)', borderRadius: 4,
            background: 'var(--ivory-50)', resize: 'vertical', outline: 'none',
          }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span className="field-label">Attach to client</span>
          <select className="input" value={clientId || ''} onChange={e => setClientId(e.target.value || null)}
            style={{ height: 28, flex: 1, maxWidth: 260 }}>
            <option value="">— No client —</option>
            {clients.filter(c => c.active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" onClick={runPreview} disabled={!payload || !mapperRecord}>Preview</button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={ingest}
            disabled={!preview || !preview.rows || preview.rows.length === 0 || committing || !canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Ingest mapped rows', 'edit interfaces')}>
            {committing ? 'Ingesting…' : `Ingest ${preview && preview.rows ? preview.rows.length : 0} row(s)`}
          </button>
        </div>
      </div>

      <div style={{ padding: 14, maxHeight: 320, overflowY: 'auto' }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Mapped preview</div>
        {!preview ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
            Pick a mapper, paste data, click <strong>Preview</strong>. Each row maps to a Patient + Order + Tests via the script.
          </div>
        ) : preview.error ? (
          <div style={{ padding: 8, background: 'var(--rust-soft)', color: 'var(--err-700)', borderRadius: 4, fontSize: 12 }}>
            {preview.error}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-500)', marginBottom: 6 }}>
              {preview.rows.length} row(s) parsed
            </div>
            {preview.rows.slice(0, 5).map((row, i) => (
              <div key={i} style={{
                marginBottom: 8, padding: 8,
                background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 4,
                fontSize: 11.5,
              }}>
                {row.__errors && row.__errors.length > 0 && (
                  <div style={{ color: 'var(--err-700)', marginBottom: 4 }}>
                    {row.__errors.join(' · ')}
                  </div>
                )}
                {row.patient && (
                  <div><span style={{ color: 'var(--ink-400)' }}>patient</span>{' '}
                    <span className="mono">{row.patient.mrn || '—'}</span>{' '}
                    {row.patient.lastName}{row.patient.firstName ? ', ' + row.patient.firstName : ''}
                    {row.patient.dob && <span style={{ color: 'var(--ink-400)' }}> · {row.patient.dob}</span>}
                  </div>
                )}
                {row.order && (
                  <div><span style={{ color: 'var(--ink-400)' }}>order</span>{' '}
                    <span className="mono">{row.order.orderNumber || '—'}</span>{' '}
                    <span style={{ color: 'var(--ink-400)' }}>·</span> <PriorityPill p={row.order.priority || 'routine'}/>
                    <span style={{ color: 'var(--ink-400)', marginLeft: 6 }}>·</span> <span className="mono" style={{ marginLeft: 6 }}>{Array.isArray(row.order.testIds) ? row.order.testIds.join(' ') : (row.order.testIds || '—')}</span>
                  </div>
                )}
              </div>
            ))}
            {preview.rows.length > 5 && (
              <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>+ {preview.rows.length - 5} more</div>
            )}
            {result && (
              <div style={{
                marginTop: 8, padding: 8, fontSize: 12,
                background: result.errors.length === 0 ? 'var(--sage-50)' : 'var(--amber-soft)',
                color: result.errors.length === 0 ? 'var(--sage-900)' : 'var(--warn-700)',
                borderRadius: 4,
              }}>
                Created {result.created} order(s){result.errors.length > 0 && ` · ${result.errors.length} error(s): ${result.errors.slice(0,3).join('; ')}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── HL7 Intake — paste an ORM-O01 message, parse, ingest into the pipeline.
// Same downstream behavior as a drawer-created order (publishes order.created).
const Hl7IntakePanel = () => {
  const clients = window.useEntities('clients');
  const [text, setText] = useStateOS('');
  const [clientId, setClientId] = useStateOS(null);
  const [parsed, setParsed] = useStateOS(null);
  const [committing, setCommitting] = useStateOS(false);
  const [result, setResult] = useStateOS(null);
  const canEditInterfaces = hasPermission('EDIT_INTERFACES');

  const fillExample = () => {
    setText(window.hl7 && window.hl7.SAMPLE_ORM ? window.hl7.SAMPLE_ORM : '');
    setParsed(null);
    setResult(null);
  };
  const reset = () => {
    setText(''); setParsed(null); setResult(null); setClientId(null);
  };

  const parse = () => {
    if (!window.hl7) return;
    const out = window.hl7.parseORM(text);
    const check = validateHl7Intake(text, out);
    if (!check.ok) {
      out.errors = [...(out.errors || []), ...check.errors];
    }
    setParsed(out);
  };

  const ingest = async () => {
    if (!hasPermission('EDIT_INTERFACES')) return;
    if (!parsed || !parsed.patient || !parsed.order || parsed.tests.length === 0) return;
    const check = validateHl7Intake(text, parsed);
    if (!check.ok) {
      await safetyNotice({ tone: 'danger', title: 'HL7 ingest blocked', message: check.errors.slice(0, 4).join('; ') });
      return;
    }
    const ask = await safetyConfirm({
      id: 'interface.hl7_orm.ingest',
      tone: 'warning',
      title: 'Ingest HL7 order',
      message: 'This creates or updates patient, test, and order records from a pasted ORM message.',
      facts: [
        safetyFact('mrn', parsed.patient && parsed.patient.mrn),
        safetyFact('patient', [parsed.patient && parsed.patient.lastName, parsed.patient && parsed.patient.firstName].filter(Boolean).join(', ')),
        safetyFact('placer order', parsed.order && parsed.order.placerOrderNumber),
        safetyFact('filler order', parsed.order && parsed.order.fillerOrderNumber),
        safetyFact('tests', parsed.tests.map(t => t.code).join(', ')),
        safetyFact('bytes', check.bytes),
        safetyFact('client', clientId || 'none'),
      ],
      requireReason: true,
      reasonLabel: 'Ingest reason',
      reasonPlaceholder: 'source message / interface batch / operator note',
      entityType: 'interface',
      entityId: 'hl7-orm-intake',
      confirmLabel: 'Ingest order',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_INTERFACES')) return;
    const freshCheck = validateHl7Intake(text, parsed);
    if (!freshCheck.ok) {
      await safetyNotice({ tone: 'danger', title: 'HL7 ingest blocked', message: freshCheck.errors.slice(0, 4).join('; ') });
      return;
    }
    setCommitting(true);
    try {
      // 1. Resolve patient by MRN (or create)
      let patient = (await window.db.list('patients', p => p.mrn === parsed.patient.mrn))[0];
      if (!patient) {
        patient = window.schema.newPatient(parsed.patient);
        await window.db.put('patients', patient);
      }
      // 2. Resolve test catalogue entries by code (create stubs for missing)
      const testIds = [];
      for (const t of parsed.tests) {
        let test = (await window.db.list('tests', x => x.code === t.code))[0];
        if (!test) {
          test = window.schema.newTest({ code: t.code, name: t.name || t.code });
          await window.db.put('tests', test);
        }
        testIds.push(test.id);
      }
      // 3. Order — pull placer/filler if present, attach to selected client
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const allOrders = await window.db.list('orders');
      const todayCount = allOrders.filter(o => (o.orderedAt || o.createdAt || 0) >= todayStart.getTime()).length;
      const order = window.schema.newOrder({
        orderNumber: parsed.order.fillerOrderNumber || ('L' + new Date().toISOString().slice(0,10).replace(/-/g,'') + String(todayCount + 1).padStart(4, '0')),
        placerOrderNumber: parsed.order.placerOrderNumber || '',
        fillerOrderNumber: parsed.order.fillerOrderNumber || '',
        patientId: patient.id,
        clientId: clientId || null,
        priority: parsed.order.priority || 'routine',
        status: 'open',
        testIds,
        notes: parsed.order.placerOrderNumber ? `Placer order #: ${parsed.order.placerOrderNumber}` : '',
        providerId: parsed.order.orderingProvider || null,
        orderedAt: parsed.order.orderedAt || Date.now(),
        collectedAt: parsed.order.collectedAt || null,
        receivedAt: parsed.order.receivedAt || null,
      });
      await window.db.put('orders', order);
      window.events.publish(window.EVENTS.ORDER_CREATED, {
        entityType: 'order', entityId: order.id, order, patient,
        viaInterface: 'hl7-orm-intake',
      });
      // Log the inbound message so the Message Log surfaces this intake.
      // We resolve a partner by MSH (sendingApp/Facility) when possible; falls
      // back to the client's partnerId. Either way the row links to the
      // patient/order we created so the log can backlink.
      let hl7MessageId = null;
      try {
        const parsedHeader = window.hl7Mllp && window.hl7Mllp.parseHeader
          ? window.hl7Mllp.parseHeader(text) : null;
        let partner = null;
        if (parsedHeader) {
          const partners = await window.db.list('hl7_partners', p => p.active !== false);
          partner = partners.find(p =>
            (!p.partnerApp || p.partnerApp === parsedHeader.sendingApp) &&
            (!p.partnerFacility || p.partnerFacility === parsedHeader.sendingFacility)
          ) || null;
        }
        if (!partner && clientId) {
          const cli = await window.db.get('clients', clientId);
          if (cli && cli.partnerId) partner = await window.db.get('hl7_partners', cli.partnerId);
        }
        const msgRec = window.schema.newHl7Message({
          direction: 'inbound',
          partnerId: partner ? partner.id : null,
          controlId: parsedHeader ? parsedHeader.controlId : '',
          messageType: parsedHeader ? parsedHeader.messageType : 'ORM^O01',
          sendingApp:       parsedHeader ? parsedHeader.sendingApp : '',
          sendingFacility:  parsedHeader ? parsedHeader.sendingFacility : '',
          receivingApp:     parsedHeader ? parsedHeader.receivingApp : 'LATTICE',
          receivingFacility: parsedHeader ? parsedHeader.receivingFacility : 'MAIN',
          raw: text,
          status: 'accepted',
          attemptCount: 1,
          lastAttemptAt: Date.now(),
          ackCode: 'AA',
          orderId: order.id,
          patientId: patient.id,
        });
        await window.db.put('hl7_messages', msgRec);
        hl7MessageId = msgRec.id;
        if (partner) {
          await window.db.put('hl7_partners', { ...partner, lastSeenAt: Date.now(), updatedAt: Date.now() });
        }
      } catch (e) {
        console.warn('[hl7-intake] message log write failed', e);
      }
      setResult({ ok: true, orderId: order.id, orderNumber: order.orderNumber, patientMrn: patient.mrn, testCount: testIds.length, hl7MessageId });
    } catch (e) {
      console.error('[hl7-intake] ingest failed', e);
      setResult({ ok: false, error: e.message || String(e) });
    } finally {
      setCommitting(false);
    }
  };

  const canParse = text.trim().length > 0;
  const canIngest = parsed && parsed.patient && parsed.order && parsed.tests.length > 0 && (!parsed.errors || parsed.errors.length === 0);

  return (
    <div className="panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      <div style={{ padding: 14, borderRight: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>HL7 inbound · paste an ORM-O01</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={fillExample}>Sample</button>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={reset}>Clear</button>
        </div>
        <textarea
          value={text}
          onChange={e => { setText(e.target.value); setParsed(null); setResult(null); }}
          placeholder={`MSH|^~\\&|EMR|CLINIC|LATTICE|MAIN|${(new Date()).getFullYear()}...|||ORM^O01|...|P|2.5\nPID|1||MRN-789012^^^MRN||Doe^Jane^A||19850412|F\nORC|NW|EMR-ORD-789|...\nOBR|1|EMR-ORD-789||GLU^Glucose^L|R|...`}
          style={{
            width: '100%', minHeight: 180,
            padding: 8, fontSize: 11.5,
            fontFamily: 'var(--font-mono)', color: 'var(--ink-900)',
            border: '1px solid var(--line)', borderRadius: 4,
            background: 'var(--ivory-50)', resize: 'vertical', outline: 'none',
          }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span className="field-label">Attach to client</span>
          <select className="input" value={clientId || ''} onChange={e => setClientId(e.target.value || null)}
            style={{ height: 28, flex: 1, maxWidth: 280 }}>
            <option value="">— No client —</option>
            {clients.filter(c => c.active !== false).map(c => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" onClick={parse} disabled={!canParse}>Parse</button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={ingest}
            disabled={!canIngest || committing || !canEditInterfaces}
            title={permissionTitle(canEditInterfaces, 'Ingest HL7 order', 'edit interfaces')}>
            {committing ? 'Ingesting…' : 'Ingest order'}
          </button>
        </div>
      </div>

      <div style={{ padding: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 8 }}>Parser preview</div>
        {!parsed ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>
            Paste an HL7 ORM-O01 message and click Parse. The parsed entities preview here; click Ingest order to create them in the system.
          </div>
        ) : (
          <div style={{ fontSize: 12 }}>
            {parsed.errors.length > 0 && (
              <div style={{ padding: 8, background: 'var(--rust-soft)', color: 'var(--err-700)', borderRadius: 4, marginBottom: 8, fontSize: 11.5 }}>
                {parsed.errors.join(' · ')}
              </div>
            )}
            <div style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Patient</div>
              {parsed.patient ? (
                <div>
                  <span className="mono">{parsed.patient.mrn}</span>{' '}
                  {parsed.patient.lastName}{parsed.patient.firstName ? ', ' + parsed.patient.firstName : ''}
                  {parsed.patient.dob && <span style={{ marginLeft: 8, color: 'var(--ink-400)' }}>DOB {parsed.patient.dob}</span>}
                  {parsed.patient.sex && <span style={{ marginLeft: 8, color: 'var(--ink-400)' }}>{parsed.patient.sex}</span>}
                </div>
              ) : <span style={{ color: 'var(--ink-400)' }}>—</span>}
            </div>
            <div style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Order</div>
              {parsed.order ? (
                <div>
                  <span style={{ color: 'var(--ink-400)' }}>placer</span> <span className="mono">{parsed.order.placerOrderNumber || '—'}</span>
                  <span style={{ marginLeft: 12, color: 'var(--ink-400)' }}>filler</span> <span className="mono">{parsed.order.fillerOrderNumber || '—'}</span>
                  <span style={{ marginLeft: 12 }}><PriorityPill p={parsed.order.priority}/></span>
                  {parsed.order.orderingProvider && <span style={{ marginLeft: 12, color: 'var(--ink-500)' }}>{parsed.order.orderingProvider}</span>}
                </div>
              ) : <span style={{ color: 'var(--ink-400)' }}>—</span>}
            </div>
            <div>
              <div className="section-title" style={{ fontSize: 9.5, marginBottom: 4 }}>Tests ({parsed.tests.length})</div>
              {parsed.tests.length === 0 ? <span style={{ color: 'var(--ink-400)' }}>—</span> : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {parsed.tests.map((t, i) => (
                    <span key={i} className="pill" data-tone="ghost" style={{ height: 22, padding: '0 8px' }}>
                      <span className="mono">{t.code}</span>
                      {t.name && <span style={{ marginLeft: 6 }}>{t.name}</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {result && (
              <div style={{
                padding: 10, marginTop: 10, fontSize: 12,
                background: result.ok ? 'var(--sage-50)' : 'var(--rust-soft)',
                color: result.ok ? 'var(--sage-900)' : 'var(--err-700)',
                borderRadius: 4,
              }}>
                {result.ok ? (
                  <>Created order <span className="mono">{result.orderNumber}</span> for MRN <span className="mono">{result.patientMrn}</span> with {result.testCount} test{result.testCount === 1 ? '' : 's'}.</>
                ) : (
                  <>Failed: {result.error}</>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ===== HL7 Partners — logical EMR/LIS counterparties =====
//
// One partner row per upstream organization (Athena tenant, Harvest reference
// lab, Epic hospital, etc.). Distinct from the wire-level Interfaces page:
// here you declare *who* you're exchanging messages with and what kind, not
// *how* the bytes get there. The transport facade (hl7-transport.js) reads
// these rows to route outbound messages and resolve inbound senders by MSH.
const PARTNER_TRANSPORTS = ['loopback', 'mllp', 'http', 'sftp'];
const PARTNER_ACK_MODES  = ['sync', 'async', 'none'];
const PARTNER_TYPES = ['ORM^O01', 'ORU^R01', 'ADT^A04', 'ADT^A08', 'ADT^A31', 'ACK^R01', 'ORR^O02', 'QRY^A19'];

const PartnerVendorPill = ({ vendor }) => {
  if (!vendor) return <span className="pill" data-tone="ghost">—</span>;
  const TONE = { athena: 'info', harvest: 'sage', epic: 'amber', cerner: 'rust', generic: 'ghost' };
  return <span className="pill" data-tone={TONE[vendor] || 'ghost'}>{vendor}</span>;
};

const PartnersPage = ({ onBack }) => {
  const partners = window.useEntities('hl7_partners');
  const canEdit = hasPermission('EDIT_INTERFACES');
  const [q, setQ] = useStateOS('');
  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [savedFlash, setSavedFlash] = useStateOS(null);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...partners]
      .filter(p => !needle || [p.name, p.vendor, p.partnerApp, p.partnerFacility, p.endpoint].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [partners, q]);
  const pager = usePagination(filtered);

  const startNew = () => {
    if (!canEdit) return;
    setEditingId(null);
    setDraft(window.schema.newHl7Partner({ name: 'New partner', vendor: 'generic', active: false }));
  };
  const startEdit = (p) => { if (!canEdit) return; setEditingId(p.id); setDraft({ ...p }); };
  const cancel = () => { setEditingId(null); setDraft(null); };

  const save = async () => {
    if (!canEdit || !draft) return;
    const id = draft.id;
    const existing = await window.db.get('hl7_partners', id);
    const next = { ...(existing || {}), ...draft, updatedAt: Date.now() };
    if (!existing) next.createdAt = next.createdAt || Date.now();
    await window.db.put('hl7_partners', next);
    setSavedFlash(next.id);
    setTimeout(() => setSavedFlash(null), 1200);
    cancel();
  };

  const remove = async (p) => {
    if (!canEdit) return;
    const ask = await safetyConfirm({
      id: 'admin.partner.delete',
      tone: 'danger',
      title: 'Delete HL7 partner',
      message: 'This removes the partner record. Existing message log rows linked to this partner stay (with a null partnerId).',
      facts: [
        safetyFact('partner', p.name),
        safetyFact('vendor', p.vendor || '-'),
        safetyFact('transport', p.transport || '-'),
        safetyFact('active', p.active === false ? 'no' : 'yes'),
      ],
      entityType: 'hl7_partner',
      entityId: p.id,
      confirmLabel: 'Delete partner',
    });
    if (!ask.confirmed) return;
    await window.db.delete('hl7_partners', p.id);
    if (editingId === p.id) cancel();
  };

  const toggleActive = async (p) => {
    if (!canEdit) return;
    await window.db.put('hl7_partners', { ...p, active: p.active === false, updatedAt: Date.now() });
  };

  const sendTest = async (p) => {
    if (!canEdit) return;
    if (!window.hl7Transport || !window.hl7) return;
    // Minimal ORU^R01 with synthetic fields — enough to exercise the
    // outbound path and produce a row in the Message Log. Real release
    // events still drive the real path; this button only verifies wiring.
    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const ctl = 'TEST' + ts;
    const raw = [
      `MSH|^~\\&|${p.sendingApp || 'LATTICE'}|${p.sendingFacility || 'MAIN'}|${p.partnerApp || ''}|${p.partnerFacility || ''}|${ts}||ORU^R01|${ctl}|P|2.5`,
      'PID|1||TEST-MRN||Test^Patient||19700101|U',
      `OBR|1|TEST-ORD|TEST-FILLER|GLU^Glucose^L|R|${ts}`,
      'OBX|1|NM|GLU^Glucose^L||95|mg/dL|70-99|N|||F',
    ].join('\r');
    const out = await window.hl7Transport.send(p.id, raw, { messageType: 'ORU^R01' });
    setSavedFlash(p.id + (out.ok ? ':ok' : ':fail'));
    setTimeout(() => setSavedFlash(null), 1500);
  };

  const setDraftField = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  const toggleType = (which, t) => {
    setDraft(d => {
      const arr = Array.isArray(d[which]) ? [...d[which]] : [];
      const i = arr.indexOf(t);
      if (i >= 0) arr.splice(i, 1); else arr.push(t);
      return { ...d, [which]: arr };
    });
  };

  return (
    <Page label="HL7 Partners">
      <PageHeader title="HL7 Partners" sub="EMR / LIS counterparties — Athena, Harvest, Epic, Cerner, …"
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []),
          <button key="n" className="btn" data-size="sm" data-variant="primary"
            onClick={startNew} disabled={!canEdit}
            title={permissionTitle(canEdit, 'Add HL7 partner', 'edit interfaces')}><IconPlus size={13}/> Add partner</button>,
        ]}/>

      <div className="panel" style={{ marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search partners…"
            style={{ width: 260, height: 28 }}/>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {partners.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['Partner', 'Vendor', 'Sender ↔ Receiver', 'Transport', 'Endpoint', 'Last seen', 'Status']}
              message="No partners configured"
              sub="Run seed.demo() to populate presets (Athena, Harvest, Epic, Cerner, Generic) — or add one above."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>Partner</th><th>Vendor</th><th>Sender ↔ Receiver</th><th>Transport</th><th>Endpoint</th><th>Last seen</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(p => (
                  <tr key={p.id} style={{ opacity: p.active === false ? 0.55 : 1, background: editingId === p.id ? 'var(--sage-50)' : undefined }}>
                    <td><span style={{ fontWeight: 500 }}>{p.name || '—'}</span></td>
                    <td><PartnerVendorPill vendor={p.vendor}/></td>
                    <td>
                      <span className="mono" style={{ color: 'var(--ink-500)', fontSize: 11.5 }}>
                        {(p.sendingApp || '?') + '|' + (p.sendingFacility || '?')}
                        {' → '}
                        {(p.partnerApp || '?') + '|' + (p.partnerFacility || '?')}
                      </span>
                    </td>
                    <td><span className="pill" data-tone="ghost">{p.transport || '—'}</span></td>
                    <td><span className="mono" style={{ color: 'var(--ink-500)', fontSize: 11.5 }}>{p.endpoint || '—'}</span></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)', fontSize: 11.5 }}>{formatDateTime(p.lastSeenAt)}</span></td>
                    <td>
                      <span className="pill" data-tone={p.active === false ? 'ghost' : 'sage'}>
                        {p.active === false ? 'inactive' : 'active'}
                      </span>
                      {savedFlash === (p.id + ':ok') && <span className="pill" data-tone="sage" style={{ marginLeft: 6 }}>sent ✓</span>}
                      {savedFlash === (p.id + ':fail') && <span className="pill" data-tone="rust" style={{ marginLeft: 6 }}>send failed</span>}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn" data-size="xs" data-variant="ghost" onClick={() => sendTest(p)}
                        disabled={!canEdit || p.active === false}
                        title={p.active === false ? 'Activate partner first' : 'Send a synthetic ORU^R01 to this partner'}>
                        Send test
                      </button>
                      <button className="btn" data-size="xs" data-variant="ghost" onClick={() => toggleActive(p)}
                        disabled={!canEdit}>{p.active === false ? 'Activate' : 'Deactivate'}</button>
                      <button className="btn" data-size="xs" data-variant="ghost" onClick={() => startEdit(p)} disabled={!canEdit}>Edit</button>
                      <button className="btn" data-size="xs" data-variant="ghost" onClick={() => remove(p)} disabled={!canEdit}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>

      {draft && (
        <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? 'Edit partner' : 'New partner'}</span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={cancel}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!draft.name}>Save</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <div>
              <div className="field-label">Name</div>
              <input className="input" value={draft.name || ''} onChange={e => setDraftField('name', e.target.value)} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Vendor</div>
              <select className="input" value={draft.vendor || 'generic'} onChange={e => setDraftField('vendor', e.target.value)} style={{ width: '100%' }}>
                {['athena', 'harvest', 'epic', 'cerner', 'generic'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Our sending app (MSH-3)</div>
              <input className="input" value={draft.sendingApp || ''} onChange={e => setDraftField('sendingApp', e.target.value)} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Our sending facility (MSH-4)</div>
              <input className="input" value={draft.sendingFacility || ''} onChange={e => setDraftField('sendingFacility', e.target.value)} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Partner app (their MSH-3 inbound; MSH-5 outbound)</div>
              <input className="input" value={draft.partnerApp || ''} onChange={e => setDraftField('partnerApp', e.target.value)} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Partner facility (their MSH-4 inbound; MSH-6 outbound)</div>
              <input className="input" value={draft.partnerFacility || ''} onChange={e => setDraftField('partnerFacility', e.target.value)} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">Transport</div>
              <select className="input" value={draft.transport || 'loopback'} onChange={e => setDraftField('transport', e.target.value)} style={{ width: '100%' }}>
                {PARTNER_TRANSPORTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Endpoint (host:port, URL, path — opaque to facade)</div>
              <input className="input" value={draft.endpoint || ''} onChange={e => setDraftField('endpoint', e.target.value)} style={{ width: '100%' }}/>
            </div>
            <div>
              <div className="field-label">ACK mode</div>
              <select className="input" value={draft.ackMode || 'sync'} onChange={e => setDraftField('ackMode', e.target.value)} style={{ width: '100%' }}>
                {PARTNER_ACK_MODES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Active</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-700)' }}>
                <input type="checkbox" checked={draft.active !== false} onChange={e => setDraftField('active', e.target.checked)}/>
                Partner can send/receive messages
              </label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Inbound message types we accept</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PARTNER_TYPES.map(t => {
                  const on = (draft.inboundTypes || []).includes(t);
                  return (
                    <button key={t} type="button"
                      onClick={() => toggleType('inboundTypes', t)}
                      className="pill" data-tone={on ? 'sage' : 'ghost'}
                      style={{ height: 22, padding: '0 8px', cursor: 'pointer', border: '1px solid var(--line)' }}>
                      <span className="mono">{t}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Outbound message types we send</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PARTNER_TYPES.map(t => {
                  const on = (draft.outboundTypes || []).includes(t);
                  return (
                    <button key={t} type="button"
                      onClick={() => toggleType('outboundTypes', t)}
                      className="pill" data-tone={on ? 'sage' : 'ghost'}
                      style={{ height: 22, padding: '0 8px', cursor: 'pointer', border: '1px solid var(--line)' }}>
                      <span className="mono">{t}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="field-label">Notes (operator-facing)</div>
              <textarea
                value={draft.notes || ''} onChange={e => setDraftField('notes', e.target.value)}
                rows={2}
                style={{ width: '100%', padding: 8, fontSize: 12.5, fontFamily: 'inherit', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--ivory-50)', resize: 'vertical', outline: 'none' }}/>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
};

// ===== HL7 Message Log =====
// Wire-level audit log: one row per message in or out. Lists newest first;
// click a row to expand the raw payload + ACK details. Re-send is available
// on failed outbound rows (re-queues through the same transport handler).
const MSG_DIRECTIONS = ['all', 'inbound', 'outbound'];
const MSG_STATUSES_OUT = ['queued', 'sending', 'acked', 'nakked', 'timed-out', 'failed'];
const MSG_STATUSES_IN  = ['received', 'accepted', 'rejected', 'errored'];

const MessageStatusPill = ({ status }) => {
  const tone =
    status === 'acked' || status === 'accepted' ? 'sage' :
    status === 'queued' || status === 'sending' || status === 'received' ? 'info' :
    status === 'nakked' || status === 'rejected' ? 'amber' :
    status === 'failed' || status === 'errored' || status === 'timed-out' ? 'rust' : 'ghost';
  return <span className="pill" data-tone={tone}>{status || '—'}</span>;
};

const MessageLogPage = ({ onBack }) => {
  const messages = window.useEntities('hl7_messages');
  const partners = window.useEntities('hl7_partners');
  const canEdit = hasPermission('EDIT_INTERFACES');
  const [direction, setDirection] = useStateOS('all');
  const [statusFilter, setStatusFilter] = useStateOS('');
  const [partnerFilter, setPartnerFilter] = useStateOS('');
  const [q, setQ] = useStateOS('');
  const [expandedId, setExpandedId] = useStateOS(null);
  const [resendFlash, setResendFlash] = useStateOS(null);

  const partnerById = useMemoOS(() => Object.fromEntries(partners.map(p => [p.id, p])), [partners]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...messages]
      .filter(m => direction === 'all' ? true : m.direction === direction)
      .filter(m => !statusFilter || m.status === statusFilter)
      .filter(m => !partnerFilter || m.partnerId === partnerFilter)
      .filter(m => !needle || [m.controlId, m.messageType, m.sendingApp, m.sendingFacility, m.errorReason, m.raw].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [messages, direction, statusFilter, partnerFilter, q]);
  const pager = usePagination(filtered);

  const counts = useMemoOS(() => ({
    inbound:  messages.filter(m => m.direction === 'inbound').length,
    outbound: messages.filter(m => m.direction === 'outbound').length,
    acked:    messages.filter(m => m.status === 'acked' || m.status === 'accepted').length,
    failed:   messages.filter(m => ['failed', 'errored', 'nakked', 'rejected', 'timed-out'].includes(m.status)).length,
  }), [messages]);

  const statusOptions = direction === 'inbound' ? MSG_STATUSES_IN
                      : direction === 'outbound' ? MSG_STATUSES_OUT
                      : [...MSG_STATUSES_OUT, ...MSG_STATUSES_IN];

  const resend = async (m) => {
    if (!canEdit) return;
    if (m.direction !== 'outbound') return;
    if (!window.hl7Transport) return;
    const out = await window.hl7Transport.send(m.partnerId, m.raw, {
      messageType: m.messageType,
      orderId: m.orderId, resultId: m.resultId, patientId: m.patientId,
    });
    setResendFlash(m.id + ':' + (out.ok ? 'ok' : 'fail'));
    setTimeout(() => setResendFlash(null), 1500);
  };

  return (
    <Page label="HL7 Message Log">
      <PageHeader title="HL7 Message Log" sub="Every HL7 message we sent or received — wire-level audit & replay."
        actions={onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []}/>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
        <KpiPanel label="Inbound" value={counts.inbound}/>
        <KpiPanel label="Outbound" value={counts.outbound}/>
        <KpiPanel label="ACKed / Accepted" value={counts.acked}/>
        <KpiPanel label="Failed / NAKked" value={counts.failed} tone={counts.failed > 0 ? 'rust' : null}/>
      </div>

      <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {MSG_DIRECTIONS.map(d => (
              <button key={d} className="btn" data-size="xs"
                data-variant={direction === d ? 'primary' : 'ghost'}
                onClick={() => { setDirection(d); setStatusFilter(''); }}>{d}</button>
            ))}
          </div>
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ height: 28 }}>
            <option value="">All statuses</option>
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="input" value={partnerFilter} onChange={e => setPartnerFilter(e.target.value)} style={{ height: 28 }}>
            <option value="">All partners</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search control id / type / raw…"
            style={{ height: 28, flex: 1, minWidth: 220 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} of {messages.length}</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {filtered.length === 0 ? (
            <EmptyTable
              columns={['When', 'Direction', 'Partner', 'Type', 'Control ID', 'Status']}
              message="No HL7 messages logged yet"
              sub="Once a result releases (outbound ORU^R01) or you paste a message in the HL7 Intake panel (inbound ORM^O01), it shows here."/>
          ) : (
            <table className="tbl">
              <thead><tr><th>When</th><th>Dir</th><th>Partner</th><th>Type</th><th>Control ID</th><th>Status</th><th>ACK</th><th></th></tr></thead>
              <tbody>
                {pager.slice.map(m => {
                  const partner = partnerById[m.partnerId];
                  const isExpanded = expandedId === m.id;
                  return (
                    <React.Fragment key={m.id}>
                      <tr onClick={() => setExpandedId(isExpanded ? null : m.id)} style={{ cursor: 'pointer', background: isExpanded ? 'var(--ivory-100)' : undefined }}>
                        <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{formatDateTime(m.createdAt)}</span></td>
                        <td><span className="pill" data-tone={m.direction === 'inbound' ? 'info' : 'ghost'}>{m.direction === 'inbound' ? '↓ in' : '↑ out'}</span></td>
                        <td>{partner ? partner.name : <span style={{ color: 'var(--ink-400)' }}>—</span>}</td>
                        <td><span className="mono" style={{ fontSize: 11.5 }}>{m.messageType || '—'}</span></td>
                        <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{m.controlId || '—'}</span></td>
                        <td><MessageStatusPill status={m.status}/></td>
                        <td>{m.ackCode ? <span className="pill" data-tone={m.ackCode === 'AA' ? 'sage' : 'rust'}>{m.ackCode}</span> : <span style={{ color: 'var(--ink-300)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {m.direction === 'outbound' && ['failed', 'nakked', 'timed-out', 'errored'].includes(m.status) && (
                            <button className="btn" data-size="xs" data-variant="ghost"
                              onClick={e => { e.stopPropagation(); resend(m); }}
                              disabled={!canEdit || !m.partnerId}
                              title={!m.partnerId ? 'No partner — cannot re-send' : 'Re-queue through the same transport'}>
                              {resendFlash === (m.id + ':ok') ? 'Sent ✓' : resendFlash === (m.id + ':fail') ? 'Failed' : 'Re-send'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={8} style={{ background: 'var(--ivory-50)', padding: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                              <div>
                                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Routing</div>
                                <div style={{ fontSize: 12, color: 'var(--ink-700)', display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 3 }}>
                                  <span style={{ color: 'var(--ink-400)' }}>Sender</span><span className="mono">{(m.sendingApp || '—') + ' | ' + (m.sendingFacility || '—')}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Receiver</span><span className="mono">{(m.receivingApp || '—') + ' | ' + (m.receivingFacility || '—')}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Partner</span><span>{partner ? partner.name : '(unassigned)'}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Attempts</span><span>{m.attemptCount || 0}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Last attempt</span><span className="mono">{formatDateTime(m.lastAttemptAt)}</span>
                                  {m.errorReason ? <><span style={{ color: 'var(--ink-400)' }}>Error</span><span style={{ color: 'var(--err-700)' }}>{m.errorReason}</span></> : null}
                                </div>
                              </div>
                              <div>
                                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Linked records</div>
                                <div style={{ fontSize: 12, color: 'var(--ink-700)', display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 3 }}>
                                  <span style={{ color: 'var(--ink-400)' }}>Order</span><span className="mono">{m.orderId || '—'}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Result</span><span className="mono">{m.resultId || '—'}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>Patient</span><span className="mono">{m.patientId || '—'}</span>
                                  <span style={{ color: 'var(--ink-400)' }}>ACK ctrl</span><span className="mono">{m.ackControlId || '—'}</span>
                                </div>
                              </div>
                            </div>
                            <div style={{ marginTop: 12 }}>
                              <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Raw HL7</div>
                              <pre style={{
                                margin: 0, padding: 10, background: '#fff',
                                border: '1px solid var(--line)', borderRadius: 4,
                                fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--ink-900)',
                                whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflowY: 'auto',
                              }}>{m.raw || '(empty)'}</pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>
    </Page>
  );
};

// Expose for app.jsx routing.
Object.assign(window, { PartnersPage, MessageLogPage });

