// auth.js — Login / logout / password hashing for the Lattice LIS prototype.
//
// PROTOTYPE-GRADE HASHING: SHA-256(salt || password). Salt is 16 random bytes
// per user, generated at password-set time. This is *not* production-grade —
// real passwords need PBKDF2 / scrypt / argon2id with tunable work factors so
// brute-forcing a leaked database costs real time. For a single-tab browser
// prototype with a localStorage-only "session", this is acceptable: the only
// attacker who could read the hash is one already inside the browser
// security context, which means they already have everything anyway.
//
// When this codebase moves to Electron + better-sqlite3 (or a real backend),
// the verify() and setPassword() functions are the only call sites — swap
// the digest implementation here, leave the rest of the LIS untouched.
//
// API:
//   await auth.setPassword(userId, plaintext)        — hash + persist on user record
//   await auth.verify(username, plaintext)           — { ok, user, reason }
//   auth.signOut()                                   — clear localStorage flag
//   auth.authedUserId()                              — string | null (sync)
//   auth.subscribeAuth(fn)                           — fn(userId|null) on changes
//   auth.hasPassword(user)                           — boolean (record-level check)
//
// Session state lives at localStorage['lattice.authedUserId']. current-user.js
// honors this when refreshing window.currentUser, so the existing actor /
// audit / role-resolution surfaces all just work once auth flips.

