// labels.js — Specimen label generation.
//
// Produces both:
//   1. A ZPL II program string (the wire format Zebra printers consume).
//   2. A "render model" — same data, structured for an HTML/SVG preview that
//      mirrors what the physical label will look like.
//
// Format target: 2.0" × 1.0" Zebra label (standard chemistry/hematology size),
// 203 dpi. That's 406 dots wide × 203 dots tall for ZPL.
//
// API:
//   await window.labels.build(specimenOrId, opts) → { zpl, render, meta }
//     opts: { copies?: number, includeBarcode?: boolean = true }
//
// The label includes (top to bottom):
//   - Accession number as Code 128 barcode + human-readable
//   - Patient: "LASTNAME, FIRSTNAME · MRN xxxxx"
//   - DOB · Sex · age (if known)
//   - Specimen type · Container
//   - Tests (truncated to ~3 codes + "+N more")
//   - Collected timestamp · Order number

(function () {

  // 1x2 @ 203 dpi — portrait by default. Portrait reads naturally on a
  // tube held upright (sticker on the front) and matches the `label_templates`
  // admin form's new-template defaults. The Labels admin form is the source
  // of truth for any per-template variation; this constant only governs the
  // inline-fallback path used when no template matches.
  const W = 203;
  const H = 406;
  const MAX_ZPL_BYTES = 12000;
  const MAX_COPIES = 10;
  const DENIED_TEMPLATE_COMMANDS = [
    '^J', '~J', '^KP', '^MP', '^MU', '^PM', '^SC', '^SX', '^SZ',
    '^SS', '^CT', '^CC', '^CD', '^DF', '^ID', '~DG', '~DY', '^HW', '^HH'
  ];

  // ── Helpers ─────────────────────────────────────────────────────────────

  const __zplEsc = (s) => {
    if (s == null) return '';
    // ZPL field separators — tildes, carets, backslashes have meaning. Strip
    // anything that could break the field; we don't try to encode these
    // characters since labels rarely need them.
    return String(s)
      .replace(/[\^~\\]/g, ' ')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  };

  const __ageYears = (dob) => {
    if (!dob) return null;
    const d = (typeof dob === 'number') ? new Date(dob) : new Date(dob);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let y = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) y--;
    return y;
  };

  const __fmtTs = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 16).replace('T', ' ');
  };

  const __byteLength = (s) => {
    const text = s == null ? '' : String(s);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
    return text.length;
  };

  const lintZpl = (zpl) => {
    const text = zpl == null ? '' : String(zpl);
    const errors = [];
    const bytes = __byteLength(text);
    if (!text.trim()) errors.push('ZPL body is empty');
    if (bytes > MAX_ZPL_BYTES) errors.push('ZPL body is too large (' + bytes + ' bytes)');
    if (!/\^XA/.test(text) || !/\^XZ/.test(text)) errors.push('ZPL must include ^XA and ^XZ');
    for (const cmd of DENIED_TEMPLATE_COMMANDS) {
      if (text.includes(cmd)) errors.push('printer setup command ' + cmd + ' is not allowed in templates');
    }
    const pqMatches = [...text.matchAll(/\^PQ(\d{1,6})/g)];
    for (const m of pqMatches) {
      const count = Number(m[1]);
      if (!Number.isFinite(count) || count < 1 || count > MAX_COPIES) {
        errors.push('copy count ^PQ' + m[1] + ' exceeds max ' + MAX_COPIES);
      }
    }
    return { ok: errors.length === 0, errors, bytes };
  };

  // Force ^PW (print width) and ^LL (label length) in a ZPL block to match
  // given dimensions in dots. Existing directives are replaced; missing ones
  // are inserted right after the first ^XA. The Labels & Printing admin form
  // saves width/height/dpi per template, but the wire output ignored those
  // fields entirely until this helper landed — operators would shrink a
  // template to 0.75×1.5" in the form and watch the printer keep emitting
  // ^LL203 from whatever was baked into the template body, then chase the
  // "design wraps to a second label" ghost when the configured printable
  // region didn't match the design's actual extent.
  const __forceLabelDimensions = (zpl, widthDots, heightDots) => {
    let out = String(zpl == null ? '' : zpl);
    if (/\^PW\d+/.test(out)) {
      out = out.replace(/\^PW\d+/g, `^PW${widthDots}`);
    } else {
      out = out.replace(/\^XA/, `^XA\n^PW${widthDots}`);
    }
    if (/\^LL\d+/.test(out)) {
      out = out.replace(/\^LL\d+/g, `^LL${heightDots}`);
    } else {
      out = out.replace(/\^XA/, `^XA\n^LL${heightDots}`);
    }
    return out;
  };

  // ── Template lookup ─────────────────────────────────────────────────────
  //
  // `label_templates` is the admin-managed source of truth for label layout.
  // Selection runs most-specific first so a `(whole_blood, BB)` template
  // wins over a generic `(whole_blood, *)` which beats the catch-all `(*, *)`.
  // Inactive templates are skipped. When no template matches, callers fall
  // back to the inline default body in `build()`.
  //
  //   await pickTemplate({ specimenType, testCode })
  //     → labelTemplate row | null

  const pickTemplate = async ({ specimenType, testCode } = {}) => {
    if (!window.db || !window.db.COLLECTIONS || !window.db.COLLECTIONS.includes('label_templates')) {
      return null;  // collection not provisioned yet (older DB version)
    }
    const all = await window.db.list('label_templates', t => t.active !== false);
    if (!all || all.length === 0) return null;
    // Score each template by specificity. Higher score = better match.
    // Exact matches on both specimenType and testCode beat partial matches.
    let best = null, bestScore = -1;
    for (const t of all) {
      const wantsType = (t.specimenType || '').toLowerCase();
      const wantsTest = (t.testCode || '').toUpperCase();
      const haveType = (specimenType || '').toLowerCase();
      const haveTest = (testCode || '').toUpperCase();
      // Reject mismatches where the template is constrained but the request doesn't fit.
      if (wantsType && wantsType !== haveType) continue;
      if (wantsTest && wantsTest !== haveTest) continue;
      // Score: 2 for matched type, 1 for matched test code, plus 1 each for non-empty constraints.
      let score = 0;
      if (wantsType) score += 2;
      if (wantsTest) score += 2;
      // Tiebreak by `updatedAt` (most recently edited wins) for two equally-scoped templates.
      if (score > bestScore || (score === bestScore && best && (t.updatedAt || 0) > (best.updatedAt || 0))) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  };

  // Substitute placeholder tokens in a template body. Tokens are bare
  // `{name}` — caller is responsible for sanitizing the model first if the
  // body will be sent to a printer (or rendered as HTML); we ZPL-escape here
  // for the ZPL path. Unknown tokens are left empty.
  const __PLACEHOLDER_KEYS = [
    'patient_line', 'mrn', 'dob', 'sex', 'age',
    'type', 'container', 'tests', 'order_number', 'accession',
  ];
  const applyTemplate = (templateBody, render) => {
    if (!templateBody) return '';
    const map = {
      patient_line: __zplEsc(render.patientLine),
      mrn:          __zplEsc(render.mrn),
      dob:          __zplEsc(render.dob),
      sex:          __zplEsc(render.sex),
      age:          render.age == null ? '' : String(render.age),
      type:         __zplEsc(render.specimenType),
      container:    __zplEsc(render.container),
      tests:        __zplEsc(render.testsShort),
      order_number: __zplEsc(render.orderNumber),
      accession:    __zplEsc(render.accession),
    };
    return templateBody.replace(/\{([a-z_]+)\}/g, (m, key) => {
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : '';
    });
  };

  // ── Build ───────────────────────────────────────────────────────────────

  const build = async (specimenOrId, opts = {}) => {
    const specimen = (typeof specimenOrId === 'string')
      ? await window.db.get('specimens', specimenOrId)
      : specimenOrId;
    if (!specimen) throw new Error('[labels] specimen not found');

    const order = specimen.orderId ? await window.db.get('orders', specimen.orderId) : null;
    const patient = order && order.patientId ? await window.db.get('patients', order.patientId) : null;
    const tests = order && order.testIds ? await Promise.all(
      order.testIds.map(id => window.db.get('tests', id))
    ) : [];
    const testCodes = tests.filter(Boolean).map(t => t.code);

    const render = {
      accession: specimen.accessionNumber || '',
      patientLine: patient
        ? `${(patient.lastName || '').toUpperCase()}, ${patient.firstName || ''}`.trim()
        : '— UNKNOWN PATIENT —',
      mrn: patient ? (patient.mrn || '') : '',
      dob: patient ? (patient.dob || '') : '',
      sex: patient ? (patient.sex || '') : '',
      age: patient ? __ageYears(patient.dob) : null,
      specimenType: specimen.type || specimen.specimenType || '—',
      container: specimen.container || '—',
      orderNumber: order ? (order.orderNumber || '') : '',
      collectedAt: __fmtTs(specimen.collectedAt),
      receivedAt: __fmtTs(specimen.receivedAt),
      testsShort: testCodes.length === 0
        ? '—'
        : (testCodes.length <= 3 ? testCodes.join(', ') : `${testCodes.slice(0, 3).join(', ')} +${testCodes.length - 3}`),
      testCount: testCodes.length,
      testCodes,
    };

    // ZPL II program. ^XA opens, ^XZ closes. Coordinates are top-left in dots.
    // Field origins (^FO x,y) drive placement; ^A0N,h,w sets font height/width.
    // ^BCN,h,Y,N,N is Code 128: height, human-readable above, no checkdigit, no mode.
    const includeBarcode = opts.includeBarcode !== false;
    const copies = Math.min(MAX_COPIES, Math.max(1, Number(opts.copies || 1)));

    // ── Template selection ───────────────────────────────────────────────
    //
    // First try the admin-managed `label_templates` collection — caller can
    // override with `opts.template` (a template row) or `opts.templateCode`
    // (lookup by code). When a template is found we substitute placeholders
    // into its ZPL body. When none matches, we use the inline default below.
    let template = opts.template || null;
    if (!template && opts.templateCode) {
      const all = await window.db.list('label_templates', t => t.code === opts.templateCode);
      template = all[0] || null;
    }
    if (!template) {
      // Pull a representative test code so a (whole_blood, BB) template can win.
      // Use the first test code on the order; refining to per-test labels would
      // require multi-template iteration which lab workflows rarely need.
      const repTestCode = testCodes[0] || '';
      template = await pickTemplate({ specimenType: render.specimenType, testCode: repTestCode });
    }

    let zpl;
    let usedTemplate = null;
    if (template && template.zpl) {
      // Template path — operator-managed body with placeholder substitution.
      zpl = applyTemplate(template.zpl, render);
      // Make the Labels & Printing form's width/height/dpi authoritative.
      // The form is the source of truth for the printable region; template
      // bodies carry layout only. See __forceLabelDimensions header for
      // background.
      const __dpi   = Number(template.dpi)    || 203;
      const __wDots = Math.round((Number(template.width)  || 2.0) * __dpi);
      const __hDots = Math.round((Number(template.height) || 1.0) * __dpi);
      zpl = __forceLabelDimensions(zpl, __wDots, __hDots);
      // Append copies directive when requested. Templates may already have
      // their own `^PQ` so we only add when missing.
      if (copies > 1 && !/\^PQ\d/.test(zpl)) {
        zpl = zpl.replace(/\^XZ\s*$/, `^PQ${copies}\n^XZ`);
      }
      const lint = lintZpl(zpl);
      if (!lint.ok) throw new Error('[labels] unsafe ZPL template: ' + lint.errors.slice(0, 3).join('; '));
      usedTemplate = { id: template.id, code: template.code, name: template.name };
    } else {
      // Inline default — portrait 1×2 layout. Tubes are read upright; the
      // patient block sits below the barcode header and the order/coll
      // footer pins to the bottom edge. Coordinates target ^PW203 ^LL406.
      const lines = [];
      lines.push('^XA');
      lines.push(`^PW${W}`);
      lines.push(`^LL${H}`);
      lines.push('^LH0,0');
      if (includeBarcode && render.accession) {
        lines.push('^FO8,8');
        lines.push('^BY2,2.5,80');
        lines.push('^BCN,80,Y,N,N');
        lines.push(`^FD${__zplEsc(render.accession)}^FS`);
      }
      lines.push(`^FO8,118^A0N,18,18^FD${__zplEsc(render.patientLine)}^FS`);
      lines.push(`^FO8,148^A0N,14,14^FD${__zplEsc('MRN ' + render.mrn)}^FS`);
      const id2 = (render.dob || '') + (render.sex ? '  ' + render.sex : '') + (render.age != null ? '  ' + render.age + 'y' : '');
      lines.push(`^FO8,168^A0N,14,14^FD${__zplEsc(id2)}^FS`);
      lines.push(`^FO8,196^A0N,16,16^FD${__zplEsc(render.specimenType)}^FS`);
      lines.push(`^FO8,218^A0N,14,14^FD${__zplEsc(render.container)}^FS`);
      lines.push(`^FO8,250^A0N,12,12^FDTESTS^FS`);
      lines.push(`^FO8,268^A0N,16,16^FD${__zplEsc(render.testsShort)}^FS`);
      lines.push(`^FO8,378^A0N,12,12^FD${__zplEsc('ORD ' + render.orderNumber)}^FS`);
      if (copies > 1) lines.push(`^PQ${copies}`);
      lines.push('^XZ');
      zpl = lines.join('\n');
    }
    const lint = lintZpl(zpl);
    if (!lint.ok) throw new Error('[labels] unsafe ZPL output: ' + lint.errors.slice(0, 3).join('; '));

    // meta carries dimensions in INCHES for the preview/print paths
    // (renderHtml multiplies by px-per-inch). The inline-default ZPL above
    // uses dots (W=203, H=406) for ^PW/^LL — those are wire units. Reporting
    // dots here caused the HTML preview to render at 29,000+ px, blanking the
    // modal because content overflowed the clipped 320px column.
    return {
      zpl,
      render,
      meta: {
        width:  usedTemplate ? (Number(template.width)  || 1.0) : 1.0,
        height: usedTemplate ? (Number(template.height) || 2.0) : 2.0,
        dpi:    usedTemplate ? (Number(template.dpi)    || 203) : 203,
        copies, includeBarcode,
        template: usedTemplate,
        source: usedTemplate ? 'template' : 'default',
      },
    };
  };

  // Escape values before they're spliced into an HTML template. The render
  // model carries patient-supplied data verbatim, so the HTML preview must
  // not trust it. Without this, a patient name like `<script>alert(1)</script>`
  // would execute when the modal opens via dangerouslySetInnerHTML.
  const __htmlEsc = (s) => {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Convenience for a print preview window that uses HTML rendering instead
  // of ZPL — used by the UI when no Zebra is wired.
  //
  // Sizes the preview box to actual template dimensions (passed in via the
  // `meta` returned by build()), then picks a layout that fits the aspect.
  // Portrait (taller than wide) stacks each datum on its own row to match
  // the ZPL portrait template; landscape uses the wide-row layout. Both
  // set `box-sizing:border-box` (without it, padding pushed content past
  // the constraint) and `overflow:hidden` (without it, spillover into
  // adjacent labels mirrored exactly what the printer would have done —
  // wrapped to a second label).
  //
  // `meta` is optional for backward compat — falls back to 2×1 landscape
  // at the previous fixed scale if absent.
  const SCREEN_PX_PER_INCH = 144;
  const renderHtml = (render, meta) => {
    const e = __htmlEsc;
    const widthIn  = (meta && Number(meta.width))  || 2.0;
    const heightIn = (meta && Number(meta.height)) || 1.0;
    const pxW = Math.round(widthIn  * SCREEN_PX_PER_INCH);
    const pxH = Math.round(heightIn * SCREEN_PX_PER_INCH);
    const portrait = heightIn > widthIn;

    if (portrait) {
      // Vertical stack — each line has room to breathe at narrower widths.
      return `<div style="font:11px Geist,system-ui;width:${pxW}px;height:${pxH}px;padding:8px;border:1px solid #000;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;overflow:hidden;background:#fff;color:#000;">
        <div style="font:13px Geist Mono,monospace;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:4px;letter-spacing:0.5px;">${e(render.accession)}</div>
        <div style="font-weight:600;font-size:13px;">${e(render.patientLine)}</div>
        <div style="font-size:10px;color:#444;">MRN ${e(render.mrn)}</div>
        <div style="font-size:10px;color:#444;">${e(render.dob)}${render.sex ? ' · ' + e(render.sex) : ''}${render.age != null ? ' · ' + render.age + 'y' : ''}</div>
        <div style="margin-top:4px;font-size:12px;">${e(render.specimenType)}</div>
        <div style="font-size:10px;color:#444;">${e(render.container)}</div>
        <div style="margin-top:4px;font-size:9px;color:#666;text-transform:uppercase;letter-spacing:0.04em;">Tests</div>
        <div style="font-size:11px;">${e(render.testsShort)}</div>
        <div style="margin-top:auto;font-size:9px;color:#666;">ORD ${e(render.orderNumber)}</div>
      </div>`;
    }

    // Landscape — same compact-row layout as before, scaled to actual dims.
    return `<div style="font:12px Geist,system-ui;width:${pxW}px;height:${pxH}px;padding:8px;border:1px solid #000;box-sizing:border-box;overflow:hidden;background:#fff;color:#000;">
      <div style="font:14px Geist Mono,monospace;border-bottom:2px solid #000;padding-bottom:4px;margin-bottom:4px;letter-spacing:1px;">${e(render.accession)}</div>
      <div style="font-weight:600;">${e(render.patientLine)}</div>
      <div style="font-size:11px;color:#444;">MRN ${e(render.mrn)} · DOB ${e(render.dob)} · ${e(render.sex)}${render.age != null ? ' · ' + render.age + 'y' : ''}</div>
      <div style="margin-top:4px;">${e(render.specimenType)} · ${e(render.container)}</div>
      <div style="font-size:11px;">TESTS: ${e(render.testsShort)}</div>
      <div style="font-size:10px;color:#666;margin-top:4px;">ORD ${e(render.orderNumber)} · COLL ${e(render.collectedAt)}</div>
    </div>`;
  };

  window.labels = { build, renderHtml, pickTemplate, applyTemplate, lintZpl, PLACEHOLDER_KEYS: __PLACEHOLDER_KEYS };

})();
