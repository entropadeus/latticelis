// patient-setup-pages.jsx — direct config form for patient-data policies.
//
// Patient setup is a singleton stored on `lab_config.patientSetup`. The
// fields here control:
//
//   • MRN minting: prefix + zero-padded sequence (or random / external).
//     `nextMrn()` is exposed on window for accessioning / HL7 intake to
//     call when a patient is created without an MRN.
//
//   • Required demographics at registration: a checkbox list of patient
//     fields the registration form must collect before save.
//
//   • Duplicate-detection rules: which patient fields a fuzzy match runs
//     against. Mode 'warn' surfaces candidates in `dupeCandidateIds` so
//     the registration form can show a "possible duplicate" pill;
//     'block' refuses to save until the operator merges or explicitly
//     overrides.

const REQUIRED_FIELD_OPTIONS = [
  { id: 'mrn',         label: 'MRN'         },
  { id: 'lastName',    label: 'Last name'   },
  { id: 'firstName',   label: 'First name'  },
  { id: 'dob',         label: 'Date of birth' },
  { id: 'sex',         label: 'Sex'         },
  { id: 'phone',       label: 'Phone'       },
  { id: 'email',       label: 'Email'       },
  { id: 'address',     label: 'Address'     },
];
const MATCH_ON_OPTIONS = [
  { id: 'lastName',  label: 'Last name'    },
  { id: 'firstName', label: 'First name'   },
  { id: 'dob',       label: 'Date of birth'},
  { id: 'phone',     label: 'Phone'        },
  { id: 'email',     label: 'Email'        },
  { id: 'mrn',       label: 'MRN'          },
];
const MRN_MODES = [
  { id: 'sequence', label: 'Sequence',  desc: 'Auto-increment from the last MRN — predictable, audit-friendly.' },
  { id: 'random',   label: 'Random',    desc: 'N-digit random — privacy-leaning, harder to guess adjacent records.' },
  { id: 'external', label: 'External',  desc: 'MRN comes from the EMR / HL7 intake. Lattice never mints one.' },
];

