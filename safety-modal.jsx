// safety-modal.jsx - shared operator confirmation surface

const {
  useState: useStateSAFE,
  useEffect: useEffectSAFE,
  useRef: useRefSAFE,
} = React;

const SAFETY_TONES = {
  danger: { label: 'high risk', color: 'var(--err-700)', bg: 'var(--rust-soft)', btn: 'danger' },
  warning: { label: 'review', color: 'var(--warn-700)', bg: 'var(--amber-soft)', btn: 'primary' },
  info: { label: 'notice', color: 'var(--info)', bg: 'var(--info-soft)', btn: 'primary' },
  neutral: { label: 'confirm', color: 'var(--ink-500)', bg: 'var(--ivory-100)', btn: 'primary' },
};

const normalizeFacts = (facts) => {
  if (!Array.isArray(facts)) return [];
  return facts.map((f, idx) => {
    if (f && typeof f === 'object') {
      return {
        label: f.label || f.key || ('fact ' + (idx + 1)),
        value: f.value == null || f.value === '' ? '-' : String(f.value),
      };
    }
    return { label: 'fact ' + (idx + 1), value: f == null || f === '' ? '-' : String(f) };
  });
};

const SafetyConfirmHost = () => {
  const [active, setActive] = useStateSAFE(null);
  const [reason, setReason] = useStateSAFE('');
  const [typedText, setTypedText] = useStateSAFE('');
  const activeRef = useRefSAFE(null);
  const queueRef = useRefSAFE([]);
  const dialogRef = useRefSAFE(null);
  const reasonRef = useRefSAFE(null);
  const typedRef = useRefSAFE(null);
  const confirmRef = useRefSAFE(null);

  useEffectSAFE(() => { activeRef.current = active; }, [active]);

  const openNext = () => {
    const next = queueRef.current.shift();
    if (!next) return;
    setReason(next.options.reasonDefault || '');
    setTypedText('');
    setActive(next);
  };

  useEffectSAFE(() => {
    window.safetyConfirm = (rawOptions = {}) => new Promise((resolve) => {
      const options = {
        id: rawOptions.id || 'operator.safety.confirm',
        tone: rawOptions.tone || 'neutral',
        title: rawOptions.title || 'Confirm action',
        message: rawOptions.message || '',
        facts: normalizeFacts(rawOptions.facts),
        requireReason: !!rawOptions.requireReason,
        reasonLabel: rawOptions.reasonLabel || 'Reason',
        reasonPlaceholder: rawOptions.reasonPlaceholder || '',
        reasonDefault: rawOptions.reasonDefault || '',
        requireTypedText: rawOptions.requireTypedText || '',
        confirmLabel: rawOptions.confirmLabel || 'Confirm',
        cancelLabel: rawOptions.cancelLabel === undefined ? 'Cancel' : rawOptions.cancelLabel,
        entityType: rawOptions.entityType || null,
        entityId: rawOptions.entityId || null,
        audit: rawOptions.audit !== false,
        notice: !!rawOptions.notice,
      };
      const request = { options, resolve };
      if (activeRef.current) {
        queueRef.current.push(request);
      } else {
        setReason(options.reasonDefault || '');
        setTypedText('');
        setActive(request);
      }
    });
    return () => {
      window.safetyConfirm = () => Promise.resolve({ confirmed: false, reason: '', typedText: '' });
    };
  }, []);

  useEffectSAFE(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      const node = active.options.requireReason
        ? reasonRef.current
        : active.options.requireTypedText
          ? typedRef.current
          : confirmRef.current;
      if (node && node.focus) node.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [active]);

  if (!active) return null;

  const { options, resolve } = active;
  const tone = SAFETY_TONES[options.tone] || SAFETY_TONES.neutral;
  const requiredText = typeof options.requireTypedText === 'string'
    ? options.requireTypedText
    : '';
  const reasonOk = !options.requireReason || reason.trim().length > 0;
  const typedOk = !requiredText || typedText.trim() === requiredText;
  const canConfirm = reasonOk && typedOk;

  const finish = (confirmed) => {
    const payload = { confirmed, reason: reason.trim(), typedText: typedText.trim() };
    if (confirmed && options.audit && !options.notice && window.events) {
      const actor = window.currentUser ? window.currentUser.id : 'unknown';
      window.events.publish('operator.safety.confirmed', {
        actor,
        actionId: options.id,
        entityType: options.entityType,
        entityId: options.entityId,
        reason: payload.reason || '',
        typedText: payload.typedText || '',
        facts: options.facts,
        tone: options.tone,
        title: options.title,
      });
    }
    resolve(payload);
    setActive(null);
    window.setTimeout(openNext, 0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
      return;
    }
    if (e.key === 'Enter' && canConfirm) {
      e.preventDefault();
      finish(true);
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="backdrop-in" onMouseDown={() => finish(false)} style={{
      position: 'fixed', inset: 0, zIndex: 1800,
      display: 'grid', placeItems: 'center',
      background: 'rgba(31,30,26,0.42)',
      padding: 24,
    }}>
      <div role="dialog" aria-modal="true" aria-labelledby="safety-title"
        ref={dialogRef}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="scale-in"
        style={{
          width: 480, maxWidth: 'min(480px, calc(100vw - 32px))',
          background: '#fff',
          border: '1px solid var(--line-strong)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}>
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{
            width: 6, alignSelf: 'stretch', borderRadius: 999,
            background: tone.color,
          }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pill" data-tone={options.tone === 'danger' ? 'rust' : options.tone === 'warning' ? 'amber' : 'ghost'}
                style={{ fontSize: 9.5 }}>{tone.label}</span>
              <div id="safety-title" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-900)' }}>
                {options.title}
              </div>
            </div>
            {options.message && (
              <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.45, color: 'var(--ink-500)' }}>
                {options.message}
              </div>
            )}
          </div>
        </div>

        {options.facts.length > 0 && (
          <div style={{ padding: '10px 14px', background: 'var(--ivory-50)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 10px' }}>
              {options.facts.map((f, idx) => (
                <React.Fragment key={idx}>
                  <div className="section-title" style={{ fontSize: 9.5 }}>{f.label}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-800)', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                    {f.value}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {options.requireReason && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="field-label">{options.reasonLabel}</span>
              <input ref={reasonRef} className="input" value={reason}
                placeholder={options.reasonPlaceholder}
                onChange={e => setReason(e.target.value)}
                style={{ height: 32 }}/>
            </label>
          )}
          {requiredText && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="field-label">Type <span className="mono">{requiredText}</span> to continue</span>
              <input ref={typedRef} className="input mono" value={typedText}
                onChange={e => setTypedText(e.target.value)}
                style={{ height: 32 }}/>
            </label>
          )}
        </div>

        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 8,
          background: tone.bg,
        }}>
          <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>
            esc cancels. tab stays here. enter confirms when complete.
          </span>
          <div style={{ flex: 1 }}/>
          {options.cancelLabel !== null && (
            <button className="btn" data-size="sm" onClick={() => finish(false)}>
              {options.cancelLabel}
            </button>
          )}
          <button ref={confirmRef} className="btn" data-size="sm"
            data-variant={tone.btn}
            disabled={!canConfirm}
            onClick={() => finish(true)}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

window.safetyConfirm = () => Promise.resolve({ confirmed: false, reason: '', typedText: '' });
window.SafetyConfirmHost = SafetyConfirmHost;