(function () {

  const KEY = 'lattice.authedUserId';
  const __subs = new Set();

  // ── Crypto helpers ─────────────────────────────────────────────────────

  // Buffer ↔ base64 helpers. We use ArrayBuffer for SubtleCrypto compatibility,
  // base64 for storage in IndexedDB / JSON snapshots (no binary in JSON).
  const __bufToB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  };
  const __b64ToBuf = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };

  const generateSalt = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return __bufToB64(bytes.buffer);
  };

  // SHA-256(salt-bytes || password-utf8). Returns base64.
  // Falsy / non-string password fails the digest deliberately — callers should
  // never persist a hash for an empty password. Trim is the caller's job; the
  // hash takes the password byte-exact so " admin" and "admin" are different,
  // which matches user intent for prototype credential testing.
  const hashPassword = async (password, saltB64) => {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('[auth] password must be a non-empty string');
    }
    if (!saltB64) throw new Error('[auth] missing salt');
    const saltBuf = __b64ToBuf(saltB64);
    const passBuf = new TextEncoder().encode(password);
    // Concatenate salt || password into one buffer for the digest input.
    const combined = new Uint8Array(saltBuf.byteLength + passBuf.byteLength);
    combined.set(new Uint8Array(saltBuf), 0);
    combined.set(passBuf, saltBuf.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', combined);
    return __bufToB64(digest);
  };

  // Constant-time-ish base64 string compare. Pure-JS, browser SubtleCrypto
  // doesn't ship a crypto-grade timingSafeEqual. For prototype hashes this
  // is fine — a real backend should use timingSafeEqual or similar.
  const __ctEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= (a.charCodeAt(i) ^ b.charCodeAt(i));
    return mismatch === 0;
  };

  // ── User-record password operations ───────────────────────────────────

  const hasPassword = (user) => !!(user && user.passwordHash && user.passwordSalt);

  const setPassword = async (userId, plaintext) => {
    if (!userId) throw new Error('[auth] no user id');
    const fresh = await window.db.get('users', userId);
    if (!fresh) throw new Error('[auth] user not found: ' + userId);
    const salt = generateSalt();
    const hash = await hashPassword(plaintext, salt);
    const next = window.schema.newUser({
      ...fresh,
      passwordHash: hash,
      passwordSalt: salt,
      passwordSetAt: Date.now(),
      passwordSource: 'operator',
    });
    await window.db.put('users', next);
    return next;
  };

  const clearPassword = async (userId) => {
    const fresh = await window.db.get('users', userId);
    if (!fresh) return null;
    const next = window.schema.newUser({
      ...fresh,
      passwordHash: null,
      passwordSalt: null,
      passwordSetAt: null,
      passwordSource: null,
    });
    await window.db.put('users', next);
    return next;
  };

  // ── Verify & session state ────────────────────────────────────────────

  const __findByUsername = async (username) => {
    if (!username) return null;
    const needle = String(username).trim().toLowerCase();
    if (!needle) return null;
    const all = await window.db.list('users').catch(() => []);
    return all.find(u => (u.username || '').toLowerCase() === needle) || null;
  };

  // Returns:
  //   { ok: true,  user }                         — authenticated, session set
  //   { ok: false, reason: 'unknown_user' }       — username not found OR inactive
  //   { ok: false, reason: 'no_password' }        — user exists but no password set
  //   { ok: false, reason: 'bad_password' }       — hash mismatch
  // Inactive users get the same reason as unknown to avoid leaking which
  // accounts exist (a thin defense, but cheap).
  const verify = async (username, password) => {
    const user = await __findByUsername(username);
    if (!user || user.status === 'INACTIVE') return { ok: false, reason: 'unknown_user' };
    if (!hasPassword(user)) return { ok: false, reason: 'no_password' };
    let attemptedHash;
    try {
      attemptedHash = await hashPassword(password, user.passwordSalt);
    } catch (e) {
      return { ok: false, reason: 'bad_password' };
    }
    if (!__ctEqual(attemptedHash, user.passwordHash)) {
      return { ok: false, reason: 'bad_password' };
    }
    // Mark session.
    localStorage.setItem(KEY, user.id);
    if (window.currentUserApi) await window.currentUserApi.setCurrent(user.id);
    __subs.forEach(fn => { try { fn(user.id); } catch (e) { console.error(e); } });
    return { ok: true, user };
  };

  const signOut = () => {
    localStorage.removeItem(KEY);
    // Also clear the legacy switcher key (current-user.js's 'lattice.currentUserId').
    // Otherwise refresh() would fall back to it and silently re-authenticate
    // the user we just signed out.
    try { localStorage.removeItem('lattice.currentUserId'); } catch (e) {}
    if (window.currentUserApi) {
      // Clear the visible operator. current-user.js will treat null as logged-out.
      window.currentUser = null;
      window.__userCache = window.__userCache || {};
    }
    __subs.forEach(fn => { try { fn(null); } catch (e) { console.error(e); } });
  };

  const authedUserId = () => {
    try { return localStorage.getItem(KEY); }
    catch (e) { return null; }
  };

  const subscribeAuth = (fn) => { __subs.add(fn); return () => __subs.delete(fn); };

  const needsBootstrap = async () => {
    const all = await window.db.list('users').catch(() => []);
    return all.length > 0 && !all.some(hasPassword);
  };

  const bootstrapFirstAdminPassword = async (username, plaintext) => {
    if (!(await needsBootstrap())) return { ok: false, reason: 'setup_disabled' };
    const user = await __findByUsername(username);
    if (!user || user.status === 'INACTIVE') return { ok: false, reason: 'unknown_user' };
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('IT_ADMIN') && !roles.includes('LAB_DIRECTOR')) {
      return { ok: false, reason: 'not_admin' };
    }
    const next = await setPassword(user.id, plaintext);
    localStorage.setItem(KEY, next.id);
    if (window.currentUserApi) await window.currentUserApi.setCurrent(next.id);
    __subs.forEach(fn => { try { fn(next.id); } catch (e) { console.error(e); } });
    return { ok: true, user: next };
  };

  // ── Public API ────────────────────────────────────────────────────────

  window.auth = {
    generateSalt,
    hashPassword,
    setPassword,
    clearPassword,
    verify,
    signOut,
    authedUserId,
    subscribeAuth,
    hasPassword,
    needsBootstrap,
    bootstrapFirstAdminPassword,
  };
})();