// Pure helper exposed on window for accessioning + HL7 intake to call.
// Returns the next MRN based on lab_config and existing patients.
const nextMrn = async () => {
  const cfg = (await window.db.list('lab_config'))[0];
  const ps = (cfg && cfg.patientSetup) || { mrnPrefix: 'MRN-', mrnDigits: 6, mrnMode: 'sequence' };
  if (ps.mrnMode === 'external') return '';
  const digits = Math.max(3, Math.min(12, Number(ps.mrnDigits) || 6));
  const prefix = ps.mrnPrefix || '';
  if (ps.mrnMode === 'random') {
    let attempts = 0;
    while (attempts++ < 50) {
      const n = Math.floor(Math.random() * Math.pow(10, digits));
      const mrn = prefix + String(n).padStart(digits, '0');
      const dupe = (await window.db.list('patients', p => p.mrn === mrn))[0];
      if (!dupe) return mrn;
    }
    return prefix + String(Date.now()).slice(-digits);
  }
  // Sequence: scan existing MRNs with this prefix, find the max numeric tail.
  const all = await window.db.list('patients', p => typeof p.mrn === 'string' && p.mrn.startsWith(prefix));
  let max = 0;
  for (const p of all) {
    const tail = p.mrn.slice(prefix.length).replace(/[^0-9]/g, '');
    const n = parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(digits, '0');
};
window.nextMrn = nextMrn;

// Find candidate duplicates for a patient draft. Returns patient ids whose
// fields match on every field in cfg.duplicateRules.matchOn (case-insensitive
// for strings). Exact-match candidates only — a fuzzier matcher (Soundex,
// Levenshtein) is a future addition; the existing tox use-case is satisfied
// by exact match on lastName + dob.
const findDuplicateCandidates = async (draft) => {
  const cfg = (await window.db.list('lab_config'))[0];
  const rules = (cfg && cfg.patientSetup && cfg.patientSetup.duplicateRules) || { matchOn: ['lastName', 'dob'] };
  const fields = Array.isArray(rules.matchOn) ? rules.matchOn : [];
  if (fields.length === 0) return [];
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const all = await window.db.list('patients', p => p.id !== draft.id);
  return all
    .filter(p => fields.every(f => norm(p[f]) && norm(p[f]) === norm(draft[f])))
    .map(p => p.id);
};
window.findDuplicateCandidates = findDuplicateCandidates;

const PatientSetupPage = ({ onBack }) => {
  const labConfigArr = window.useEntities('lab_config');
  const labConfig = labConfigArr[0] || null;
  const canEdit = hasPermission('EDIT_LAB_CONFIG');
  const [draft, setDraft] = useStateOS(null);
  const [savedFlash, setSavedFlash] = useStateOS(false);
  const [preview, setPreview] = useStateOS('');

  useEffectOS(() => {
    if (labConfig && !draft) {
      const ps = labConfig.patientSetup || {};
      setDraft({
        mrnPrefix: ps.mrnPrefix || 'MRN-',
        mrnDigits: ps.mrnDigits || 6,
        mrnMode: ps.mrnMode || 'sequence',
        requiredFields: ps.requiredFields || ['mrn', 'lastName', 'firstName', 'dob', 'sex'],
        duplicateRules: ps.duplicateRules || { matchOn: ['lastName', 'dob'], blockOnExact: false },
      });
    }
  }, [labConfig]);

  useEffectOS(() => {
    if (!draft) return;
    (async () => {
      if (draft.mrnMode === 'external') { setPreview('(external — MRN comes from the EMR)'); return; }
      // Show what the next minted MRN would look like without committing.
      const cur = (await window.db.list('lab_config'))[0];
      const proxy = window.schema.newLabConfig({ ...(cur || {}), patientSetup: draft });
      const existing = (await window.db.list('lab_config'))[0];
      // We can't actually call nextMrn() without first persisting; instead
      // recompute inline with the draft values.
      const digits = Math.max(3, Math.min(12, Number(draft.mrnDigits) || 6));
      const prefix = draft.mrnPrefix || '';
      if (draft.mrnMode === 'random') {
        setPreview(prefix + 'XXXXXX'.slice(0, digits));
        return;
      }
      const all = await window.db.list('patients', p => typeof p.mrn === 'string' && p.mrn.startsWith(prefix));
      let max = 0;
      for (const p of all) {
        const tail = p.mrn.slice(prefix.length).replace(/[^0-9]/g, '');
        const n = parseInt(tail, 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      setPreview(prefix + String(max + 1).padStart(digits, '0'));
    })();
  }, [draft && draft.mrnPrefix, draft && draft.mrnDigits, draft && draft.mrnMode]);

  if (!draft) {
    return (
      <Page label="Patient Setup">
        <PageHeader title="Patient Setup" sub="Loading…"/>
      </Page>
    );
  }

  const save = async () => {
    if (!canEdit) return;
    const cur = (await window.db.list('lab_config'))[0] || window.schema.newLabConfig({});
    const next = window.schema.newLabConfig({ ...cur, patientSetup: draft });
    await window.db.put('lab_config', next);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const reset = async () => {
    if (!canEdit) return;
    const fresh = window.schema.newLabConfig({}).patientSetup;
    setDraft(fresh);
  };

  const toggleSet = (key, id) => {
    setDraft(d => {
      const arr = Array.isArray(d[key]) ? [...d[key]] : [];
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      return { ...d, [key]: arr };
    });
  };
  const toggleMatchOn = (id) => {
    setDraft(d => {
      const arr = Array.isArray(d.duplicateRules.matchOn) ? [...d.duplicateRules.matchOn] : [];
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      return { ...d, duplicateRules: { ...d.duplicateRules, matchOn: arr } };
    });
  };

  return (
    <Page label="Patient Setup">
      <PageHeader title="Patient Setup"
        sub="MRN format, required demographics at registration, and duplicate-detection rules. Applies to every new patient registration and HL7 intake."
        actions={[
          ...(onBack ? [<button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}><IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin</button>] : []),
          <button key="r" className="btn" data-size="sm" data-variant="ghost" onClick={reset} disabled={!canEdit}>Reset to defaults</button>,
          <button key="s" className="btn" data-size="sm" data-variant="primary" onClick={save} disabled={!canEdit}>
            {savedFlash ? 'Saved ✓' : 'Save changes'}
          </button>,
        ]}/>

      {/* ─── MRN format ────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 11, marginBottom: 10 }}>MRN format</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <div>
            <div className="field-label">Prefix</div>
            <input className="input" value={draft.mrnPrefix} onChange={e => setDraft(d => ({ ...d, mrnPrefix: e.target.value }))} style={{ width: '100%' }} disabled={!canEdit || draft.mrnMode === 'external'}/>
          </div>
          <div>
            <div className="field-label">Digits</div>
            <input type="number" min={3} max={12} className="input" value={draft.mrnDigits}
              onChange={e => setDraft(d => ({ ...d, mrnDigits: Math.max(3, Math.min(12, Number(e.target.value) || 6)) }))}
              style={{ width: '100%' }} disabled={!canEdit || draft.mrnMode === 'external'}/>
          </div>
          <div>
            <div className="field-label">Next MRN preview</div>
            <div className="mono" style={{ fontSize: 14, color: 'var(--ink-900)', padding: '6px 0' }}>{preview || '—'}</div>
          </div>
        </div>
        <div className="field-label">Minting mode</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {MRN_MODES.map(m => {
            const on = draft.mrnMode === m.id;
            return (
              <button key={m.id} type="button"
                onClick={() => canEdit && setDraft(d => ({ ...d, mrnMode: m.id }))}
                style={{
                  textAlign: 'left', padding: '10px 12px',
                  background: on ? 'var(--sage-50)' : '#fff',
                  border: `1px solid ${on ? 'var(--sage-500)' : 'var(--line)'}`,
                  borderRadius: 6, cursor: canEdit ? 'pointer' : 'not-allowed',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: on ? 'var(--sage-900)' : 'var(--ink-900)' }}>{m.label}</span>
                  {on && <span className="pill" data-tone="sage">selected</span>}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{m.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Required demographics ─────────────────────────────────── */}
      <div className="panel" style={{ padding: 16, marginBottom: 12 }}>
        <div className="section-title" style={{ fontSize: 11, marginBottom: 4 }}>Required demographics at registration</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 10 }}>
          The registration form blocks save until every checked field is non-empty. HL7 intake silently fills these from MSH/PID when present; missing required fields surface as parse warnings on the Hl7Intake panel.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {REQUIRED_FIELD_OPTIONS.map(f => {
            const on = (draft.requiredFields || []).includes(f.id);
            return (
              <button key={f.id} type="button"
                onClick={() => canEdit && toggleSet('requiredFields', f.id)}
                className="pill" data-tone={on ? 'sage' : 'ghost'}
                style={{ height: 24, padding: '0 10px', cursor: canEdit ? 'pointer' : 'not-allowed', border: '1px solid var(--line)' }}>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Duplicate detection ──────────────────────────────────── */}
      <div className="panel" style={{ padding: 16 }}>
        <div className="section-title" style={{ fontSize: 11, marginBottom: 4 }}>Duplicate detection</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-500)', marginBottom: 10 }}>
          When a new patient is registered, scan existing patients for an exact match on every selected field. Candidate ids land on `patient.dupeCandidateIds` so the registration form can show a "possible duplicate" pill. Hard-block refuses to save until the operator merges or overrides.
        </div>
        <div className="field-label">Match on (all fields must match)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {MATCH_ON_OPTIONS.map(f => {
            const on = (draft.duplicateRules.matchOn || []).includes(f.id);
            return (
              <button key={f.id} type="button"
                onClick={() => canEdit && toggleMatchOn(f.id)}
                className="pill" data-tone={on ? 'info' : 'ghost'}
                style={{ height: 24, padding: '0 10px', cursor: canEdit ? 'pointer' : 'not-allowed', border: '1px solid var(--line)' }}>
                {f.label}
              </button>
            );
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-700)' }}>
          <input type="checkbox" checked={draft.duplicateRules.blockOnExact === true}
            onChange={e => canEdit && setDraft(d => ({ ...d, duplicateRules: { ...d.duplicateRules, blockOnExact: e.target.checked } }))}/>
          Hard-block save when a candidate matches (operator must merge or override)
        </label>
      </div>
    </Page>
  );
};

Object.assign(window, { PatientSetupPage });
