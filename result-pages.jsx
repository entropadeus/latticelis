// ===== Results =====
const ResultsPage = () => {
  const results = window.useEntities('results');
  const specimens = window.useEntities('specimens');
  const patients = window.useEntities('patients');
  const tests = window.useEntities('tests');
  const specimenById = useMemoOS(() => Object.fromEntries(specimens.map(s => [s.id, s])), [specimens]);
  const patientById = useMemoOS(() => Object.fromEntries(patients.map(p => [p.id, p])), [patients]);
  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);

  const [filter, setFilter] = useStateOS('all');
  const [checked, setChecked] = useStateOS(new Set());
  const [batchOutcome, setBatchOutcome] = useStateOS(null);
  const [showSuperseded, setShowSuperseded] = useStateOS(false);
  const [correcting, setCorrecting] = useStateOS(null);  // result being corrected
  const canVerify = hasPermission('VERIFY_RESULT');
  const canRelease = hasPermission('RELEASE_RESULT');
  const canCorrect = hasPermission('CORRECT_RESULT');
  const animateNew = window.useDeferredEnter();

  // Expose a global hook so the entity drawer's "Correct this result" button
  // can open the modal regardless of the originating page. Cleared on unmount
  // so navigating away doesn't leave a stale handler bound.
  useEffectOS(() => {
    window.openCorrectionFor = async (resultId) => {
      if (!hasPermission('CORRECT_RESULT')) return;
      const r = await window.db.get('results', resultId);
      if (r) setCorrecting(r);
    };
    return () => { delete window.openCorrectionFor; };
  }, []);

  const filtered = useMemoOS(() => {
    return results
      // Hide superseded records by default — operators want the latest in
      // each correction chain, not the historical originals. Toggle reveals
      // them for audit / review purposes.
      .filter(r => showSuperseded || !r.supersededByResultId)
      .filter(r => {
        if (filter === 'all') return true;
        if (filter === 'pending')  return r.status === 'pending' || r.status === 'preliminary';
        if (filter === 'critical') return r.flag === 'LL' || r.flag === 'HH' || r.flag === 'A' || r.flag === 'AA';
        if (filter === 'final')    return r.status === 'final';
        if (filter === 'amended')  return r.status === 'corrected';
        return true;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [results, filter, showSuperseded]);

  const pager = usePagination(filtered);

  const pendingCount = useMemoOS(
    () => results.filter(r => r.status === 'preliminary' || r.status === 'pending').length,
    [results]
  );

  const factsForResult = (r) => {
    const spec = r && r.specimenId ? specimenById[r.specimenId] : null;
    const pat = spec && spec.patientId ? patientById[spec.patientId] : null;
    const test = r && r.testId ? testById[r.testId] : null;
    return [
      safetyFact('result id', r && r.id),
      safetyFact('patient', compactName(pat)),
      safetyFact('accession', spec ? (spec.accessionNumber || spec.id) : (r && r.specimenId)),
      safetyFact('test', test ? `${test.code || ''} ${test.name || ''}`.trim() : (r && r.testId)),
      safetyFact('value', r ? `${r.value == null ? '-' : r.value} ${r.units || ''}`.trim() : '-'),
      safetyFact('flag', (r && r.flag) || 'none'),
      safetyFact('status', r && r.status),
      safetyFact('released', r && r.releasedAt ? formatDateTime(r.releasedAt) : 'not released'),
    ];
  };

  const verify = async (r) => {
    if (!hasPermission('VERIFY_RESULT')) return;
    // Verify only — release is a separate explicit action so the workflow
    // mirrors a real lab (tech verifies; supervisor or auto-rule releases).
    const actor = currentActorId();
    let updated;
    try {
      updated = await window.lifecycle.transition('results',
        { ...r, verifiedAt: Date.now(), verifiedBy: actor }, 'final',
        { actor, reason: 'tech-verified' });
    } catch (e) {
      console.warn('[results] verify via lifecycle refused; not advancing', e);
      return;
    }
    window.events.publish(window.EVENTS.RESULT_VERIFIED, {
      entityType: 'result', entityId: updated.id, result: updated,
      actor,
    });
  };
  const release = async (r) => {
    if (!hasPermission('RELEASE_RESULT')) return;
    const ask = await safetyConfirm({
      id: 'results.release.single',
      tone: 'danger',
      title: 'Release result',
      message: 'This reports the result and starts delivery routing. QC will be re-checked after you confirm.',
      facts: factsForResult(r),
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Release',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RELEASE_RESULT')) return;

    const fresh = await window.db.get('results', r.id);
    if (!fresh || fresh.releasedAt || fresh.status !== 'final') {
      await safetyNotice({
        tone: 'warning',
        title: 'Release skipped',
        message: 'The result changed before release. Reopen the row and try again.',
        facts: factsForResult(fresh || r),
      });
      return;
    }

    if (!window.qcGate) {
      // qc-gate.js is loaded in index.html alongside the rest of the runtime;
      // a missing window.qcGate means the script failed to load. Refusing
      // release is the right default — silently skipping the gate would let
      // QC-locked tests slip through.
      console.error('[results] qcGate missing — refusing release until reload');
      await safetyNotice({
        id: 'results.release.qcgate.missing',
        tone: 'danger',
        title: 'QC gate unavailable',
        message: 'qc-gate.js did not load. Reload the page before releasing results so QC lockouts can be evaluated.',
      });
      return;
    }
    {
      const gate = await window.qcGate.canRelease(fresh);
      if (!gate.ok) {
        await safetyNotice({
          id: 'results.release.blocked',
          tone: 'danger',
          title: 'Release blocked by QC',
          message: 'Resolve the QC violation or run passing QC before releasing.',
          facts: [...factsForResult(fresh), safetyFact('qc lockout', gate.reason)],
        });
        return;
      }
    }
    const actor = currentActorId();
    const updated = {
      ...fresh, releasedAt: Date.now(), releasedBy: actor,
    };
    await window.db.put('results', updated);
    window.events.publish(window.EVENTS.RESULT_RELEASED, {
      entityType: 'result', entityId: updated.id, result: updated,
      actor,
    });
  };
  const reject = async (r) => {
    const ask = await safetyConfirm({
      id: 'results.cancel',
      tone: 'danger',
      title: 'Cancel result',
      message: 'This removes the result from the active reporting path.',
      facts: factsForResult(r),
      requireReason: true,
      reasonLabel: 'Cancel reason',
      reasonPlaceholder: 'short clinical reason',
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Cancel result',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('results', r.id);
    if (!fresh || fresh.status === 'cancelled') return;
    const actor = currentActorId();
    try {
      await window.lifecycle.transition('results', fresh, 'cancelled',
        { actor, reason: ask.reason || 'cancelled by operator' });
    } catch (e) {
      console.warn('[results] reject via lifecycle refused', e);
    }
  };

  // Issue a correction. Creates a NEW result record with status='corrected'
  // pointing at the prior via correctionOf. The prior is NOT mutated except
  // for a back-reference stamp (supersededByResultId). The new record gets
  // a fresh ref-range resolution + flag computation since the corrected
  // value may cross thresholds the prior didn't. Publishes:
  //   - RESULT_CORRECTED — for audit + delivery-watcher amendment re-send
  //   - RESULT_RECEIVED  — so reflex / critical / delta rules cascade
  //                        against the corrected value
  // The watcher decides whether to also fire RESULT_RELEASED when the prior
  // was already released — corrections to released results need to go out
  // as amendments to the same client.
  const issueCorrection = async (priorResult, draft) => {
    if (!hasPermission('CORRECT_RESULT')) return null;
    if (!priorResult || !draft.value) {
      await safetyNotice({
        tone: 'warning',
        title: 'Correction incomplete',
        message: 'Value and reason are required to issue a correction.',
      });
      return null;
    }
    if (!draft.reason || !String(draft.reason).trim()) {
      await safetyNotice({
        tone: 'warning',
        title: 'Correction reason required',
        message: 'A regulatory reason is required for any correction.',
      });
      return null;
    }
    const ask = await safetyConfirm({
      id: priorResult.releasedAt ? 'results.correction.released' : 'results.correction',
      tone: priorResult.releasedAt ? 'danger' : 'warning',
      title: priorResult.releasedAt ? 'Correct released result' : 'Correct result',
      message: priorResult.releasedAt
        ? 'This creates an amended result and re-sends the correction to the client.'
        : 'This creates a new corrected result and preserves the original.',
      facts: [
        ...factsForResult(priorResult),
        safetyFact('new value', `${draft.value} ${draft.units || priorResult.units || ''}`.trim()),
        safetyFact('reason', draft.reason),
      ],
      entityType: 'result',
      entityId: priorResult.id,
      confirmLabel: priorResult.releasedAt ? 'Issue amendment' : 'Issue correction',
    });
    if (!ask.confirmed) return null;
    if (!hasPermission('CORRECT_RESULT')) return null;

    const freshPrior = await window.db.get('results', priorResult.id);
    if (!freshPrior || freshPrior.supersededByResultId) {
      await safetyNotice({
        tone: 'warning',
        title: 'Correction skipped',
        message: 'The result changed before correction. Reopen the row and try again.',
        facts: factsForResult(freshPrior || priorResult),
      });
      return null;
    }

    const actor = currentActorId();
    priorResult = freshPrior;
    const test = priorResult.testId ? testById[priorResult.testId] : null;
    const spec = priorResult.specimenId ? specimenById[priorResult.specimenId] : null;
    const patient = spec && spec.patientId ? patientById[spec.patientId] : null;

    // Re-resolve the demographic-aware reference range against the patient.
    // The corrected value may legitimately fall outside what the prior
    // value's range said — flag the new record, not stamp-copy the prior.
    let range = { low: priorResult.refRangeLow, high: priorResult.refRangeHigh, units: priorResult.units, source: priorResult.refRangeSource || 'snapshot', matchedRange: null };
    if (test && window.referenceRanges && typeof window.referenceRanges.pick === 'function') {
      const picked = window.referenceRanges.pick(test, { patient, asOf: Date.now() });
      if (picked) range = picked;
    }

    // Auto-flag from the resolved range. Numeric values get L/H if outside;
    // strings stay flagless and rules can stamp A/AA downstream.
    const v = Number(draft.value);
    const numericValue = !isNaN(v);
    let flag = '';
    if (numericValue) {
      if (range.low  != null && v < Number(range.low))  flag = 'L';
      else if (range.high != null && v > Number(range.high)) flag = 'H';
    }

    // Build the corrected record. Copies through specimen/test/instrument and
    // resets verification state — the corrected value is a NEW final record
    // that needs no re-verification (the operator who issued the correction
    // is the one signing off). releasedAt/releasedBy stay null until either
    // the user explicitly releases OR the delivery-watcher promotes it.
    const corrected = window.schema.newResult({
      specimenId: priorResult.specimenId, testId: priorResult.testId,
      value: numericValue ? v : draft.value,
      units: draft.units || range.units || priorResult.units || '',
      refRangeLow: range.low == null ? null : range.low,
      refRangeHigh: range.high == null ? null : range.high,
      refRangeSource: range.source || 'none',
      refRangeId: range.matchedRange ? range.matchedRange.id : null,
      flag,
      status: 'corrected',
      verifiedBy: actor, verifiedAt: Date.now(),
      // Correction chain
      correctionOf: priorResult.id,
      correctionReason: String(draft.reason).trim(),
      correctedBy: actor,
      correctedAt: Date.now(),
      // Carry over instrument id + comments (operator can edit comments)
      instrumentId: priorResult.instrumentId || null,
      comments: draft.comments || priorResult.comments || '',
      enteredManually: true, enteredBy: actor,
    });
    await window.db.put('results', corrected);

    // Stamp back-reference on the prior — does NOT change the prior's status
    // (it really WAS final at the time it was reported; preserving that is the
    // whole point of a correction chain).
    await window.db.put('results', { ...priorResult, supersededByResultId: corrected.id });

    // Fire RESULT_RECEIVED so rules + critical-flag detection cascade against
    // the corrected value as if it were a fresh result (a corrected value
    // that crosses a critical threshold should escalate).
    window.events.publish(window.EVENTS.RESULT_RECEIVED, {
      entityType: 'result', entityId: corrected.id,
      result: corrected, specimen: spec, test, manual: true, viaCorrection: true, actor,
    });
    // Fire RESULT_CORRECTED — the delivery-watcher subscribes to this to
    // re-send to the ordering client as an amendment.
    window.events.publish(window.EVENTS.RESULT_CORRECTED, {
      entityType: 'result', entityId: corrected.id,
      result: corrected, prior: priorResult, actor,
      reason: corrected.correctionReason,
      priorReleasedAt: priorResult.releasedAt || null,
    });
    return corrected;
  };
  const verifyAllPreliminary = async () => {
    if (!hasPermission('VERIFY_RESULT')) return;
    const targets = results.filter(r => r.status === 'preliminary');
    if (targets.length === 0) return;
    const ask = await safetyConfirm({
      id: 'results.verify.batch',
      tone: 'warning',
      title: 'Batch verify results',
      message: 'This marks every current preliminary result as final. Routine single-result verification stays one click.',
      facts: [
        safetyFact('count', targets.length),
        safetyFact('first results', targets.slice(0, 6).map(r => {
          const spec = r.specimenId ? specimenById[r.specimenId] : null;
          const test = r.testId ? testById[r.testId] : null;
          return `${spec ? (spec.accessionNumber || spec.id.slice(-6)) : r.id.slice(-6)} ${test ? test.code : r.testId || ''}`.trim();
        }).join(', ')),
      ],
      entityType: 'result',
      entityId: 'batch',
      confirmLabel: 'Verify batch',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('VERIFY_RESULT')) return;
    for (const r of targets) {
      const fresh = await window.db.get('results', r.id);
      if (fresh && fresh.status === 'preliminary') await verify(fresh);
    }
  };

  // Batch release — releases each checked result that is in `final` status with
  // no releasedAt yet. Each one consults qcGate.canRelease so a locked test
  // doesn't sneak through. Partial-fail is the normal case: report counts.
  const releasable = useMemoOS(
    () => filtered.filter(r => r.status === 'final' && !r.releasedAt),
    [filtered]
  );
  const checkedReleasable = useMemoOS(
    () => releasable.filter(r => checked.has(r.id)),
    [releasable, checked]
  );

  const toggleCheck = (id) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };
  const toggleAllReleasable = () => {
    if (checkedReleasable.length === releasable.length && releasable.length > 0) {
      setChecked(new Set());
    } else {
      setChecked(new Set(releasable.map(r => r.id)));
    }
  };

  const batchRelease = async () => {
    if (!hasPermission('RELEASE_RESULT')) return;
    if (checkedReleasable.length === 0) return;
    const ask = await safetyConfirm({
      id: 'results.release.batch',
      tone: 'danger',
      title: 'Batch release results',
      message: 'This reports all selected final results. Each result will be re-read and QC-checked after confirmation.',
      facts: [
        safetyFact('selected', checkedReleasable.length),
        safetyFact('first accessions', checkedReleasable.slice(0, 6).map(r => {
          const spec = r.specimenId ? specimenById[r.specimenId] : null;
          const test = r.testId ? testById[r.testId] : null;
          return `${spec ? (spec.accessionNumber || spec.id.slice(-6)) : r.id.slice(-6)} ${test ? test.code : r.testId || ''}`.trim();
        }).join(', ')),
      ],
      entityType: 'result',
      entityId: 'batch',
      confirmLabel: 'Release selected',
    });
    if (!ask.confirmed) return;
    if (!hasPermission('RELEASE_RESULT')) return;
    const actor = currentActorId();
    const outcome = { released: 0, blocked: [], errors: [] };
    for (const r of checkedReleasable) {
      const fresh = await window.db.get('results', r.id);
      if (!fresh || fresh.releasedAt || fresh.status !== 'final') {
        outcome.blocked.push({ id: r.id, accession: (specimenById[r.specimenId] || {}).accessionNumber, reason: 'changed before release' });
        continue;
      }
      // Batch release also refuses when qcGate is missing rather than silently
      // assuming pass. Block-with-reason keeps the partial-outcome report
      // honest about why nothing made it through.
      if (!window.qcGate) {
        outcome.blocked.push({ id: fresh.id, accession: (specimenById[fresh.specimenId] || {}).accessionNumber, reason: 'qc-gate.js not loaded — reload page' });
        continue;
      }
      const gate = await window.qcGate.canRelease(fresh);
      if (!gate.ok) {
        outcome.blocked.push({ id: fresh.id, accession: (specimenById[fresh.specimenId] || {}).accessionNumber, reason: gate.reason });
        continue;
      }
      try {
        const updated = { ...fresh, releasedAt: Date.now(), releasedBy: actor };
        await window.db.put('results', updated);
        window.events.publish(window.EVENTS.RESULT_RELEASED, {
          entityType: 'result', entityId: updated.id, result: updated, actor,
        });
        outcome.released++;
      } catch (e) {
        outcome.errors.push({ id: r.id, msg: e.message });
      }
    }
    setBatchOutcome(outcome);
    setChecked(new Set());
  };

  const retryDelivery = async (r) => {
    const ask = await safetyConfirm({
      id: 'results.delivery.retry',
      tone: 'warning',
      title: 'Retry delivery',
      message: 'This queues the released result for another delivery attempt.',
      facts: factsForResult(r),
      entityType: 'result',
      entityId: r.id,
      confirmLabel: 'Retry delivery',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('results', r.id);
    if (!fresh || !fresh.releasedAt) return;
    if (window.deliveryWatcher) await window.deliveryWatcher.resend(fresh.id);
  };

  return (
    <Page label="Results">
      <PageHeader title="Results" sub="Verified, pending, and amended results across all departments."
        actions={[
          checkedReleasable.length > 0 && (
            <button key="br" className="btn" data-variant="primary" data-size="sm" onClick={batchRelease}
              disabled={!canRelease}
              title={permissionTitle(canRelease, 'Release selected results', 'release results')}>
              Release <RollingNumber value={checkedReleasable.length}/>
            </button>
          ),
          pendingCount > 0 && (
            <button key="va" className="btn" data-size="sm" onClick={verifyAllPreliminary}
              disabled={!canVerify}
              title={permissionTitle(canVerify, 'Verify all preliminary results', 'verify results')}>
              <IconCheck size={13}/> Verify all <RollingNumber value={pendingCount}/> preliminary
            </button>
          ),
        ].filter(Boolean)}/>
      {batchOutcome && (
        <div className="panel" style={{ padding: '10px 14px', marginBottom: 10, background: batchOutcome.blocked.length || batchOutcome.errors.length ? 'var(--amber-soft)' : 'var(--sage-100)', borderColor: 'var(--line-strong)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500 }}>
              Released {batchOutcome.released}
              {batchOutcome.blocked.length > 0 && ` · ${batchOutcome.blocked.length} blocked by QC`}
              {batchOutcome.errors.length > 0 && ` · ${batchOutcome.errors.length} errored`}
            </span>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-size="xs" data-variant="ghost" onClick={() => setBatchOutcome(null)}>Dismiss</button>
          </div>
          {batchOutcome.blocked.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--ink-700)' }}>
              {batchOutcome.blocked.slice(0, 3).map(b => <div key={b.id} className="mono">· {b.accession || b.id.slice(-6)} — {b.reason}</div>)}
              {batchOutcome.blocked.length > 3 && <div style={{ color: 'var(--ink-400)' }}>+ {batchOutcome.blocked.length - 3} more…</div>}
            </div>
          )}
        </div>
      )}
      <div className="panel">
        <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <SegSelect
            options={[
              {id:'all',label:'All'},
              {id:'pending',label:'Pending review'},
              {id:'critical',label:'Critical'},
              {id:'final',label:'Final'},
              {id:'amended',label:'Amended'},
            ]}
            value={filter} onChange={setFilter}/>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--ink-500)', cursor: 'pointer' }}
            title="Hide records that have been superseded by a corrected version">
            <input type="checkbox" checked={showSuperseded} onChange={e => setShowSuperseded(e.target.checked)}/>
            Show superseded
          </label>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{filtered.length} results</span>
        </div>
        {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
        {filtered.length === 0 ? (
          <EmptyTable
            columns={['Accession','Patient','Test','Value','Units','Ref range','Flag','Status','']}
            message={results.length === 0 ? 'No results yet' : 'No results match the filter'}
            sub={results.length === 0 ? 'Route a specimen to an analyzer — the simulator drops results within a few seconds.' : 'Adjust the filter.'}/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" title="Select all releasable"
                    checked={releasable.length > 0 && checkedReleasable.length === releasable.length}
                    onChange={toggleAllReleasable}
                    disabled={releasable.length === 0}/>
                </th>
                <th>Accession</th><th>Patient</th><th>Test</th>
                <th>Value</th><th>Units</th><th>Ref range</th>
                <th>Flag</th><th>Status</th><th>Delivery</th><th>Resulted</th>
                <th style={{ width: 180 }}></th>
              </tr>
            </thead>
            <tbody className="stagger-children">
              {pager.slice.map(r => {
                const spec = r.specimenId ? specimenById[r.specimenId] : null;
                const pat = spec && spec.patientId ? patientById[spec.patientId] : null;
                const test = r.testId ? testById[r.testId] : null;
                const isPending = r.status === 'preliminary' || r.status === 'pending';
                const canBatchRelease = r.status === 'final' && !r.releasedAt;
                return (
                  <tr key={r.id} className={animateNew ? 'slide-up' : ''} style={{ cursor: 'pointer' }}
                      onClick={() => window.openEntity && window.openEntity('result', r.id)}>
                    <td onClick={e => e.stopPropagation()}>
                      {canBatchRelease && (
                        <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleCheck(r.id)}/>
                      )}
                    </td>
                    <td onClick={e => { if (spec) { e.stopPropagation(); window.openEntity && window.openEntity('specimen', spec.id); }}}
                        style={spec ? { cursor: 'pointer' } : {}}>
                      <span className="mono" style={spec ? { color: 'var(--sage-700)' } : {}}>{spec ? spec.accessionNumber : '—'}</span>
                    </td>
                    <td onClick={e => { if (pat) { e.stopPropagation(); window.openEntity && window.openEntity('patient', pat.id); }}}
                        style={pat ? { cursor: 'pointer', color: 'var(--sage-700)' } : {}}>
                      {pat ? (pat.mrn || ((pat.lastName || '') + (pat.firstName ? ', ' + pat.firstName : ''))) : '—'}
                    </td>
                    <td>{test ? <><span className="mono">{test.code}</span> <span style={{ color: 'var(--ink-400)', marginLeft: 4 }}>{test.shortName || test.name}</span></> : '—'}</td>
                    <td className="mono tnum" style={{ fontWeight: 500 }}>{r.value != null ? r.value : '—'}</td>
                    <td>{r.units || '—'}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-400)' }}>
                      {r.refRangeLow != null && r.refRangeHigh != null ? (r.refRangeLow + '–' + r.refRangeHigh) : '—'}
                    </td>
                    <td><ResultFlagPill flag={r.flag}/></td>
                    <td><ResultStatusPill status={r.status}/></td>
                    <td><DeliveryPill r={r}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(r.createdAt)}</span></td>
                    <td onClick={e => e.stopPropagation()}>
                      {isPending ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-variant="primary" data-size="xs" onClick={() => verify(r)}
                            disabled={!canVerify}
                            title={permissionTitle(canVerify, 'Verify result', 'verify results')}>Verify</button>
                          <button className="btn" data-variant="danger" data-size="xs" onClick={() => reject(r)}>Reject</button>
                        </div>
                      ) : r.status === 'final' && !r.releasedAt ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn" data-variant="primary" data-size="xs" onClick={() => release(r)}
                            disabled={!canRelease}
                            title={permissionTitle(canRelease, 'Release result', 'release results')}>Release</button>
                          <span style={{ fontSize: 10.5, color: 'var(--ink-400)', alignSelf: 'center' }}>
                            verified by {window.currentUserApi ? window.currentUserApi.displayName(r.verifiedBy) : r.verifiedBy}
                          </span>
                        </div>
                      ) : r.deliveryStatus === 'failed' ? (
                        <button className="btn" data-variant="primary" data-size="xs"
                          onClick={() => retryDelivery(r)}>
                          Retry delivery
                        </button>
                      ) : r.releasedAt ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                            released by {window.currentUserApi ? window.currentUserApi.displayName(r.releasedBy) : r.releasedBy}
                          </span>
                          {!r.supersededByResultId && (
                            <button className="btn" data-size="xs" data-variant="ghost"
                              onClick={() => { if (!hasPermission('CORRECT_RESULT')) return; setCorrecting(r); }}
                              disabled={!canCorrect}
                              title={permissionTitle(canCorrect, 'Issue a correction (creates an amended record; original preserved)', 'correct results')}>
                              Correct
                            </button>
                          )}
                        </div>
                      ) : (r.status === 'final' || r.status === 'corrected') && !r.supersededByResultId ? (
                        <button className="btn" data-size="xs" data-variant="ghost"
                          onClick={() => { if (!hasPermission('CORRECT_RESULT')) return; setCorrecting(r); }}
                          disabled={!canCorrect}
                          title={permissionTitle(canCorrect, 'Issue a correction', 'correct results')}>
                          Correct
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {filtered.length > 0 && <TablePagination {...pager}/>}
      </div>
      {correcting && (
        <CorrectResultModal
          prior={correcting}
          test={correcting.testId ? testById[correcting.testId] : null}
          specimen={correcting.specimenId ? specimenById[correcting.specimenId] : null}
          patient={(correcting.specimenId && specimenById[correcting.specimenId] && specimenById[correcting.specimenId].patientId)
            ? patientById[specimenById[correcting.specimenId].patientId] : null}
          onCancel={() => setCorrecting(null)}
          onSave={async (draft) => {
            const out = await issueCorrection(correcting, draft);
            if (out) setCorrecting(null);
          }}/>
      )}
    </Page>
  );
};

// Reasons preset list — operators can override but the dropdown covers the
// canonical CLIA-tracked reasons. The free-text comments field captures
// anything more nuanced.
const CORRECTION_REASONS = [
  'Transcription error',
  'Wrong specimen',
  'Instrument calibration drift',
  'Clerical / data entry',
  'Reflex test added',
  'QC re-evaluation',
  'Patient ID mismatch corrected',
  'Other (see comments)',
];

const CorrectResultModal = ({ prior, test, specimen, patient, onCancel, onSave }) => {
  const [draft, setDraft] = useStateOS({
    value: prior.value != null ? String(prior.value) : '',
    units: prior.units || (test && test.units) || '',
    reason: '',
    comments: prior.comments || '',
  });
  const [saving, setSaving] = useStateOS(false);
  const canCorrect = hasPermission('CORRECT_RESULT');

  // Resolve the demographic-aware range so the live preview shows what flag
  // the corrected value will get — same logic the save path will run.
  const resolvedRange = useMemoOS(() => {
    if (test && window.referenceRanges && typeof window.referenceRanges.pick === 'function') {
      try { return window.referenceRanges.pick(test, { patient, asOf: Date.now() }); }
      catch (e) { return null; }
    }
    return null;
  }, [test, patient]);

  // Only L/H — reference-ranges.pick returns { low, high } with no critical
  // or panic thresholds, so LL/HH/A/AA/Critical can't be derived here. Adding
  // those flags will require schema fields (e.g. criticalLow/criticalHigh on
  // tests or per-range entries) and a separate evaluator.
  const previewFlag = useMemoOS(() => {
    if (draft.value === '' || !resolvedRange) return '';
    const v = Number(draft.value);
    if (isNaN(v)) return '';
    if (resolvedRange.low  != null && v < Number(resolvedRange.low))  return 'L';
    if (resolvedRange.high != null && v > Number(resolvedRange.high)) return 'H';
    return '';
  }, [draft.value, resolvedRange]);

  const valueChanged = String(draft.value) !== (prior.value != null ? String(prior.value) : '');
  const ready = !!draft.value && !!String(draft.reason || '').trim() && valueChanged;

  const submit = async () => {
    if (!hasPermission('CORRECT_RESULT')) return;
    setSaving(true);
    try { await onSave(draft); }
    finally { setSaving(false); }
  };

  return (
    <div onClick={onCancel} className="backdrop-in"
      style={{ position: 'fixed', inset: 0, background: 'rgba(31,30,26,0.45)',
        display: 'grid', placeItems: 'center', zIndex: 1500 }}>
      <div onClick={e => e.stopPropagation()} className="scale-in"
        style={{ background: 'var(--ivory-50)', border: '1px solid var(--line)',
          borderRadius: 8, width: 580, maxWidth: '92vw', maxHeight: '85vh',
          boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>Correct result</span>
          <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
            {test ? <><span className="mono">{test.code}</span> · {test.name}</> : 'unknown test'}
            {specimen && <> · accession <span className="mono">{specimen.accessionNumber}</span></>}
          </span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="xs" data-variant="ghost" onClick={onCancel}>Cancel</button>
        </div>
        <div style={{ padding: 16, overflow: 'auto' }}>
          <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 5, padding: 10, marginBottom: 12 }}>
            <div className="section-title" style={{ fontSize: 9.5, marginBottom: 6 }}>Original result</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
              <span><span style={{ color: 'var(--ink-400)' }}>Value</span> <span className="mono tnum" style={{ fontWeight: 500 }}>{prior.value != null ? prior.value : '—'} {prior.units || ''}</span></span>
              <span><span style={{ color: 'var(--ink-400)' }}>Flag</span> {prior.flag || '—'}</span>
              <span><span style={{ color: 'var(--ink-400)' }}>Status</span> {prior.status}</span>
              <span><span style={{ color: 'var(--ink-400)' }}>Released</span> {prior.releasedAt ? '✓' : '—'}</span>
            </div>
            {prior.releasedAt && (
              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--warn-700)' }}>
                ⚠ This result has already been delivered. Saving the correction will re-send an amendment to the client.
              </div>
            )}
          </div>

          <CatalogField label="Corrected value" required>
            <input className="input mono tnum" autoFocus value={draft.value}
              onChange={e => setDraft({ ...draft, value: e.target.value })}/>
          </CatalogField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <CatalogField label="Units">
              <input className="input mono" value={draft.units}
                onChange={e => setDraft({ ...draft, units: e.target.value })}/>
            </CatalogField>
            <CatalogField label="Range / flag preview">
              <div style={{ height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--ivory-100)', border: '1px solid var(--line)', borderRadius: 5 }}>
                <span className="mono tnum" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>
                  {resolvedRange && resolvedRange.low != null ? `${resolvedRange.low}–${resolvedRange.high}` : '—'}
                </span>
                {resolvedRange && resolvedRange.source && (
                  <span className="pill" data-tone={resolvedRange.source === 'matched' ? 'sage' : 'ghost'} style={{ fontSize: 9.5 }}>
                    {resolvedRange.source}
                  </span>
                )}
                <span style={{ flex: 1 }}/>
                {previewFlag ? <span className="pill" data-tone={previewFlag === 'L' ? 'info' : 'amber'} style={{ fontSize: 10.5 }}>{previewFlag}</span> : <span style={{ color: 'var(--ink-300)', fontSize: 11 }}>—</span>}
              </div>
            </CatalogField>
          </div>
          <CatalogField label="Reason" required>
            <select className="input" value={draft.reason}
              onChange={e => setDraft({ ...draft, reason: e.target.value })}>
              <option value="">— pick a reason —</option>
              {CORRECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </CatalogField>
          <CatalogField label="Comments (optional)">
            <textarea className="input" rows={3} value={draft.comments}
              onChange={e => setDraft({ ...draft, comments: e.target.value })}
              style={{ height: 'auto', padding: 8, resize: 'vertical' }}
              placeholder="Additional context — operator notes, instrument run id, etc."/>
          </CatalogField>
          <div style={{ fontSize: 10.5, color: 'var(--ink-400)', marginTop: 4 }}>
            A correction creates a new record; the original is preserved at status <strong>final</strong> for audit. The new record is auto-verified by you ({(window.currentUser && window.currentUser.id) || 'unknown'}).
          </div>
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button className="btn" data-size="sm" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={submit}
            disabled={saving || !ready || !canCorrect}
            title={permissionTitle(canCorrect, prior.releasedAt ? 'Issue correction and re-deliver' : 'Issue correction', 'correct results')}>
            {saving ? 'Saving…' : (prior.releasedAt ? 'Issue correction + re-deliver' : 'Issue correction')}
          </button>
        </div>
      </div>
    </div>
  );
};

const RESULT_FLAG_TONE = { L: 'info', H: 'amber', LL: 'rust', HH: 'rust', A: 'amber', AA: 'rust', '': 'ghost' };
const RESULT_FLAG_LABEL = { L: 'L', H: 'H', LL: 'LL', HH: 'HH', A: 'A', AA: 'AA', '': '—' };
const ResultFlagPill = ({ flag }) => (
  <span className="pill" data-tone={RESULT_FLAG_TONE[flag || ''] || 'ghost'}>
    {RESULT_FLAG_LABEL[flag || ''] || flag}
  </span>
);
const RESULT_STATUS_TONE = { pending: 'ghost', preliminary: 'amber', final: 'sage', corrected: 'info', cancelled: 'rust', entered_in_error: 'rust' };
const ResultStatusPill = ({ status }) => (
  <span className="pill" data-tone={RESULT_STATUS_TONE[status] || 'ghost'}>{status || '—'}</span>
);

const DELIVERY_TONE = { delivered: 'sage', pending: 'amber', failed: 'rust', manual: 'ghost', '': 'ghost' };
const DeliveryPill = ({ r }) => {
  if (!r.releasedAt) return <span style={{ color: 'var(--ink-300)' }}>—</span>;
  const status = r.deliveryStatus || (r.deliveredAt ? 'delivered' : 'pending');
  const label = status === 'delivered'
    ? `${r.deliveredVia || 'sent'}`
    : status === 'manual' ? 'manual'
    : status;
  return (
    <span className="pill" data-tone={DELIVERY_TONE[status] || 'ghost'}
      title={r.deliveredTo ? `${status} → ${r.deliveredTo}` : status}>
      {label}
    </span>
  );
};

// ===== Patient search =====
// `initialPatientId` lets other surfaces (e.g. the entity drawer's
// "Open in Patient Search" action) hand off a specific record so the tech
// lands directly on demographics + history without re-searching. `onClearInitial`
// is the parent's cleanup hook — we call it once we've consumed the value so a
// later nav-away-then-back doesn't auto-reopen the same patient.
const PatientsPage = ({ initialPatientId, onClearInitial }) => {
  const patients = window.useEntities('patients');
  const orders = window.useEntities('orders');
  const specimens = window.useEntities('specimens');
  const results = window.useEntities('results');
  const tests = window.useEntities('tests');

  const testById = useMemoOS(() => Object.fromEntries(tests.map(t => [t.id, t])), [tests]);
  const specimenById = useMemoOS(() => Object.fromEntries(specimens.map(s => [s.id, s])), [specimens]);

  const [q, setQ] = useStateOS('');
  const [selectedId, setSelectedId] = useStateOS(initialPatientId || null);

  // When a preselect arrives — either on mount or later if the user is already
  // on this page and triggers another drawer hand-off — apply it then ask the
  // parent to drop the pending value. Without the clear, navigating away and
  // back would re-auto-open the same patient even after the operator picked a
  // different one.
  useEffectOS(() => {
    if (initialPatientId) {
      setSelectedId(initialPatientId);
      if (onClearInitial) onClearInitial();
    }
  }, [initialPatientId]);

  const matches = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return patients.slice(0, 40);
    return patients.filter(p => {
      const blob = [p.mrn, p.lastName, p.firstName, p.dob].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(needle);
    }).slice(0, 40);
  }, [patients, q]);

  const selected = selectedId ? patients.find(p => p.id === selectedId) : null;

  const patientOrders = useMemoOS(() => {
    if (!selected) return [];
    return orders
      .filter(o => o.patientId === selected.id)
      .sort((a, b) => (b.orderedAt || b.createdAt || 0) - (a.orderedAt || a.createdAt || 0));
  }, [orders, selected]);

  // Full per-patient result list (no slice). PatientDetail slices to its
  // display cap and surfaces the total so the operator sees "showing 50 of N"
  // rather than silently dropping rows.
  const patientResults = useMemoOS(() => {
    if (!selected) return [];
    return results
      .filter(r => {
        const s = r.specimenId ? specimenById[r.specimenId] : null;
        return s && s.patientId === selected.id;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [results, specimenById, selected]);

  return (
    <Page label="Patient Search">
      <PageHeader title="Patient search" sub="Find a patient by MRN or name. Click a result to see demographics, orders, and recent values."/>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 12, height: 'calc(100% - 80px)' }}>
        {/* Left: search + results */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
            <input className="input" placeholder="MRN, last name, first name…"
              value={q} onChange={e => setQ(e.target.value)} autoFocus/>
            <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 6 }}>
              {matches.length} of {patients.length} patient{patients.length === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {matches.length === 0 ? (
              <div style={{ padding: 24, fontSize: 12, color: 'var(--ink-400)', textAlign: 'center' }}>
                {patients.length === 0 ? 'No patients yet. Create one via New order.' : 'No matches'}
              </div>
            ) : matches.map(p => (
              <button key={p.id} type="button"
                onClick={() => setSelectedId(p.id)}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
                onMouseLeave={e => e.currentTarget.style.background = selectedId === p.id ? 'var(--sage-50)' : 'transparent'}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 0,
                  background: selectedId === p.id ? 'var(--sage-50)' : 'transparent',
                  borderBottom: '1px solid var(--line-soft)',
                  cursor: 'pointer',
                }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-900)' }}>
                  <span className="mono">{p.mrn || '—'}</span>
                  <span style={{ marginLeft: 8, fontWeight: 500 }}>
                    {[p.lastName, p.firstName].filter(Boolean).join(', ') || '—'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 2 }}>
                  {p.dob ? 'DOB ' + p.dob : ''}
                  {p.sex && <span style={{ marginLeft: 8 }}>{p.sex}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: detail */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selected ? (
            <div className="empty" style={{ flex: 1 }}>
              <div className="empty-icon"><IconUser size={16}/></div>
              <div className="empty-title">No patient selected</div>
              <div className="empty-sub">Pick a patient from the left to load demographics, order history, and result trends.</div>
            </div>
          ) : (
            <PatientDetail
              patient={selected}
              orders={patientOrders}
              results={patientResults}
              testById={testById}
              specimenById={specimenById}
            />
          )}
        </div>
      </div>
    </Page>
  );
};

const ORDERS_DISPLAY_CAP = 20;
const RESULTS_DISPLAY_CAP = 50;

const PatientDetail = ({ patient, orders, results, testById, specimenById }) => {
  const locations = window.useEntities('locations');
  const locationById = useMemoOS(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const canCreateOrder = hasPermission('CREATE_ORDER');
  const ordersShown  = orders.slice(0, ORDERS_DISPLAY_CAP);
  const resultsShown = results.slice(0, RESULTS_DISPLAY_CAP);
  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      {/* Demographics header */}
      <div style={{ padding: 16, borderBottom: '1px solid var(--line)', background: 'var(--ivory-50)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>
              {[patient.lastName, patient.firstName].filter(Boolean).join(', ') || '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-500)', marginTop: 4, display: 'flex', gap: 14 }}>
              <span><span style={{ color: 'var(--ink-400)' }}>MRN</span> <span className="mono">{patient.mrn || '—'}</span></span>
              <span><span style={{ color: 'var(--ink-400)' }}>DOB</span> <span className="mono">{patient.dob || '—'}</span></span>
              <span><span style={{ color: 'var(--ink-400)' }}>Sex</span> {patient.sex || '—'}</span>
              {patient.phone && <span><span style={{ color: 'var(--ink-400)' }}>Phone</span> <span className="mono">{patient.phone}</span></span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" data-size="sm" data-variant="primary"
              onClick={() => window.openNewOrder && window.openNewOrder()}
              disabled={!canCreateOrder}
              title={permissionTitle(canCreateOrder, 'Create new order', 'create orders')}>
              <IconPlus size={13}/> New order
            </button>
          </div>
        </div>
      </div>

      {/* Orders */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Orders ({orders.length})</div>
        {orders.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No orders for this patient.</div>
        ) : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Order #</th><th>Tests</th><th>Priority</th><th>Status</th><th>Ordered</th><th>Facility</th>
              </tr>
            </thead>
            <tbody>
              {ordersShown.map(o => {
                const loc = o.locationId ? locationById[o.locationId] : null;
                return (
                  <tr key={o.id}>
                    <td><span className="mono">{o.orderNumber}</span></td>
                    <td className="mono tnum">{o.testIds.length}</td>
                    <td><PriorityPill p={o.priority}/></td>
                    <td><StatusPill s={o.status}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(o.orderedAt)}</span></td>
                    <td>{loc ? <span><span className="mono" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{loc.code}</span></span> : (o.facility || '—')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {orders.length > ORDERS_DISPLAY_CAP && (
          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 6 }}>
            Showing most recent {ORDERS_DISPLAY_CAP} of {orders.length}.
          </div>
        )}
      </div>

      {/* Recent results */}
      <div style={{ padding: '14px 16px' }}>
        <div className="section-title" style={{ marginBottom: 8 }}>Recent results ({results.length})</div>
        {results.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)' }}>No results for this patient.</div>
        ) : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Test</th><th>Value</th><th>Units</th><th>Ref range</th><th>Flag</th><th>Status</th><th>Resulted</th>
              </tr>
            </thead>
            <tbody>
              {resultsShown.map(r => {
                const test = r.testId ? testById[r.testId] : null;
                return (
                  <tr key={r.id}>
                    <td>{test ? <><span className="mono">{test.code}</span> <span style={{ marginLeft: 4, color: 'var(--ink-400)' }}>{test.shortName || test.name}</span></> : '—'}</td>
                    <td className="mono tnum" style={{ fontWeight: 500 }}>{r.value != null ? r.value : '—'}</td>
                    <td>{r.units || '—'}</td>
                    <td className="mono tnum" style={{ color: 'var(--ink-400)' }}>
                      {r.refRangeLow != null && r.refRangeHigh != null ? (r.refRangeLow + '–' + r.refRangeHigh) : '—'}
                    </td>
                    <td><ResultFlagPill flag={r.flag}/></td>
                    <td><ResultStatusPill status={r.status}/></td>
                    <td><span className="mono" style={{ color: 'var(--ink-400)' }}>{formatDateTime(r.createdAt)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {results.length > RESULTS_DISPLAY_CAP && (
          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 6 }}>
            Showing most recent {RESULTS_DISPLAY_CAP} of {results.length}.
          </div>
        )}
      </div>
    </div>
  );
};

// ===== Worklists =====
