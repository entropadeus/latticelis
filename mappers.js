// mappers.js — Lattice Mapper Language (LML) parser + evaluator.
//
// LML is a tiny, declarative format for mapping between external partner
// formats (CSV, JSON, eventually HL7 dialects) and the LIS entity model.
// Each mapper file is human-readable and editable in plain text.
//
//   # comments start with hash
//   key = value           (header lines)
//   target = expression   (mapping lines)
//
// Header keys: `name`, `direction` (inbound|outbound), `format` (csv|json|hl7),
// `header` (csv only — has a header row), `delimiter` (csv only — default ,)
//
// Mapping lines:
//   For inbound: target is a dotted path on the LIS entity (patient.mrn,
//     order.orderNumber, order.testIds), expression evaluates against the
//     incoming row.
//   For outbound: target is the output column name / field, expression
//     evaluates against a context { patient, order, specimen, result, test }.
//
// Expression grammar:
//   expr     := call | ident | string | number | array
//   call     := IDENT '(' [arg (',' arg)*] ')'
//   arg      := expr | IDENT '=' expr        (kvPair, only meaningful inside map())
//   ident    := dotted name resolved against the row/context
//   string   := "..."  (escapes: \" \\ \n)
//   number   := -? digits (.digits)?
//
// Built-in functions:
//   date(s, fmt)               parse external date → ISO date "YYYY-MM-DD"
//   formatDate(ts, fmt)        format a JS timestamp / ISO into a string
//   map(field, k1=v1, k2=v2)   lookup table; falls through to field value
//   lookup(field, k1=v1, ...)  alias for map
//   split(field, sep)          string → array
//   join(arr, sep)             array → string
//   concat(a, b, c, ...)       string concat
//   trim(field), upper(field), lower(field)
//   default(field, fallback)   if field is empty/null, use fallback
//   slice(field, start, end)   substring
//   int(field), float(field)   numeric coercion
//   if(cond, then, else)       ternary
//
// Public API on window.mappers:
//   parse(text) → { meta, mappings, errors }
//   apply(mapper, row) → result object (entities for inbound, fields for outbound)
//   ingestInbound(mapperId, payload) → applies + persists + publishes events
//
// The output of `apply` for an inbound CSV mapper is shaped like:
//   { patient: {...}, order: {...}, tests: [{code, name}], specimen?: {...} }
// which the ingest step converts to db.put + events.publish.

