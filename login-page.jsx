// login-page.jsx — Full-screen login gate.
//
// Replaces the implicit "first user wins" flow that current-user.js used to
// run on boot. When `auth.authedUserId()` is null, app.jsx mounts <LoginPage/>
// instead of the regular shell.
//
// Layout: left brand panel (sage gradient, "Lattice LIS" lockup, build
// version, footer note) + right form panel (centered card with username,
// password, sign-in button). On viewports under ~760px the brand panel
// collapses above the form. Shake animation fires on auth fail.

const { useState: useStateLP, useEffect: useEffectLP, useRef: useRefLP } = React;

const LOGIN_FAIL_REASON = {
  unknown_user:  'Unknown username (or this account is inactive). Try again.',
  no_password:   'This account has no password set. An admin needs to assign one before login.',
  bad_password:  'Wrong password. Try again.',
  // Generic fallback — should only fire if auth.verify itself throws.
  internal:      'Something went wrong. Try again, or refresh the page.',
};

const LoginPage = ({ onSuccess }) => {
  const [username, setUsername] = useStateLP('');
  const [password, setPassword] = useStateLP('');
  const [showPw, setShowPw]     = useStateLP(false);
  const [busy, setBusy]         = useStateLP(false);
  const [error, setError]       = useStateLP(null);
  const [shakeKey, setShakeKey] = useStateLP(0);  // bump to retrigger CSS animation
  const usernameRef = useRefLP(null);

  useEffectLP(() => {
    // Autofocus username on mount and any time the form is reset.
    if (usernameRef.current) usernameRef.current.focus();
  }, []);

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password.length) {
      setError('Username and password are required.');
      setShakeKey(k => k + 1);
      return;
    }
    setBusy(true);
    setError(null);
    let result;
    try {
      result = await window.auth.verify(username.trim(), password);
    } catch (err) {
      console.error('[login] verify threw', err);
      result = { ok: false, reason: 'internal' };
    }
    if (result.ok) {
      // Don't clear the password — the form unmounts on success and React
      // tears it down. Pre-clearing flashes an empty field for one paint.
      setBusy(false);
      if (typeof onSuccess === 'function') onSuccess(result.user);
      return;
    }
    setError(LOGIN_FAIL_REASON[result.reason] || LOGIN_FAIL_REASON.internal);
    setShakeKey(k => k + 1);
    setPassword('');
    setBusy(false);
    // Don't refocus the username — focus belongs on password since username
    // is presumably correct (most fails are bad password, not bad username).
    setTimeout(() => {
      const pw = document.getElementById('login-password');
      if (pw) pw.focus();
    }, 0);
  };

  const buildVer = window.__LIS_VERSION || '0.x';

  return (
    <div className="login-shell">
      {/* ── Brand panel ─────────────────────────────────────────────── */}
      <div className="login-brand">
        <div>
          {/* Lockup — geometric mark + wordmark. SVG inline so first-paint doesn't wait on a fetch. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.25">
              <circle cx="16" cy="16" r="13"/>
              <circle cx="16" cy="16" r="7"/>
              <line x1="16" y1="3" x2="16" y2="29"/>
              <line x1="3" y1="16" x2="29" y2="16"/>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
              <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.012em' }}>Lattice LIS</span>
              <span style={{ fontSize: 10.5, color: 'rgba(246,244,238,0.55)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>
                Laboratory Information System
              </span>
            </div>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.18, letterSpacing: '-0.012em', maxWidth: 360, marginTop: 56, marginBottom: 0 }}>
            Conservative best-in-class enterprise software for clinical labs.
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(246,244,238,0.7)', maxWidth: 380, marginTop: 14, lineHeight: 1.6 }}>
            Rules engine at the core. Keyboard-driven accessioning. Geist Sans + Geist Mono, warm ivory + sage. Real schema, real wiring, no dummy data.
          </p>
        </div>
        <div style={{ fontSize: 10.5, color: 'rgba(246,244,238,0.45)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Build {buildVer} · Prototype · Single-tab
        </div>
      </div>

      {/* ── Form panel ──────────────────────────────────────────────── */}
      <div className="login-form-pane">
        <div className="login-form-card">
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.012em', color: 'var(--ink-900)', margin: 0 }}>
              Welcome back
            </h2>
            <p style={{ fontSize: 13, color: 'var(--ink-400)', marginTop: 6, marginBottom: 0 }}>
              Sign in to continue.
            </p>
          </div>

          {/* `key={shakeKey}` re-applies the .shake class, which retriggers the
              animation. CSS animations don't re-fire on add-then-add — the
              browser only sees a class state change, not a "play me again"
              signal. Bumping the key forces React to reconcile the element. */}
          <form key={shakeKey} className={error ? 'shake' : ''} onSubmit={submit} noValidate>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="login-username" style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink-700)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Username
              </label>
              <input
                id="login-username"
                ref={usernameRef}
                className="login-input"
                type="text"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                placeholder="alex"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={busy}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label htmlFor="login-password" style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--ink-700)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  className="login-input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  style={{ paddingRight: 56 }}
                />
                <button
                  type="button"
                  className="login-show-pw"
                  onClick={() => setShowPw(s => !s)}
                  disabled={busy}
                  title={showPw ? 'Hide password' : 'Show password'}
                  tabIndex={-1}>
                  {showPw ? 'hide' : 'show'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={busy || !username.trim() || !password.length}>
              {busy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <span className="login-spinner"/> Signing in…
                </span>
              ) : 'Sign in'}
            </button>

            {error && (
              <div className="login-error" role="alert">{error}</div>
            )}
          </form>

        </div>
      </div>
    </div>
  );
};

window.LoginPage = LoginPage;
