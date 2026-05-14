// result-report.jsx — Result report modal (Tier 5 #18)
//
// Opened from the Order entity drawer ("Print report" button in OrderOverview).
// Renders a clinical lab report preview inside a modal. The "Print / Save PDF"
// button opens a self-contained pop-up window (one HTML string, no app globals)
// and calls window.print() on it — browser prints or saves to PDF from there.
//
// Lab identity (name, CLIA#, director, phone, address) comes from the
// lab_config singleton. Configure under AdminCenter → System Setup → Lab Identity.
// Fields left blank are omitted from the header rather than showing placeholders.

const { useState: useStateRR, useMemo: useMemoRR } = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDateRR = (ts) => {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'string' ? ts : ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const fmtTsRR = (ts) => {
  if (!ts) return '—';
  const d = new Date(typeof ts === 'string' ? ts : ts);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const naRR = (v, fb = '—') => (v != null && v !== '') ? v : fb;

// Key-value row used in the preview's patient/order info sections.
const InfoRow = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'baseline' }}>
    <span style={{ fontSize: 11, color: 'var(--ink-400)', minWidth: 72, flexShrink: 0 }}>{label}</span>
    <span style={{ fontSize: 12, color: 'var(--ink-900)', flex: 1 }}>{value}</span>
  </div>
);

// ── Report preview component (in-modal HTML) ──────────────────────────────────