(function () {

  // ── Tokenizer ────────────────────────────────────────────────────────────

  const tokenize = (line) => {
    const out = [];
    let i = 0;
    const n = line.length;
    while (i < n) {
      const c = line[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '#') break;
      if (c === '"') {
        let j = i + 1, s = '';
        while (j < n && line[j] !== '"') {
          if (line[j] === '\\' && j + 1 < n) {
            const next = line[j + 1];
            s += next === 'n' ? '\n' : next === 't' ? '\t' : next;
            j += 2;
          } else { s += line[j]; j++; }
        }
        out.push({ type: 'STRING', value: s });
        i = j + 1;
        continue;
      }
      if ('()'.includes(c) || c === ',' || c === '=') {
        out.push({ type: c, value: c });
        i++;
        continue;
      }
      // Identifier or number — anything that isn't whitespace/punct
      let j = i;
      while (j < n && !' \t()=,#"'.includes(line[j])) j++;
      const tok = line.slice(i, j);
      if (/^-?\d+(\.\d+)?$/.test(tok)) out.push({ type: 'NUMBER', value: Number(tok) });
      else out.push({ type: 'IDENT', value: tok });
      i = j;
    }
    return out;
  };

  // ── Expression parser ───────────────────────────────────────────────────

  const parseExpr = (tokens) => {
    let pos = 0;
    const peek = () => tokens[pos];
    const eat = (type) => {
      const t = tokens[pos];
      if (!t || (type && t.type !== type)) {
        throw new Error(`expected ${type} at token ${pos}, got ${t ? t.type : 'EOF'}`);
      }
      pos++;
      return t;
    };

    const parsePrimary = () => {
      const t = peek();
      if (!t) throw new Error('unexpected end of expression');
      if (t.type === 'STRING' || t.type === 'NUMBER') {
        eat();
        return { kind: 'lit', value: t.value };
      }
      if (t.type === 'IDENT') {
        eat();
        if (peek() && peek().type === '(') {
          eat('(');
          const args = [];
          while (peek() && peek().type !== ')') {
            // Look ahead for kvPair: IDENT '=' expr
            if (peek().type === 'IDENT' && tokens[pos + 1] && tokens[pos + 1].type === '=') {
              const key = eat('IDENT').value;
              eat('=');
              // In kv pair values, bare IDENTs are string literals (so `S=stat` yields "stat",
              // not a column lookup). To force a column reference, wrap in default(col, "").
              let val;
              const next = peek(), after = tokens[pos + 1];
              const isBareIdent = next && next.type === 'IDENT'
                && (!after || (after.type !== '(' && after.type !== '.'));
              if (isBareIdent) {
                val = { kind: 'lit', value: eat('IDENT').value };
              } else {
                val = parseExpression();
              }
              args.push({ kind: 'pair', key, value: val });
            } else {
              args.push(parseExpression());
            }
            if (peek() && peek().type === ',') eat(',');
          }
          eat(')');
          return { kind: 'call', name: t.value, args };
        }
        return { kind: 'ident', name: t.value };
      }
      throw new Error(`unexpected token ${t.type}`);
    };

    const parseExpression = () => parsePrimary();
    const ast = parseExpression();
    if (pos < tokens.length) {
      throw new Error('unexpected trailing tokens');
    }
    return ast;
  };

  // ── Mapper file parser ──────────────────────────────────────────────────

  const HEADER_KEYS = new Set(['name', 'direction', 'format', 'header', 'delimiter', 'description']);

  const parse = (text) => {
    const meta = { name: '', direction: 'inbound', format: 'csv', header: true, delimiter: ',', description: '' };
    const mappings = [];
    const errors = [];
    if (!text) return { meta, mappings, errors: ['empty input'] };
    const lines = text.split(/\r?\n/);
    let lineNo = 0;
    for (const raw of lines) {
      lineNo++;
      const line = raw.replace(/^\s+|\s+$/g, '');
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx < 0) { errors.push(`line ${lineNo}: expected "key = value"`); continue; }
      const key = line.slice(0, eqIdx).trim();
      const rhs = line.slice(eqIdx + 1).trim();
      if (HEADER_KEYS.has(key) && !key.includes('.')) {
        // Header value is a literal (string-ish), no expression parsing.
        if (key === 'header') meta.header = !/^false|0|no$/i.test(rhs);
        else meta[key] = rhs.replace(/^"|"$/g, '');
        continue;
      }
      try {
        const tokens = tokenize(rhs);
        const expr = parseExpr(tokens);
        mappings.push({ target: key, expr, sourceLine: lineNo, raw });
      } catch (e) {
        errors.push(`line ${lineNo}: ${e.message}`);
      }
    }
    return { meta, mappings, errors };
  };

  // ── Evaluator ───────────────────────────────────────────────────────────

  const isEmpty = (v) => v == null || v === '';

  const FN = {
    date(args, env) {
      const [s, fmt] = args;
      if (!s) return '';
      // Try the explicit format; otherwise let Date parse.
      if (fmt) {
        const formatted = String(fmt);
        const parts = String(s).split(/[^0-9]/);
        const tokens = formatted.match(/MM|DD|YYYY|YY/g) || [];
        const obj = {};
        tokens.forEach((tok, i) => { obj[tok] = parts[i]; });
        if (obj.YYYY && obj.MM && obj.DD) return `${obj.YYYY}-${obj.MM}-${obj.DD}`;
        if (obj.YY && obj.MM && obj.DD) {
          const yr = +obj.YY < 50 ? 2000 + +obj.YY : 1900 + +obj.YY;
          return `${yr}-${obj.MM}-${obj.DD}`;
        }
      }
      const d = new Date(s);
      if (isNaN(d.getTime())) return '';
      return d.toISOString().slice(0, 10);
    },
    formatDate(args) {
      const [ts, fmt] = args;
      const d = (ts == null || ts === '' || ts === 0) ? new Date() : new Date(ts);
      if (isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      const map = {
        YYYY: d.getFullYear(), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()),
        HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
      };
      return String(fmt || 'YYYY-MM-DD').replace(/YYYY|MM|DD|HH|mm|ss/g, t => map[t]);
    },
    now(args) { return FN.formatDate([Date.now(), args[0] || 'YYYY-MM-DD HH:mm']); },
    map(args) {
      const [value, ...pairs] = args;
      // pairs are { kind: 'pair', key, value: <ast already evaluated to literal> }
      // but we receive them already evaluated as object {key, value}? No — we accept
      // raw "pair" objects via kvPairs. See applyExpr.
      // Here, pairs is the list of pair entries with .key/.value already resolved.
      for (const p of pairs) {
        if (!p || typeof p !== 'object' || !('__pair' in p)) continue;
        if (String(value) === String(p.key)) return p.value;
      }
      return value;
    },
    lookup(args) { return FN.map(args); },
    split(args) {
      const [s, sep] = args;
      if (!s) return [];
      return String(s).split(String(sep || ',')).map(x => x.trim()).filter(Boolean);
    },
    join(args) {
      const [arr, sep] = args;
      if (!Array.isArray(arr)) return '';
      return arr.join(String(sep || ','));
    },
    concat(args) { return args.map(a => a == null ? '' : String(a)).join(''); },
    trim(args)   { return args[0] == null ? '' : String(args[0]).trim(); },
    upper(args)  { return args[0] == null ? '' : String(args[0]).toUpperCase(); },
    lower(args)  { return args[0] == null ? '' : String(args[0]).toLowerCase(); },
    default(args) { const [v, fb] = args; return isEmpty(v) ? fb : v; },
    slice(args)  { const [s, a, b] = args; if (s == null) return ''; return String(s).slice(a || 0, b == null ? undefined : b); },
    int(args)    { const v = args[0]; if (v == null || v === '') return null; const n = parseInt(v, 10); return isNaN(n) ? null : n; },
    float(args)  { const v = args[0]; if (v == null || v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; },
    if(args)     { const [c, t, e] = args; return c ? t : e; },
  };

  const resolveIdent = (name, env) => {
    // Dotted access: a.b.c
    const parts = name.split('.');
    let cur = env;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  };

  const evalExpr = (ast, env) => {
    if (!ast) return undefined;
    if (ast.kind === 'lit')   return ast.value;
    if (ast.kind === 'ident') return resolveIdent(ast.name, env);
    if (ast.kind === 'call') {
      const fn = FN[ast.name];
      if (!fn) throw new Error(`unknown function: ${ast.name}`);
      const evaledArgs = ast.args.map(a => {
        if (a.kind === 'pair') {
          return { __pair: true, key: a.key, value: evalExpr(a.value, env) };
        }
        return evalExpr(a, env);
      });
      return fn(evaledArgs, env);
    }
    throw new Error(`bad ast node ${ast.kind}`);
  };

  // ── Application ─────────────────────────────────────────────────────────

  const apply = (mapper, env) => {
    const out = {};
    for (const m of mapper.mappings) {
      try {
        const value = evalExpr(m.expr, env);
        // Set out[target] supporting dotted paths.
        const parts = m.target.split('.');
        let cur = out;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
      } catch (e) {
        out.__errors = out.__errors || [];
        out.__errors.push(`${m.target}: ${e.message}`);
      }
    }
    return out;
  };

  // ── CSV utilities ───────────────────────────────────────────────────────

  const splitCsvLine = (line, delim) => {
    const out = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === delim) { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const parseCsv = (text, opts = {}) => {
    const delim = opts.delimiter || ',';
    const lines = text.split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };
    const first = splitCsvLine(lines[0], delim);
    if (opts.header !== false) {
      const headers = first;
      const rows = lines.slice(1).map(l => {
        const cols = splitCsvLine(l, delim);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim(); });
        return obj;
      });
      return { headers, rows };
    }
    return { headers: [], rows: lines.map(l => splitCsvLine(l, delim)) };
  };

  // ── Inbound: payload + mapper → entities (and persist) ──────────────────

  // Accept either a parsed mapper ({meta,mappings}) or raw script text.
  const __coerceMapper = (m) => (typeof m === 'string' ? parse(m) : m);

  const applyInboundCsv = (mapper, payload) => {
    const m = __coerceMapper(mapper);
    const { rows, headers } = parseCsv(payload, { delimiter: m.meta.delimiter, header: m.meta.header });
    const results = rows.map(row => apply(m, row));
    return { rows: results, headers };
  };

  const applyInboundJson = (mapper, payload) => {
    const m = __coerceMapper(mapper);
    let parsed;
    try { parsed = JSON.parse(payload); }
    catch (e) { return { rows: [], errors: ['invalid JSON: ' + e.message] }; }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    return { rows: items.map(item => apply(m, item)) };
  };

  const ingestInboundResult = async (mapped, opts = {}) => {
    // mapped looks like { patient: {...}, order: {...}, tests: [{code,name}] | testIds: [...] }
    const errors = [];
    let patient = null, order = null, testIds = [];

    if (mapped.patient && mapped.patient.mrn) {
      const existing = (await window.db.list('patients', p => p.mrn === mapped.patient.mrn))[0];
      if (existing) {
        patient = existing;
      } else {
        patient = window.schema.newPatient(mapped.patient);
        await window.db.put('patients', patient);
      }
    } else {
      errors.push('no patient.mrn in mapped output');
    }

    if (mapped.order) {
      // Resolve test ids — mapper either provides testIds (already an array of codes
      // or our internal ids) or `tests` as an array of {code,name}.
      const codeList = Array.isArray(mapped.order.testIds)
        ? mapped.order.testIds.filter(Boolean)
        : (typeof mapped.order.testIds === 'string' && mapped.order.testIds
            ? mapped.order.testIds.split(/[;,]/).map(s => s.trim()).filter(Boolean)
            : []);
      if (Array.isArray(mapped.tests)) {
        for (const t of mapped.tests) {
          const code = typeof t === 'string' ? t : (t && t.code);
          if (code) codeList.push(code);
        }
      }
      for (const code of codeList) {
        const incoming = Array.isArray(mapped.tests)
          ? mapped.tests.find(t => (typeof t === 'string' ? t : t && t.code) === code)
          : null;
        let test = (await window.db.list('tests', t => t.code === code))[0];
        if (!test) {
          test = window.schema.newTest({
            code,
            name: incoming && incoming.name ? incoming.name : code,
            loinc: incoming && incoming.loinc ? incoming.loinc : '',
          });
          await window.db.put('tests', test);
        }
        testIds.push(test.id);
      }
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const allOrders = await window.db.list('orders');
      const todayCount = allOrders.filter(o => (o.orderedAt || o.createdAt || 0) >= todayStart.getTime()).length;
      const fallbackOrderNum = 'L' + new Date().toISOString().slice(0,10).replace(/-/g,'') + String(todayCount + 1).padStart(4, '0');
      const placer = mapped.order.placerOrderNumber || mapped.order.placerOrder || mapped.order.orderNumber || '';
      const filler = mapped.order.fillerOrderNumber || mapped.order.fillerOrder || mapped.order.orderNumber || '';
      order = window.schema.newOrder({
        ...mapped.order,
        orderNumber: filler || mapped.order.orderNumber || fallbackOrderNum,
        placerOrderNumber: placer,
        fillerOrderNumber: filler || fallbackOrderNum,
        patientId: patient ? patient.id : null,
        clientId: opts.clientId || mapped.order.clientId || null,
        testIds,
      });
      await window.db.put('orders', order);
      window.events.publish(window.EVENTS.ORDER_CREATED, {
        entityType: 'order', entityId: order.id, order, patient,
        viaMapper: opts.mapperName || true,
      });
    } else {
      errors.push('no order in mapped output');
    }

    return { ok: errors.length === 0, patient, order, testIds, errors };
  };

  // ── Sample mappers (auto-seeded so the admin page has something to look at) ──

  const SAMPLES = [
    {
      id: 'mapper_csv_orders_v1',
      name: 'Generic CSV Orders',
      builtin: true,
      text: `# Generic flat-CSV order intake — fits most outreach EMR exports.
# Comments start with #. Lines are "target = expression".
name      = Generic CSV Orders
direction = inbound
format    = csv
header    = true
delimiter = ,
description = Map a CSV row to Patient + Order + Tests.

# --- Patient ---
patient.mrn        = MRN
patient.lastName   = LastName
patient.firstName  = FirstName
patient.dob        = date(DOB, "YYYY-MM-DD")
patient.sex        = map(Sex, M=M, F=F, U=X)

# --- Order ---
order.orderNumber  = OrderID
order.placerOrderNumber = OrderID
order.priority     = map(Priority, S=stat, R=routine, T=routine, ASAP=asap)
order.testIds      = split(TestCodes, ";")
order.providerId   = default(Provider, "Unknown")
order.facility     = Site
order.orderedAt    = date(OrderDate, "YYYY-MM-DD")
order.collectedAt  = date(CollectedDate, "YYYY-MM-DD")
order.receivedAt   = date(ReceivedDate, "YYYY-MM-DD")
order.notes        = concat("Imported via mapper at ", now("YYYY-MM-DD HH:mm"))
`,
    },
    {
      id: 'mapper_json_orders_v1',
      name: 'Generic JSON Orders',
      builtin: true,
      text: `# Sample JSON intake. Accepts either a single object or an array of objects.
# Source paths use dotted notation, e.g. "patient.mrn" reads obj.patient.mrn.
name      = Generic JSON Orders
direction = inbound
format    = json
description = Map nested JSON (patient + order objects) into LIS entities.

patient.mrn        = patient.mrn
patient.lastName   = patient.lastName
patient.firstName  = patient.firstName
patient.dob        = patient.dob
patient.sex        = upper(default(patient.sex, "U"))

order.orderNumber  = order.orderNumber
order.placerOrderNumber = order.placerOrderNumber
order.priority     = lower(default(order.priority, "routine"))
order.testIds      = order.testIds
order.providerId   = default(order.providerId, "Unknown")
order.facility     = order.facility
order.orderedAt    = order.orderedAt
order.collectedAt  = order.collectedAt
order.receivedAt   = order.receivedAt
`,
    },
  ];

  // Tiny FNV-1a hash so built-in samples self-refresh when their canonical text changes.
  const __hash = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
  };

  const seedSampleMappers = async () => {
    if (!window.db) return;
    for (const s of SAMPLES) {
      const existing = await window.db.get('mappers', s.id);
      const sampleHash = __hash(s.text);
      if (existing && existing.builtinHash === sampleHash) continue;
      // Preserve user-toggled `active` if they had deactivated a built-in.
      await window.db.put('mappers', {
        id: s.id, name: s.name, builtin: !!s.builtin,
        text: s.text,
        builtinHash: sampleHash,
        active: existing ? existing.active !== false : true,
        createdAt: existing ? existing.createdAt : Date.now(),
        updatedAt: Date.now(),
      });
    }
  };

  // Boot
  let __started = false;
  const start = () => {
    if (__started) return;
    if (!window.db || !window.schema || !window.events) {
      setTimeout(start, 0);
      return;
    }
    __started = true;
    seedSampleMappers().catch(e => console.warn('[mappers] seed failed', e));
  };

  window.mappers = {
    parse, apply,
    parseCsv, splitCsvLine,
    applyInboundCsv, applyInboundJson,
    ingestInboundResult,
    SAMPLES,
  };

  start();
})();
