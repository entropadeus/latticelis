// ===== Result Report =====
// Printable laboratory result report — one result per report with full
// patient/order/specimen/test context.
// Mounted globally in app.jsx; opened via window.openResultReport(resultId).

const { useState: useStateRR, useEffect: useEffectRR, useRef: useRefRR } = React;

const RR_FLAG_LABELS = {
  L: 'Low', H: 'High', LL: 'Critical Low', HH: 'Critical High',
  A: 'Abnormal', AA: 'Critical Abnormal',
};

const rrAgeAt = (dob) => {
  if (!dob) return null;
  const b = new Date(dob);
  if (isNaN(b)) return null;
  const n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
  return a;
};

const rrEsc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const rrFmtTs = (ts) => {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
};

const rrFmtDob = (dob) => {
  if (!dob) return '—';
  const d = new Date(dob);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

// Build the standalone HTML page for the print popup. Accepts pre-loaded
// entity objects rather than IDs — the caller handles async resolution.
const buildReportHtml = ({ result, test, specimen, order, patient, client }) => {
  const labName = (window.schema && window.schema.LAB_NAME) || 'Lattice LIS';

  const pt = patient || {};
  const sp = specimen || {};
  const or = order || {};
  const ts = test || {};
  const cl = client || {};

  const age = rrAgeAt(pt.dateOfBirth);
  const ageStr = age != null ? `, ${age} y` : '';
  const sexStr = pt.sex ? `, ${pt.sex}` : '';
  const dobStr = rrFmtDob(pt.dateOfBirth);

  const patientName = [pt.lastName, pt.firstName].filter(Boolean).join(', ') || '—';
  const mrn = pt.mrn || '—';

  const specimenType = sp.specimenType || sp.type || '—';
  const container = sp.containerType || sp.container || '—';
  const collected = rrFmtTs(sp.collectedAt || sp.receivedAt);
  const received = rrFmtTs(sp.receivedAt);
  const accession = sp.accessionNumber || sp.accession || '—';

  const priority = or.priority || '—';
  const ordered = rrFmtTs(or.createdAt || or.orderedAt);
  const clientName = cl.name || or.clientName || '—';
  const facility = or.facility || cl.facility || '—';

  const testCode = ts.code || result.testCode || '—';
  const testName = ts.name || result.testName || testCode;
  const loincCode = ts.loincCode ? ` (LOINC ${rrEsc(ts.loincCode)})` : '';

  const value = result.value != null ? String(result.value) : '—';
  const units = result.units || ts.units || '';
  const refRange = result.referenceRange || ts.referenceRange || '—';
  const flag = result.flag || '';
  const flagLabel = RR_FLAG_LABELS[flag] || flag || '';
  const isCritical = flag === 'LL' || flag === 'HH' || flag === 'AA';
  const isAbnormal = flag && !isCritical;

  const status = result.status || '—';
  const verifiedBy = result.verifiedBy || '—';
  const verifiedAt = rrFmtTs(result.verifiedAt);
  const releasedBy = result.releasedBy || verifiedBy;
  const releasedAt = rrFmtTs(result.releasedAt || result.verifiedAt);

  const isCorrected = !!result.corrections && result.corrections.length > 0;
  const correctionNote = isCorrected
    ? `Corrected result. Original value: ${rrEsc(result.corrections[result.corrections.length - 1].previousValue || '—')}.` +
      (result.corrections[result.corrections.length - 1].reason
        ? ` Reason: ${rrEsc(result.corrections[result.corrections.length - 1].reason)}`
        : '')
    : '';

  const comments = result.comment || result.comments || '';

  const flagCell = flag
    ? `<span style="display:inline-block;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600;background:${isCritical ? '#fde8e8' : '#fff7e6'};color:${isCritical ? '#c0392b' : '#b45309'};">${rrEsc(flagLabel)}</span>`
    : '<span style="color:#999;">—</span>';

  const correctionBlock = isCorrected ? `
    <div style="margin-top:14px;padding:10px 14px;background:#fffbeb;border:1px solid #f59e0b;border-radius:4px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#b45309;margin-bottom:4px;">Corrected Result</div>
      <div style="font-size:12px;color:#92400e;">${rrEsc(correctionNote)}</div>
    </div>` : '';

  const commentsBlock = comments ? `
    <div style="margin-top:14px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin-bottom:5px;">Comments / Interpretation</div>
      <div style="font-size:12px;color:#222;line-height:1.55;white-space:pre-wrap;">${rrEsc(comments)}</div>
    </div>` : '';

  const version = (window.__LIS_VERSION) || '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Result Report — ${rrEsc(testName)} — ${rrEsc(patientName)}</title>
<style>
  @page { size: letter portrait; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Arial', sans-serif; font-size: 12px; color: #111; background: #fff; }
  h1 { margin: 0; font-size: 15px; font-weight: 700; color: #111; }
  h2 { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f5f5f0; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #555; padding: 6px 10px; border: 1px solid #ddd; text-align: left; }
  td { padding: 7px 10px; border: 1px solid #ddd; font-size: 12px; vertical-align: top; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .card { border: 1px solid #ddd; border-radius: 4px; padding: 10px 14px; }
  .card-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 6px; }
  .card-row { display: flex; gap: 8px; margin-bottom: 3px; }
  .card-key { font-size: 11px; color: #555; min-width: 80px; flex-shrink: 0; }
  .card-val { font-size: 11.5px; color: #111; font-weight: 500; }
  .divider { border: none; border-top: 1px solid #ddd; margin: 14px 0; }
  .footer { margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
  .proto-badge { display: inline-block; padding: 2px 8px; background: #fde8e8; color: #c0392b; border: 1px solid #f5a0a0; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; vertical-align: middle; margin-left: 10px; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<!-- Header -->
<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;">
  <div>
    <h1>${rrEsc(labName)} <span class="proto-badge">PROTOTYPE — Not for clinical use</span></h1>
    <div style="font-size:11px;color:#555;margin-top:3px;">Laboratory Result Report</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#555;">
    <div>Report generated: ${rrEsc(rrFmtTs(Date.now()))}</div>
    <div>Status: <strong>${rrEsc(status)}</strong>${isCorrected ? ' · <strong style="color:#b45309;">CORRECTED</strong>' : ''}</div>
  </div>
</div>

<hr class="divider" style="margin-top:0;">

<!-- Patient + Report Info -->
<div class="grid2">
  <div class="card">
    <div class="card-label">Patient</div>
    <div class="card-row"><span class="card-key">Name</span><span class="card-val">${rrEsc(patientName)}</span></div>
    <div class="card-row"><span class="card-key">MRN</span><span class="card-val">${rrEsc(mrn)}</span></div>
    <div class="card-row"><span class="card-key">DOB</span><span class="card-val">${rrEsc(dobStr)}${ageStr ? ' (' + rrEsc(ageStr.replace(/^, /, '')) + ')' : ''}</span></div>
    <div class="card-row"><span class="card-key">Sex</span><span class="card-val">${rrEsc(sexStr.replace(/^, /, '')) || '—'}</span></div>
  </div>
  <div class="card">
    <div class="card-label">Report</div>
    <div class="card-row"><span class="card-key">Accession</span><span class="card-val">${rrEsc(accession)}</span></div>
    <div class="card-row"><span class="card-key">Order #</span><span class="card-val">${rrEsc(or.id || '—')}</span></div>
    <div class="card-row"><span class="card-key">Verified</span><span class="card-val">${rrEsc(verifiedAt)}</span></div>
    <div class="card-row"><span class="card-key">Released</span><span class="card-val">${rrEsc(releasedAt)}</span></div>
  </div>
</div>

<!-- Specimen + Order -->
<div class="grid2">
  <div class="card">
    <div class="card-label">Specimen</div>
    <div class="card-row"><span class="card-key">Type</span><span class="card-val">${rrEsc(specimenType)}</span></div>
    <div class="card-row"><span class="card-key">Container</span><span class="card-val">${rrEsc(container)}</span></div>
    <div class="card-row"><span class="card-key">Collected</span><span class="card-val">${rrEsc(collected)}</span></div>
    <div class="card-row"><span class="card-key">Received</span><span class="card-val">${rrEsc(received)}</span></div>
  </div>
  <div class="card">
    <div class="card-label">Order</div>
    <div class="card-row"><span class="card-key">Priority</span><span class="card-val">${rrEsc(priority)}</span></div>
    <div class="card-row"><span class="card-key">Ordered</span><span class="card-val">${rrEsc(ordered)}</span></div>
    <div class="card-row"><span class="card-key">Client</span><span class="card-val">${rrEsc(clientName)}</span></div>
    <div class="card-row"><span class="card-key">Facility</span><span class="card-val">${rrEsc(facility)}</span></div>
  </div>
</div>

<!-- Result table -->
<div style="margin-bottom:14px;">
  <h2>Results</h2>
  <table>
    <thead>
      <tr>
        <th>Test</th>
        <th>Value</th>
        <th>Units</th>
        <th>Reference Range</th>
        <th>Flag</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <div style="font-weight:600;">${rrEsc(testName)}</div>
          <div style="font-size:10.5px;color:#666;">${rrEsc(testCode)}${loincCode}</div>
        </td>
        <td style="font-weight:700;font-size:13px;${isCritical ? 'color:#c0392b;' : isAbnormal ? 'color:#b45309;' : ''}">${rrEsc(value)}</td>
        <td>${rrEsc(units)}</td>
        <td>${rrEsc(refRange)}</td>
        <td>${flagCell}</td>
        <td><span style="font-size:11px;">${rrEsc(status)}</span></td>
      </tr>
    </tbody>
  </table>
</div>

${commentsBlock}
${correctionBlock}

<!-- Verification block -->
<div style="margin-top:14px;padding:10px 14px;background:#f5f5f0;border-radius:4px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
  <div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:4px;">Verified by</div>
    <div style="font-size:12px;font-weight:500;">${rrEsc(verifiedBy)}</div>
    <div style="font-size:11px;color:#555;">${rrEsc(verifiedAt)}</div>
  </div>
  <div>
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:4px;">Released by</div>
    <div style="font-size:12px;font-weight:500;">${rrEsc(releasedBy)}</div>
    <div style="font-size:11px;color:#555;">${rrEsc(releasedAt)}</div>
  </div>
</div>

<div class="footer">
  <span>CONFIDENTIAL — For authorized recipient use only. This report is a prototype generated by Lattice LIS and must not be used for clinical decision-making.</span>
  <span>${version ? 'v' + rrEsc(version) : ''}</span>
</div>

<script>
window.onload = function() {
  window.print();
  window.onafterprint = function() { window.close(); };
};
</script>
</body>
</html>`;
};

// ── Preview component (in-modal) ──────────────────────────────────────────
// Renders a scaled-down iframe preview so the user can see what they're
// about to print before committing to the popup.
const ReportPreview = ({ data }) => {
  const iframeRef = useRefRR(null);
  useEffectRR(() => {
    if (!iframeRef.current || !data) return;
    const html = buildReportHtml(data);
    const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }, [data]);

  if (!data) return null;
  return (
    <div style={{ position: 'relative', background: '#e5e5e5', borderRadius: 4, overflow: 'hidden', flex: 1, minHeight: 0 }}>
      <iframe
        ref={iframeRef}
        title="Report preview"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
      />
    </div>
  );
};

// ── ResultReportModal ─────────────────────────────────────────────────────
const ResultReportModal = () => {
  const [resultId, setResultId] = useStateRR(null);
  const [data, setData] = useStateRR(null);
  const [loading, setLoading] = useStateRR(false);
  const [err, setErr] = useStateRR(null);

  useEffectRR(() => {
    window.openResultReport = (id) => {
      setResultId(id || null);
      setData(null);
      setErr(null);
    };
    return () => { delete window.openResultReport; };
  }, []);

  useEffectRR(() => {
    if (!resultId) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const result = await window.db.get('results', resultId);
        if (!result) throw new Error('Result not found');
        const [test, specimen] = await Promise.all([
          result.testId ? window.db.get('tests', result.testId) : Promise.resolve(null),
          result.specimenId ? window.db.get('specimens', result.specimenId) : Promise.resolve(null),
        ]);
        const order = specimen && specimen.orderId
          ? await window.db.get('orders', specimen.orderId)
          : (result.orderId ? await window.db.get('orders', result.orderId) : null);
        const [patient, client] = await Promise.all([
          order && order.patientId ? window.db.get('patients', order.patientId) : Promise.resolve(null),
          order && order.clientId ? window.db.get('clients', order.clientId) : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setData({ result, test, specimen, order, patient, client });
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e.message || String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [resultId]);

  const printReport = () => {
    if (!data) return;
    const html = buildReportHtml(data);
    const w = window.open('', '_blank', 'width=820,height=1080');
    if (!w) {
      window.alert('Pop-up blocked — allow pop-ups for this site to print.');
      return;
    }
    w.document.write(html);
    w.document.close();
  };

  const close = () => {
    setResultId(null);
    setData(null);
    setErr(null);
  };

  if (!resultId) return null;

  const result = data && data.result;
  const test = data && data.test;
  const titleStr = result
    ? `${test ? test.name || test.code : result.testCode || 'Result'} — ${result.value != null ? result.value : '—'} ${result.units || ''}`
    : 'Loading…';

  return (
    <div className="modal-backdrop" style={{ zIndex: 2100 }}>
      <div className="modal" style={{ width: 860, maxWidth: '95vw', height: '88vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div className="modal-title">Print Result Report</div>
            {result && (
              <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 2 }}>{titleStr}</div>
            )}
          </div>
          <button className="btn" data-size="sm" data-variant="ghost" onClick={close} title="Close">✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 16px 16px' }}>
          {loading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-400)', fontSize: 13 }}>
              Loading…
            </div>
          )}
          {err && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--rust-600)', marginBottom: 8 }}>{err}</div>
                <button className="btn" data-size="sm" onClick={close}>Close</button>
              </div>
            </div>
          )}
          {data && !loading && !err && (
            <ReportPreview data={data}/>
          )}
        </div>

        {/* Footer */}
        {data && !loading && !err && (
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
            <button className="btn" data-size="sm" data-variant="ghost" onClick={close}>Cancel</button>
            <button className="btn" data-size="sm" data-variant="primary" onClick={printReport}>
              <IconPrintRR/> Print / Save PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const IconPrintRR = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6V2h8v4"/>
    <rect x="2" y="6" width="12" height="6" rx="1"/>
    <path d="M4 9h8M4 12h8v2H4v-2z"/>
    <circle cx="4.5" cy="8.5" r="0.5" fill="currentColor" stroke="none"/>
  </svg>
);

window.ResultReportModal = ResultReportModal;
