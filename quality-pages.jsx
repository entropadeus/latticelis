const LeveyJenningsChart = ({ results }) => {
  const W = 740, H = 240, P_L = 28, P_R = 12, P_T = 14, P_B = 22;
  const innerW = W - P_L - P_R;
  const innerH = H - P_T - P_B;
  const Z_RANGE = 4;            // y axis: -4..+4 SD
  const yToPx = (z) => P_T + innerH * (1 - (z + Z_RANGE) / (2 * Z_RANGE));

  const n = results.length;
  if (n === 0) return null;
  const xToPx = (i) => P_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const bands = [
    { z: 3, color: 'var(--rust-soft)' },
    { z: 2, color: 'var(--amber-soft)' },
    { z: 1, color: 'var(--sage-100)' },
  ];

  const points = results.map((r, i) => ({
    x: xToPx(i),
    y: yToPx(Math.max(-Z_RANGE, Math.min(Z_RANGE, r.zScore || 0))),
    z: r.zScore,
    status: r.status,
    id: r.id,
    ranAt: r.ranAt,
    flagged: Math.abs(r.zScore || 0) > Z_RANGE,
  }));

  const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ');

  // Bulletproof responsive-SVG pattern: a wrapping div whose padding-bottom
  // percentage is height/width, giving it a real computed height proportional
  // to its width. The SVG then absolutely fills that div. This sidesteps the
  // chromium quirk where `height: auto` on inline SVG with viewBox can resolve
  // to 0, which silently kills the chart panel.
  return (
    <div style={{ position: 'relative', width: '100%', paddingBottom: ((H / W) * 100).toFixed(4) + '%' }}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', font: '10px var(--font-mono)' }}>
      {/* Bands (drawn from outermost to innermost so the centre is the lightest tint) */}
      {bands.map(b => (
        <rect key={b.z}
          x={P_L} y={yToPx(b.z)} width={innerW} height={yToPx(-b.z) - yToPx(b.z)}
          fill={b.color} opacity={0.35}/>
      ))}
      {/* Gridlines at ±1/2/3 SD */}
      {[3, 2, 1, 0, -1, -2, -3].map(z => (
        <g key={z}>
          <line x1={P_L} y1={yToPx(z)} x2={W - P_R} y2={yToPx(z)}
            stroke={z === 0 ? 'var(--ink-500)' : 'var(--line)'}
            strokeWidth={z === 0 ? 1.5 : 1}
            strokeDasharray={z === 0 ? '' : (Math.abs(z) === 3 ? '4,3' : '2,3')}/>
          <text x={P_L - 6} y={yToPx(z) + 3} textAnchor="end" fill="var(--ink-400)">
            {z > 0 ? '+' : ''}{z}
          </text>
        </g>
      ))}
      {/* Connecting line */}
      <path d={linePath} fill="none" stroke="var(--ink-300)" strokeWidth={1.2}/>
      {/* Points */}
      {points.map(p => {
        const fill = p.status === 'out_of_control' ? 'var(--rust)'
          : p.status === 'warn' ? 'var(--amber)'
          : p.status === 'in_control' ? 'var(--sage-700)'
          : 'var(--ink-400)';
        return (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={p.flagged ? 5 : 3.5} fill={fill}
              stroke="#fff" strokeWidth={1.2}>
              <title>{`${(p.z != null ? p.z.toFixed(2) : '—')} SD · ${p.status} · ${new Date(p.ranAt).toISOString().slice(0,16).replace('T',' ')}`}</title>
            </circle>
          </g>
        );
      })}
      {/* X-axis labels: first / last */}
      {n > 0 && (
        <>
          <text x={P_L} y={H - 6} textAnchor="start" fill="var(--ink-400)">
            {new Date(points[0].ranAt).toISOString().slice(5,16).replace('T',' ')}
          </text>
          {n > 1 && (
            <text x={W - P_R} y={H - 6} textAnchor="end" fill="var(--ink-400)">
              {new Date(points[n - 1].ranAt).toISOString().slice(5,16).replace('T',' ')}
            </text>
          )}
        </>
      )}
    </svg>
    </div>
  );
};