const ReportPreview = ({ order, patient, results, testById, specimens, labName, labClia, labDirector, labPhone, labAddress, reportStatus, reportedAt }) => {
  const patientName = [patient.lastName, patient.firstName].filter(Boolean).join(', ') || '—';
  const patientAge = patient.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;
  const dobLine = patient.dob
    ? fmtDateRR(new Date(patient.dob).getTime()) + (patientAge != null ? ` (${patientAge}y)` : '')
    : '—';

  return (
    <div style={{
      background: '#fff', border: '1px solid var(--line)', borderRadius: 6,
      fontFamily: 'Geist, ui-sans-serif, system-ui, sans-serif',
      fontSize: 12, color: '#1A1917', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '14px 20px', background: 'var(--ivory-100)',
        borderBottom: '2px solid var(--line-strong)',
      }}>
        <div>
          {labName
            ? <div style={{ fontSize: 15, fontWeight: 700 }}>{labName}</div>
            : <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-400)' }}>(Lab name not configured — see System Setup → Lab Identity)</div>
          }
          {labAddress && <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>{labAddress}</div>}
          {labPhone && <div style={{ fontSize: 11, color: 'var(--ink-500)' }}>{labPhone}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>LAB REPORT</div>
          {labClia && <div style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 2 }}>CLIA: {labClia}</div>}
          <div style={{ marginTop: 6 }}>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 700,
              background: reportStatus === 'FINAL' ? '#d1fae5' : '#fef3c7',
              color: reportStatus === 'FINAL' ? '#065f46' : '#92400e',
            }}>{reportStatus}</span>
          </div>
        </div>
      </div>

      {/* Patient + Order */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--line)' }}>
        <div style={{ padding: '12px 20px', borderRight: '1px solid var(--line)' }}>
          <div className="section-title" style={{ fontSize: 10, marginBottom: 8 }}>Patient</div>
          <InfoRow label="Name" value={patientName}/>
          <InfoRow label="DOB" value={dobLine}/>
          <InfoRow label="Sex" value={naRR(patient.sex)}/>
          <InfoRow label="MRN" value={<span className="mono" style={{ fontSize: 11.5 }}>{naRR(patient.mrn)}</span>}/>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <div className="section-title" style={{ fontSize: 10, marginBottom: 8 }}>Order</div>
          <InfoRow label="Order #" value={<span className="mono" style={{ fontSize: 11.5 }}>{naRR(order.orderNumber)}</span>}/>
          <InfoRow label="Priority" value={(order.priority || '—').toUpperCase()}/>
          <InfoRow label="Collected" value={<span className="mono" style={{ fontSize: 11 }}>{fmtTsRR(order.collectedAt)}</span>}/>
          <InfoRow label="Received"  value={<span className="mono" style={{ fontSize: 11 }}>{fmtTsRR(order.receivedAt)}</span>}/>
          {order.diagnosisCodes && order.diagnosisCodes.length > 0 && (
            <InfoRow label="Dx" value={order.diagnosisCodes.join(', ')}/>
          )}
        </div>
      </div>

      {/* Results table */}
      <div style={{ padding: '12px 20px' }}>
        <div className="section-title" style={{ fontSize: 10, marginBottom: 8 }}>Results</div>
        {results.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-400)', fontStyle: 'italic' }}>No results on this order yet.</div>
        ) : (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th>Test</th>
                <th>Result</th>
                <th>Units</th>
                <th>Reference range</th>
                <th style={{ textAlign: 'center' }}>Flag</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map(r => {
                const t = testById[r.testId] || {};
                const critical = r.flag && (r.flag === 'HH' || r.flag === 'LL' || r.flag === 'Critical');
                const abnormal = r.flag && ['H','L','A'].includes(r.flag);
                const refRange = (r.refRangeLow != null && r.refRangeHigh != null)
                  ? `${r.refRangeLow} – ${r.refRangeHigh}`
                  : '—';
                return (
                  <tr key={r.id} style={{ background: critical ? 'var(--rust-soft)' : 'transparent' }}>
                    <td style={{ fontWeight: 500 }}>{t.name || t.code || '—'}</td>
                    <td className="mono" style={{
                      fontWeight: critical ? 700 : 400,
                      color: critical ? 'var(--rust)' : abnormal ? 'var(--amber)' : 'inherit',
                    }}>
                      {r.value != null ? r.value : '—'}
                    </td>
                    <td style={{ color: 'var(--ink-400)' }}>{r.units || t.units || '—'}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--ink-500)' }}>{refRange}</td>
                    <td style={{
                      textAlign: 'center', fontWeight: 700,
                      color: critical ? 'var(--rust)' : abnormal ? 'var(--amber)' : 'var(--ink-300)',
                    }}>
                      {r.flag || '—'}
                    </td>
                    <td style={{ color: 'var(--ink-400)', fontSize: 11 }}>{r.status || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Specimens */}
      {specimens.length > 0 && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'var(--ivory-50)' }}>
          <div className="section-title" style={{ fontSize: 10, marginBottom: 8 }}>Specimens</div>
          {specimens.map(s => (
            <div key={s.id} style={{ fontSize: 11.5, color: 'var(--ink-600)', marginBottom: 4 }}>
              <span className="mono" style={{ color: 'var(--ink-900)' }}>{s.accessionNumber || s.barcode || s.id.slice(-6)}</span>
              <span style={{ margin: '0 8px', color: 'var(--line-strong)' }}>·</span>
              {s.type || '—'}
              <span style={{ margin: '0 8px', color: 'var(--line-strong)' }}>·</span>
              {s.container || '—'}
              {s.collectedAt && <span> · Coll {fmtDateRR(s.collectedAt)}</span>}
              {s.receivedAt && <span> · Rec'd {fmtDateRR(s.receivedAt)}</span>}
              {s.condition && s.condition !== 'ACCEPTABLE' && (
                <span style={{ color: 'var(--amber)', marginLeft: 8 }}>
                  ⚠ {s.condition.toLowerCase().replace(/_/g, ' ')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{
        padding: '10px 20px', borderTop: '1px solid var(--line)', background: 'var(--ivory-100)',
        fontSize: 10.5, color: 'var(--ink-500)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <div>
          {labDirector && <span>Lab Director: {labDirector}</span>}
          {labDirector && labClia && <span style={{ margin: '0 8px' }}>·</span>}
          {labClia && <span>CLIA: {labClia}</span>}
          {!labDirector && !labClia && <span style={{ fontStyle: 'italic' }}>(Lab identity not configured)</span>}
        </div>
        <div style={{ textAlign: 'right' }}>
          {reportedAt > 0 && <div>Reported: {fmtTsRR(reportedAt)}</div>}
          <div style={{ color: 'var(--rust)', fontWeight: 600, fontSize: 10, marginTop: 2 }}>
            PROTOTYPE — NOT FOR CLINICAL USE
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Print HTML builder ────────────────────────────────────────────────────────
// Builds a self-contained HTML document string for window.open() + print().
// No app globals used — all data is passed as plain values.

const buildReportHtml = ({ order, patient, results, testById, specimens, labName, labClia, labDirector, labPhone, labAddress, reportStatus, reportedAt }) => {
  const na = (v, fb = '—') => (v != null && v !== '') ? v : fb;
  const patientName = [patient.lastName, patient.firstName].filter(Boolean).join(', ') || '—';
  const patientAge = patient.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;
  const dobLine = patient.dob
    ? fmtDateRR(new Date(patient.dob).getTime()) + (patientAge != null ? ` (${patientAge}y)` : '')
    : '—';

  const resultRows = (results || []).map(r => {
    const t = testById[r.testId] || {};
    const critical = r.flag && (r.flag === 'HH' || r.flag === 'LL' || r.flag === 'Critical');
    const abnormal = r.flag && ['H', 'L', 'A'].includes(r.flag);
    const refRange = (r.refRangeLow != null && r.refRangeHigh != null)
      ? `${r.refRangeLow} – ${r.refRangeHigh}` : '—';
    const valueColor = critical ? '#dc2626' : abnormal ? '#d97706' : '#1A1917';
    const flagColor  = critical ? '#dc2626' : abnormal ? '#d97706' : '#9ca3af';
    const rowBg = critical ? '#fef2f2' : 'transparent';
    return `
      <tr style="border-bottom:1px solid #e8e3db;background:${rowBg};">
        <td style="padding:5px 8px;font-weight:500;">${t.name || t.code || '—'}</td>
        <td style="padding:5px 8px;font-family:monospace;font-weight:${critical ? 700 : 400};color:${valueColor};">${r.value != null ? r.value : '—'}</td>
        <td style="padding:5px 8px;color:#6b7280;">${r.units || t.units || '—'}</td>
        <td style="padding:5px 8px;font-family:monospace;font-size:11px;color:#6b7280;">${refRange}</td>
        <td style="padding:5px 8px;text-align:center;font-weight:700;color:${flagColor};">${r.flag || '—'}</td>
        <td style="padding:5px 8px;color:#9ca3af;font-size:11px;">${r.status || '—'}</td>
      </tr>`;
  }).join('');

  const specimenRows = (specimens || []).map(s => {
    const condNote = s.condition && s.condition !== 'ACCEPTABLE'
      ? `<span style="color:#d97706;margin-left:8px;">⚠ ${s.condition.toLowerCase().replace(/_/g, ' ')}</span>`
      : '';
    return `<div style="font-size:11.5px;color:#374151;margin-bottom:4px;">
      <span style="font-family:monospace;">${s.accessionNumber || s.barcode || s.id.slice(-6)}</span>
      · ${s.type || '—'} · ${s.container || '—'}
      ${s.collectedAt ? ` · Coll ${fmtDateRR(s.collectedAt)}` : ''}
      ${s.receivedAt ? ` · Rec'd ${fmtDateRR(s.receivedAt)}` : ''}
      ${condNote}
    </div>`;
  }).join('');

  const dxRow = order.diagnosisCodes && order.diagnosisCodes.length
    ? `<tr><td style="padding:2px 0;color:#9ca3af;width:74px;">Dx</td><td>${order.diagnosisCodes.join(', ')}</td></tr>` : '';

  const reportedLine = reportedAt > 0 ? `<div>Reported: ${fmtTsRR(reportedAt)}</div>` : '';
  const labFooterLeft = [
    labDirector ? `Lab Director: ${labDirector}` : null,
    labClia ? `CLIA: ${labClia}` : null,
  ].filter(Boolean).join(' · ') || '<em>(Lab identity not configured)</em>';

  const labHeaderHtml = labName
    ? `<div style="font-size:15px;font-weight:700;">${labName}</div>
       ${labAddress ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${labAddress}</div>` : ''}
       ${labPhone ? `<div style="font-size:11px;color:#6b7280;">${labPhone}</div>` : ''}`
    : `<div style="font-size:12px;font-style:italic;color:#9ca3af;">(Lab name not configured — see System Setup → Lab Identity)</div>`;

  const statusBg  = reportStatus === 'FINAL' ? '#d1fae5' : '#fef3c7';
  const statusClr = reportStatus === 'FINAL' ? '#065f46' : '#92400e';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Lab Report — ${na(order.orderNumber)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1A1917; background: #fff; }
    @media print { body { margin: 0; } @page { margin: 1.2cm; size: letter portrait; } }
    .section-label { font-size: 10px; font-weight: 600; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    table.results-tbl { width: 100%; border-collapse: collapse; }
    table.results-tbl th { text-align: left; padding: 4px 8px; font-size: 10.5px; font-weight: 600; color: #9ca3af; border-bottom: 1px solid #e8e3db; }
    table.info-tbl td { padding: 2px 0; vertical-align: baseline; }
  </style>
</head>
<body>
<div style="max-width:720px;margin:0 auto;padding:24px 20px;">
  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:2px solid #1A1917;margin-bottom:16px;">
    <div>${labHeaderHtml}</div>
    <div style="text-align:right;">
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;">LAB REPORT</div>
      ${labClia ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">CLIA: ${labClia}</div>` : ''}
      <div style="margin-top:6px;display:inline-block;font-size:10px;font-weight:700;color:${statusClr};background:${statusBg};padding:2px 10px;border-radius:999px;">${reportStatus}</div>
    </div>
  </div>

  <!-- Patient + Order -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e8e3db;">
    <div>
      <div class="section-label">Patient</div>
      <table class="info-tbl" style="font-size:12px;">
        <tr><td style="color:#9ca3af;width:74px;">Name</td><td style="font-weight:500;">${patientName}</td></tr>
        <tr><td style="color:#9ca3af;">DOB</td><td>${dobLine}</td></tr>
        <tr><td style="color:#9ca3af;">Sex</td><td>${na(patient.sex)}</td></tr>
        <tr><td style="color:#9ca3af;">MRN</td><td style="font-family:monospace;">${na(patient.mrn)}</td></tr>
      </table>
    </div>
    <div>
      <div class="section-label">Order</div>
      <table class="info-tbl" style="font-size:12px;">
        <tr><td style="color:#9ca3af;width:74px;">Order #</td><td style="font-family:monospace;">${na(order.orderNumber)}</td></tr>
        <tr><td style="color:#9ca3af;">Priority</td><td>${(order.priority || '—').toUpperCase()}</td></tr>
        <tr><td style="color:#9ca3af;">Collected</td><td style="font-family:monospace;">${fmtTsRR(order.collectedAt)}</td></tr>
        <tr><td style="color:#9ca3af;">Received</td><td style="font-family:monospace;">${fmtTsRR(order.receivedAt)}</td></tr>
        ${dxRow}
      </table>
    </div>
  </div>

  <!-- Results -->
  <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e8e3db;">
    <div class="section-label">Results</div>
    ${results.length === 0
      ? '<div style="font-style:italic;color:#9ca3af;">No results on this order yet.</div>'
      : `<table class="results-tbl"><thead><tr>
          <th>Test</th><th>Result</th><th>Units</th><th>Reference range</th>
          <th style="text-align:center;">Flag</th><th>Status</th>
         </tr></thead><tbody>${resultRows}</tbody></table>`
    }
  </div>

  ${specimens.length > 0 ? `
  <!-- Specimens -->
  <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e8e3db;">
    <div class="section-label">Specimens</div>
    ${specimenRows}
  </div>` : ''}

  <!-- Footer -->
  <div style="font-size:10.5px;color:#6b7280;display:flex;justify-content:space-between;align-items:baseline;">
    <div>${labFooterLeft}</div>
    <div style="text-align:right;">
      ${reportedLine}
      <div style="color:#dc2626;font-weight:700;font-size:10px;margin-top:2px;">PROTOTYPE — NOT FOR CLINICAL USE</div>
    </div>
  </div>
</div>
</body>
</html>`;
};

// ── Modal ─────────────────────────────────────────────────────────────────────

const ResultReportModal = ({ orderId, onClose }) => {
  const order    = window.useEntity('orders', orderId);
  const patient  = window.useEntity('patients', order && order.patientId);
  const labCfg   = window.useEntity('lab_config', window.schema && window.schema.LAB_CONFIG_ID);
  const allResults  = window.useEntities('results');
  const allTests    = window.useEntities('tests');
  const allSpecimens = window.useEntities('specimens');

  const results = useMemoRR(
    () => (allResults || []).filter(r => r.orderId === orderId && !r.supersededByResultId && r.status !== 'cancelled'),
    [allResults, orderId],
  );
  const specimens = useMemoRR(
    () => (allSpecimens || []).filter(s => s.orderId === orderId),
    [allSpecimens, orderId],
  );
  const testById = useMemoRR(
    () => Object.fromEntries((allTests || []).map(t => [t.id, t])),
    [allTests],
  );

  const labName        = labCfg && labCfg.labName;
  const labClia        = labCfg && labCfg.labClia;
  const labDirector    = labCfg && labCfg.labDirectorName;
  const labPhone       = labCfg && labCfg.labPhone;
  const labAddress     = labCfg && labCfg.labAddress;

  const isAllFinal = results.length > 0 && results.every(r => r.status === 'final' || r.status === 'corrected');
  const reportStatus = isAllFinal ? 'FINAL' : 'PRELIMINARY';
  const reportedAt   = results.reduce((max, r) => Math.max(max, r.releasedAt || r.verifiedAt || r.createdAt || 0), 0);

  const printReport = () => {
    if (!order || !patient) return;
    const html = buildReportHtml({
      order, patient, results, testById, specimens,
      labName, labClia, labDirector, labPhone, labAddress,
      reportStatus, reportedAt,
    });
    const win = window.open('', '_blank', 'width=860,height=1100,resizable=yes,scrollbars=yes');
    if (!win) {
      window.safetyNotice && window.safetyNotice({
        tone: 'info',
        title: 'Pop-up blocked',
        message: 'Allow pop-ups for this page and try again.',
      });
      return;
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    // Small delay so the document is fully parsed before print dialog opens.
    setTimeout(() => { try { win.print(); } catch (_) {} }, 300);
  };

  const loading = !order || !patient;

  return (
    <div className="modal-backdrop backdrop-in" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal scale-in" style={{
        maxWidth: 740, width: '92vw', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        padding: 0,
      }}>
        {/* Modal header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Lab Report Preview</div>
            {order && patient ? (
              <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 1 }}>
                {order.orderNumber} · {[patient.lastName, patient.firstName].filter(Boolean).join(', ')}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: 'var(--ink-400)', marginTop: 1 }}>Loading…</div>
            )}
          </div>
          {!loading && (
            <span className="pill" data-tone={reportStatus === 'FINAL' ? 'sage' : 'amber'} style={{ fontSize: 10.5 }}>
              {reportStatus}
            </span>
          )}
          <button className="btn" data-variant="primary" onClick={printReport} disabled={loading}>
            Print / Save PDF
          </button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        {/* Preview body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 20, background: 'var(--ivory-100)' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ink-400)' }}>Loading report…</div>
          ) : (
            <ReportPreview
              order={order} patient={patient} results={results}
              testById={testById} specimens={specimens}
              labName={labName} labClia={labClia} labDirector={labDirector}
              labPhone={labPhone} labAddress={labAddress}
              reportStatus={reportStatus} reportedAt={reportedAt}
            />
          )}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ResultReportModal });