// Each rule's purpose, in plain language, so operators can decide what to disable.
// Sources: Westgard JO. Multi-rule QC procedures. CLSI EP23-Ed2.
// Display-friendly number: rounds to 2 decimals AND drops trailing zeros so
// 4.833333333333333 → 4.83, but 15 stays 15 and 4.5 stays 4.5. Float values
// in QC means/SDs come from upstream calculation (mean of a numeric panel
// or a fraction like 5/6) and would otherwise leak 16-digit precision noise.
const fmtQcNum = (n) => {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return parseFloat(num.toFixed(2)).toString();
};

const WESTGARD_RULE_INFO = {
  '1-2s': { severity: 'warn',   summary: 'One control >2 SD. Warning, not rejection.', advisory: true },
  '1-3s': { severity: 'reject', summary: 'One control >3 SD. Rejection.',                advisory: false },
  '2-2s': { severity: 'reject', summary: 'Two consecutive same-side, both >2 SD.',       advisory: false },
  'R-4s': { severity: 'reject', summary: 'Two consecutive span >4 SD (range rule).',     advisory: false },
  '4-1s': { severity: 'reject', summary: 'Four consecutive same-side, all >1 SD.',       advisory: false },
  '10-x': { severity: 'reject', summary: 'Ten consecutive same-side of mean. No SD.',    advisory: false },
};

// Westgard rule selection — toggle which of the 6 classic rules fire violations
// at this installation. Persists to the singleton `lab_config` row. Defaults
// to all rules enabled (qcDisabledRules = []).
const WestgardRulesPanel = () => {
  const cfg = window.useEntity('lab_config', window.schema.LAB_CONFIG_ID);
  const canEditLabConfig = hasPermission('EDIT_LAB_CONFIG');
  const disabledSet = useMemoOS(
    () => new Set((cfg && Array.isArray(cfg.qcDisabledRules)) ? cfg.qcDisabledRules : []),
    [cfg]
  );
  const ruleIds = window.westgard ? window.westgard.RULES : Object.keys(WESTGARD_RULE_INFO);

  const toggle = async (ruleId) => {
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const currentlyEnabled = !disabledSet.has(ruleId);
    const nextEnabled = !currentlyEnabled;
    const info = WESTGARD_RULE_INFO[ruleId] || { severity: 'reject', summary: '' };
    const ask = await confirmConfigChange({
      id: nextEnabled ? 'qc.westgard_rule.enable' : 'qc.westgard_rule.disable',
      tone: nextEnabled ? 'warning' : 'danger',
      title: nextEnabled ? 'Enable Westgard rule' : 'Disable Westgard rule',
      message: nextEnabled
        ? 'This rule will create future QC violations and may block result release.'
        : 'This stops this Westgard rule from creating future QC violations and lockouts.',
      facts: [
        safetyFact('rule', ruleId),
        safetyFact('severity', info.severity),
        safetyFact('impact', info.summary),
        safetyFact('next state', nextEnabled ? 'enabled' : 'disabled'),
      ],
      entityType: 'lab_config',
      entityId: window.schema.LAB_CONFIG_ID,
      confirmLabel: nextEnabled ? 'Enable rule' : 'Disable rule',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_LAB_CONFIG')) return;
    const next = new Set(disabledSet);
    if (next.has(ruleId)) next.delete(ruleId);
    else next.add(ruleId);
    const fresh = await window.db.get('lab_config', window.schema.LAB_CONFIG_ID);
    const merged = window.schema.newLabConfig({
      ...(fresh || cfg || {}),
      qcDisabledRules: Array.from(next),
    });
    await window.db.put('lab_config', merged);
  };

  const enabledCount = ruleIds.length - disabledSet.size;

  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span className="section-title" style={{ fontSize: 9.5 }}>Westgard rules — installation</span>
        <span style={{ flex: 1 }}/>
        <span className="pill" data-tone={enabledCount === ruleIds.length ? 'sage' : 'amber'} style={{ fontSize: 10 }}>
          {enabledCount} of {ruleIds.length} enabled
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {ruleIds.map(id => {
          const info = WESTGARD_RULE_INFO[id] || { severity: 'reject', summary: '', advisory: false };
          const enabled = !disabledSet.has(id);
          return (
            <label key={id} title={permissionTitle(canEditLabConfig, info.summary, 'edit lab configuration')}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: '6px 8px',
                background: enabled ? '#fff' : 'var(--ivory-100)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                cursor: canEditLabConfig ? 'pointer' : 'not-allowed',
                opacity: !canEditLabConfig ? 0.5 : (enabled ? 1 : 0.7),
              }}>
              <input type="checkbox" checked={enabled} disabled={!canEditLabConfig} onChange={() => toggle(id)} style={{ marginTop: 2 }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 500 }}>{id}</span>
                  <span className="pill" data-tone={info.severity === 'reject' ? 'rust' : 'amber'} style={{ fontSize: 9.5 }}>
                    {info.severity}
                  </span>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 2 }}>{info.summary}</div>
              </div>
            </label>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--ink-400)' }}>
        Disabled rules don't fire violations on new QC results. Existing violations are preserved — clear them via the Acknowledge button on the level's violations table. Some labs disable 1-2s as advisory-only.
      </div>
    </div>
  );
};

const QcPage = ({ onBack }) => {
  const tests = window.useEntities('tests');
  const instruments = window.useEntities('instruments');
  const levels = window.useEntities('qc_levels');
  const allResults = window.useEntities('qc_results');
  const allViolations = window.useEntities('qc_violations');

  const [activeLevelId, setActiveLevelId] = useStateOS(null);
  const [levelDraft, setLevelDraft] = useStateOS(null); // editing/new
  const [entryValue, setEntryValue] = useStateOS('');
  const [entryInstrumentId, setEntryInstrumentId] = useStateOS('');
  const [chartInstrumentId, setChartInstrumentId] = useStateOS('__all');
  const canResolveQc = hasPermission('RESOLVE_QC');

  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  const instrumentById = useMemoOS(() => Object.fromEntries(instruments.map(i => [i.id, i])), [instruments]);
  const activeLevel = activeLevelId ? levels.find(l => l.id === activeLevelId) : null;

  const levelResults = useMemoOS(() => {
    if (!activeLevel) return [];
    return allResults
      .filter(r => r.qcLevelId === activeLevel.id)
      .filter(r => chartInstrumentId === '__all'
        || (chartInstrumentId === '__none' ? !r.instrumentId : r.instrumentId === chartInstrumentId))
      .sort((a, b) => (b.ranAt || 0) - (a.ranAt || 0))
      .slice(0, 30);
  }, [allResults, activeLevel, chartInstrumentId]);

  const levelViolations = useMemoOS(() => {
    if (!activeLevel) return [];
    return allViolations
      .filter(v => v.qcLevelId === activeLevel.id)
      .filter(v => chartInstrumentId === '__all'
        || (chartInstrumentId === '__none' ? !v.instrumentId : v.instrumentId === chartInstrumentId))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 20);
  }, [allViolations, activeLevel, chartInstrumentId]);

  const instrumentOptions = useMemoOS(() => {
    const ids = new Set();
    if (activeLevel && activeLevel.instrumentId) ids.add(activeLevel.instrumentId);
    allResults.filter(r => activeLevel && r.qcLevelId === activeLevel.id && r.instrumentId).forEach(r => ids.add(r.instrumentId));
    allViolations.filter(v => activeLevel && v.qcLevelId === activeLevel.id && v.instrumentId).forEach(v => ids.add(v.instrumentId));
    return [...ids].sort();
  }, [activeLevel, allResults, allViolations]);

  useEffectOS(() => { setChartInstrumentId('__all'); }, [activeLevelId]);

  const startNewLevel = () => {
    if (!hasPermission('RESOLVE_QC')) return;
    setLevelDraft({ testId: '', level: 'L1', material: '', lotNumber: '', lotExpiresAt: '', mean: '', sd: '', units: '', active: true });
  };
  const startEditLevel = (l) => {
    if (!hasPermission('RESOLVE_QC')) return;
    setLevelDraft({ id: l.id, testId: l.testId || '', level: l.level || 'L1', material: l.material || '',
      lotNumber: l.lotNumber || '',
      lotExpiresAt: l.lotExpiresAt ? new Date(l.lotExpiresAt).toISOString().slice(0, 10) : '',
      mean: l.mean == null ? '' : l.mean, sd: l.sd == null ? '' : l.sd,
      units: l.units || '', active: l.active !== false });
  };
  const cancelLevel = () => setLevelDraft(null);
  const saveLevel = async () => {
    if (!hasPermission('RESOLVE_QC')) return;
    if (!levelDraft || !levelDraft.testId || levelDraft.mean === '' || levelDraft.sd === '') return;
    // Convert YYYY-MM-DD date to epoch ms (end of day local) — matches what schema expects.
    const lotExpiresAt = levelDraft.lotExpiresAt
      ? (new Date(levelDraft.lotExpiresAt + 'T23:59:59').getTime() || null)
      : null;
    const init = { ...levelDraft, mean: Number(levelDraft.mean), sd: Number(levelDraft.sd), lotExpiresAt };
    if (levelDraft.id) {
      const existing = levels.find(l => l.id === levelDraft.id);
      if (existing) await window.db.put('qc_levels', { ...existing, ...init });
    } else {
      const l = window.schema.newQcLevel(init);
      await window.db.put('qc_levels', l);
      setActiveLevelId(l.id);
    }
    cancelLevel();
  };
  const removeLevel = async (l) => {
    if (!hasPermission('RESOLVE_QC')) return;
    const test = testById[l.testId];
    const ask = await safetyConfirm({
      id: 'admin.qc_level.delete',
      tone: 'danger',
      title: 'Delete QC level',
      message: 'This removes the QC level definition. Historical QC results and violations remain in the database.',
      facts: [
        safetyFact('qc level id', l.id),
        safetyFact('test', test ? ((test.code || '') + ' ' + (test.name || '')).trim() : l.testId),
        safetyFact('level', l.level),
        safetyFact('material', l.material),
        safetyFact('lot', l.lotNumber),
      ],
      entityType: 'qc_level',
      entityId: l.id,
      confirmLabel: 'Delete QC level',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RESOLVE_QC')) return;
    const fresh = await window.db.get('qc_levels', l.id);
    if (!fresh) return;
    await window.db.delete('qc_levels', l.id);
    if (activeLevelId === l.id) setActiveLevelId(null);
  };


  const recordResult = async () => {
    if (!hasPermission('RESOLVE_QC')) return;
    if (!activeLevel || entryValue === '') return;
    const value = Number(entryValue);
    if (Number.isNaN(value)) {
      await safetyNotice({ tone: 'warning', title: 'QC value blocked', message: 'Enter a numeric value.' });
      return;
    }
    const z = window.westgard.zScore(value, activeLevel);
    const r = window.schema.newQcResult({
      qcLevelId: activeLevel.id, testId: activeLevel.testId,
      value, zScore: z,
      instrumentId: entryInstrumentId || activeLevel.instrumentId || null,
      status: 'pending', enteredManually: true,
      enteredBy: window.currentUser ? window.currentUser.id : 'unknown',
      ranAt: Date.now(),
    });
    await window.db.put('qc_results', r);
    setEntryValue('');
  };

  const ackViolation = async (v) => {
    if (!hasPermission('RESOLVE_QC')) return;
    const level = levels.find(l => l.id === v.qcLevelId) || activeLevel;
    const test = v.testId ? testById[v.testId] : (level && testById[level.testId]);
    const ask = await safetyConfirm({
      id: 'qc.violation.resolve',
      tone: 'danger',
      title: 'Acknowledge QC violation',
      message: 'This resolves the violation and may remove a QC release lockout for the affected test.',
      facts: [
        safetyFact('violation id', v.id),
        safetyFact('test', test ? ((test.code || '') + ' ' + (test.name || '')).trim() : v.testId),
        safetyFact('level', level ? level.level : v.qcLevelId),
        safetyFact('rule', v.rule),
        safetyFact('severity', v.severity),
        safetyFact('lockout impact', v.severity === 'reject' ? 'release blocked until resolved or passing QC rerun' : 'advisory only'),
      ],
      requireReason: true,
      reasonLabel: 'Resolution reason',
      reasonPlaceholder: 'why this can be resolved',
      entityType: 'qc_violation',
      entityId: v.id,
      confirmLabel: 'Resolve violation',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RESOLVE_QC')) return;
    await window.qcGate.acknowledgeViolation(v.id, { actor: currentActorId(), reason: ask.reason });
  };

  // Lot expiry status — used to render a per-row pill.
  // Returns null when the level has no lotExpiresAt set, OR when the lot
  // is comfortably outside the per-test (or default) amber threshold.
  // Threshold resolution mirrors `lot-expiry-watcher.js __resolveSoonDays`
  // so the pill and the notification fire on the same boundary.
  const lotStatus = (level, test) => {
    if (!level || !level.lotExpiresAt) return null;
    const days = Math.ceil((level.lotExpiresAt - Date.now()) / (24 * 60 * 60 * 1000));
    const soonDays = window.lotExpiryWatcher
      ? window.lotExpiryWatcher.resolveSoonDays(test)
      : 14;
    if (days < 0)  return { label: 'Lot EXPIRED ' + (-days) + 'd ago', tone: 'rust',  days };
    if (days === 0) return { label: 'Lot expires today',                tone: 'rust',  days };
    if (days <= soonDays) return { label: 'Expires in ' + days + 'd',   tone: 'amber', days };
    return null;
  };

  return (
    <Page label="QC">
      <PageHeader title="QC (Westgard)" sub="Define control levels, record runs, monitor rule violations. Out-of-control levels block result release on those tests."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNewLevel}
            disabled={!canResolveQc}
            title={permissionTitle(canResolveQc, 'Create new QC level', 'resolve QC') }><IconPlus size={13}/> New QC level</button>,
        ]}/>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        {/* Levels list */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-500)' }}>
            {levels.length} level{levels.length === 1 ? '' : 's'} defined
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {levels.length === 0 ? (
              <div className="empty" style={{ padding: '40px 24px' }}>
                <div className="empty-title">No QC levels yet</div>
                <div className="empty-sub">Click "New QC level" to define a control material.</div>
              </div>
            ) : levels.map(l => {
              const t = testById[l.testId];
              const isSel = activeLevelId === l.id;
              const recent = allResults.filter(r => r.qcLevelId === l.id).sort((a,b)=>(b.ranAt||0)-(a.ranAt||0))[0];
              const tone = recent ? (recent.status === 'out_of_control' ? 'err' : recent.status === 'warn' ? 'warn' : 'ok') : 'idle';
              const lot = lotStatus(l, t);
              return (
                <button key={l.id} type="button" onClick={() => setActiveLevelId(l.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 12px', border: 0,
                    background: isSel ? 'var(--sage-50)' : 'transparent',
                    borderBottom: '1px solid var(--line-soft)', cursor: 'pointer',
                    opacity: l.active === false ? 0.5 : 1,
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="dot" data-tone={tone}/>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{(t ? t.code : '?')} · {l.level}</span>
                    <span style={{ flex: 1 }}/>
                    <span className="mono tnum" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{fmtQcNum(l.mean)}±{fmtQcNum(l.sd)}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 2, paddingLeft: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span>{l.material || '—'}{l.lotNumber ? ' · lot ' + l.lotNumber : ''}</span>
                    {lot && <span className="pill" data-tone={lot.tone} style={{ fontSize: 9.5 }}>{lot.label}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <WestgardRulesPanel/>
          {levelDraft && (
            <div className="panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 10 }}>{levelDraft.id ? 'Edit QC level' : 'New QC level'}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <CatalogField label="Test" required>
                  <select className="input" value={levelDraft.testId} onChange={e => setLevelDraft({ ...levelDraft, testId: e.target.value })}>
                    <option value="">—</option>
                    {tests.filter(t => t.active !== false).map(t => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}
                  </select>
                </CatalogField>
                <CatalogField label="Level">
                  <input className="input mono" value={levelDraft.level} onChange={e => setLevelDraft({ ...levelDraft, level: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Material">
                  <input className="input" value={levelDraft.material} onChange={e => setLevelDraft({ ...levelDraft, material: e.target.value })} placeholder="BioRad Lyphochek 1 …"/>
                </CatalogField>
                <CatalogField label="Lot number">
                  <input className="input mono" value={levelDraft.lotNumber} onChange={e => setLevelDraft({ ...levelDraft, lotNumber: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Lot expires">
                  <input className="input mono" type="date" value={levelDraft.lotExpiresAt} onChange={e => setLevelDraft({ ...levelDraft, lotExpiresAt: e.target.value })}/>
                </CatalogField>
                <CatalogField label="Mean" required>
                  <input className="input mono tnum" value={levelDraft.mean} onChange={e => setLevelDraft({ ...levelDraft, mean: e.target.value })}/>
                </CatalogField>
                <CatalogField label="SD" required>
                  <input className="input mono tnum" value={levelDraft.sd} onChange={e => setLevelDraft({ ...levelDraft, sd: e.target.value })}/>
                </CatalogField>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button className="btn" data-size="sm" onClick={cancelLevel}>Cancel</button>
                <button className="btn" data-variant="primary" data-size="sm" onClick={saveLevel}
                  disabled={!canResolveQc}
                  title={permissionTitle(canResolveQc, levelDraft.id ? 'Save QC level' : 'Create QC level', 'resolve QC')}>{levelDraft.id ? 'Save' : 'Create'}</button>
              </div>
            </div>
          )}

          {activeLevel ? (
            <>
              {/* Header with delete */}
              <div className="panel" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{(testById[activeLevel.testId] || {}).code || '?'} · {activeLevel.level}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                    Mean <span className="mono tnum">{fmtQcNum(activeLevel.mean)}</span> · SD <span className="mono tnum">{fmtQcNum(activeLevel.sd)}</span> · units {activeLevel.units || (testById[activeLevel.testId] || {}).units || '—'}
                  </div>
                </div>
                <button className="btn" data-size="xs" onClick={() => startEditLevel(activeLevel)}
                  disabled={!canResolveQc}
                  title={permissionTitle(canResolveQc, 'Edit QC level', 'resolve QC')}>Edit</button>
                <button className="btn" data-variant="danger" data-size="xs" onClick={() => removeLevel(activeLevel)}
                  disabled={!canResolveQc}
                  title={permissionTitle(canResolveQc, 'Delete QC level', 'resolve QC')}>Delete</button>
              </div>

              <div className="panel" style={{ padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="field-label">Trend instrument</span>
                <select className="input" value={chartInstrumentId}
                  onChange={e => setChartInstrumentId(e.target.value)}
                  style={{ height: 28, maxWidth: 300 }}>
                  <option value="__all">All instruments</option>
                  <option value="__none">No instrument</option>
                  {instrumentOptions.map(id => {
                    const ins = instrumentById[id];
                    return <option key={id} value={id}>{ins ? `${ins.name || ins.id} · ${ins.model || ins.vendor || id}` : id}</option>;
                  })}
                </select>
                <span style={{ flex: 1 }}/>
                <span className="mono tnum" style={{ fontSize: 11, color: 'var(--ink-400)' }}>{levelResults.length} run{levelResults.length === 1 ? '' : 's'}</span>
              </div>

              {/* Manual QC entry */}
              <div className="panel" style={{ padding: 12 }}>
                <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Record QC run</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input className="input mono tnum" placeholder="value" value={entryValue}
                    onChange={e => setEntryValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') recordResult(); }}
                    style={{ width: 140 }}/>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                    {entryValue !== '' && !Number.isNaN(Number(entryValue))
                      ? `z = ${window.westgard.zScore(Number(entryValue), activeLevel) != null ? window.westgard.zScore(Number(entryValue), activeLevel).toFixed(2) : '—'}`
                      : 'z = —'}
                  </span>
                  <input className="input mono" placeholder="instrument id (optional)" value={entryInstrumentId}
                    onChange={e => setEntryInstrumentId(e.target.value)} style={{ flex: 1 }}/>
                  <button className="btn" data-variant="primary" data-size="sm" onClick={recordResult}
                    disabled={entryValue === '' || !canResolveQc}
                    title={permissionTitle(canResolveQc, 'Record QC run', 'resolve QC')}>Record</button>
                </div>
              </div>

              {/* Levey-Jennings chart */}
              {levelResults.length > 0 && (
                <div className="panel" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>Levey-Jennings — z-score over time (oldest → newest)</div>
                  <div style={{ padding: 12 }}>
                    <LeveyJenningsChart results={[...levelResults].reverse()}/>
                  </div>
                </div>
              )}

              {/* Recent results */}
              <div className="panel" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>Recent results ({levelResults.length})</div>
                {levelResults.length === 0 ? (
                  <div className="empty" style={{ padding: '24px' }}>
                    <div className="empty-sub">No QC runs yet for this level.</div>
                  </div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr><th>Ran at</th><th>Instrument</th><th>Value</th><th>z-score</th><th>Status</th><th>Violations</th></tr>
                    </thead>
                    <tbody>
                      {levelResults.map(r => (
                        <tr key={r.id}>
                          <td className="mono" style={{ fontSize: 11 }}>{new Date(r.ranAt).toISOString().slice(0,16).replace('T', ' ')}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{r.instrumentId ? ((instrumentById[r.instrumentId] && (instrumentById[r.instrumentId].name || instrumentById[r.instrumentId].id)) || r.instrumentId) : '—'}</td>
                          <td className="mono tnum">{r.value}</td>
                          <td className="mono tnum" style={{ color: Math.abs(r.zScore || 0) > 2 ? 'var(--err-700)' : 'var(--ink-700)' }}>{r.zScore != null ? r.zScore.toFixed(2) : '—'}</td>
                          <td>
                            <span className="pill" data-tone={r.status === 'out_of_control' ? 'rust' : r.status === 'warn' ? 'amber' : r.status === 'in_control' ? 'sage' : 'ghost'}>
                              {r.status}
                            </span>
                          </td>
                          <td style={{ fontSize: 11 }}>{(r.violations || []).map(v => v.rule).join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Violations */}
              {levelViolations.length > 0 && (
                <div className="panel" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>Violations ({levelViolations.length})</div>
                  <table className="tbl">
                    <thead>
                      <tr><th>When</th><th>Instrument</th><th>Rule</th><th>Severity</th><th>Affected</th><th>Status</th><th></th></tr>
                    </thead>
                    <tbody>
                      {levelViolations.map(v => (
                        <tr key={v.id}>
                          <td className="mono" style={{ fontSize: 11 }}>{new Date(v.createdAt).toISOString().slice(0,16).replace('T', ' ')}</td>
                          <td className="mono" style={{ fontSize: 11 }}>{v.instrumentId ? ((instrumentById[v.instrumentId] && (instrumentById[v.instrumentId].name || instrumentById[v.instrumentId].id)) || v.instrumentId) : '—'}</td>
                          <td className="mono">{v.rule}</td>
                          <td>
                            <span className="pill" data-tone={v.severity === 'reject' ? 'rust' : 'amber'}>{v.severity}</span>
                          </td>
                          <td>{(v.affectedQcResultIds || []).length}</td>
                          <td>
                            {v.resolvedAt
                              ? <span className="pill" data-tone="sage">resolved</span>
                              : <span className="pill" data-tone="rust">open</span>}
                          </td>
                          <td>
                            {!v.resolvedAt && v.severity === 'reject' && (
                              <button className="btn" data-size="xs" onClick={() => ackViolation(v)}
                                disabled={!canResolveQc}
                                title={permissionTitle(canResolveQc, 'Acknowledge QC violation', 'resolve QC')}>Acknowledge</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="panel" style={{ padding: 30 }}>
              <div className="empty">
                <div className="empty-title">Select a QC level</div>
                <div className="empty-sub">Or click "New QC level" to define one.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
};

// ===== Notifications & TAT =====
//
// Single admin surface for the lab's notification rules. Today this is
// turnaround-time monitoring (the watcher in `tat-watcher.js` reads thresholds
// here and publishes both audit events and `notification` payloads). Future
// channels (delivery-failure escalation knobs, TAT-by-test overrides, custom
// rule routing) will land on this same page so operators have one place to
// reason about "who gets paged, when, and why."
//
// Design choice: thresholds are stored on the `lab_config` singleton (same row
// as Westgard rule selection). Editing here causes the watcher to re-scan
// immediately via the existing `db.subscribe('lab_config', …)` hook — no extra
// plumbing.
const TAT_PRIORITIES = [
  { id: 'stat',    label: 'STAT',    tone: 'rust',  hint: 'Critical priority — emergency / time-sensitive workflows.' },
  { id: 'asap',    label: 'ASAP',    tone: 'amber', hint: 'Elevated priority — urgent but not emergent.' },
  { id: 'routine', label: 'Routine', tone: 'sage',  hint: 'Standard priority — daily ambulatory workflows.' },
];

// Source of truth is `window.schema.ROLE_IDS` (populated by schema.js before
// any JSX executes). Falling back to a hardcoded copy keeps the page from
// crashing if schema fails to load — the value is a flat array, so a stale
// list is preferable to a TypeError on first paint.
const TAT_RECIPIENT_ROLES = (window.schema && Array.isArray(window.schema.ROLE_IDS) && window.schema.ROLE_IDS.length)
  ? window.schema.ROLE_IDS
  : ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'MEDICAL_TECHNOLOGIST', 'LAB_ASSISTANT', 'PATHOLOGIST', 'IT_ADMIN'];

const formatMinutes = (m) => {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 60) return Math.round(m) + 'm';
  const h = m / 60;
  if (h < 24) return h.toFixed(1).replace(/\.0$/, '') + 'h';
  const d = h / 24;
  return d.toFixed(1).replace(/\.0$/, '') + 'd';
};

