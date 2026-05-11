// current-user.js — Active operator context for the LIS.
//
// Real labs require accountability on every action. Until we have actual auth,
// this gives us a "Who's on shift" surrogate: a User record that's pinned to
// localStorage so reloads don't lose it, exposed as window.currentUser, and
// surfaced as a switcher in the topbar.
//
// Every place that previously hardcoded 'you' / 'system' / 'auto' as the actor
// now reads window.currentUser?.id (with a fallback). When real auth lands, the
// switcher is replaced; the actor field is already in place.

(function () {

  const KEY = 'lattice.currentUserId';
  const __subs = new Set();

  let __cur = null;       // last-seen user object (or null if none chosen)
  let __started = false;

  // ── First-launch default user ───────────────────────────────────────────
  // Local prototype default: exactly one account, username `test`,
  // password `test`. The plaintext exists here only so a brand-new local
  // browser profile / Electron data dir can bootstrap itself.
  // Holds every role in the catalog so it clears every PERMISSIONS gate
  // and shows up in every role-filtered surface (TAT recipients, critical
  // escalation, notification targets) — a true full-admin test account.
  const DEV_USER = {
    id: 'usr_local_test',
    username: 'test',
    firstName: 'Test',
    lastName: 'User',
    credentials: [],
    roles: ['LAB_DIRECTOR', 'LAB_SUPERVISOR', 'PATHOLOGIST', 'MEDICAL_TECHNOLOGIST', 'LAB_ASSISTANT', 'IT_ADMIN'],
    status: 'ACTIVE',
  };
  const DEV_PASSWORD = 'test';
  const LEGACY_SEED_USER_IDS = new Set([
    'usr_seed_director',
    'usr_seed_supervisor',
    'usr_seed_med_tech',
    'usr_seed_lab_assistant',
    'usr_seed_it_admin',
    'usr_owner_blona',
  ]);

  const seedUsers = async () => {
    const existing = await window.db.list('users').catch(() => []);
    const newUser = (window.schema && window.schema.newUser) || ((init) => init);
    const now = Date.now();

    for (const u of existing.filter(u => u && LEGACY_SEED_USER_IDS.has(u.id))) {
      await window.db.delete('users', u.id);
    }

    const afterLegacyCleanup = existing.filter(u => u && !LEGACY_SEED_USER_IDS.has(u.id));
    const current = afterLegacyCleanup.find(u => u && u.id === DEV_USER.id);

    // Always ensure the test/test admin record exists with the right roles,
    // ACTIVE status, and a known-good password. Previously this bailed when
    // any non-default users were present, which left the dev account
    // missing in any DB that had other accounts — producing "unknown account
    // or account inactive" on login. The dev account is now a guaranteed
    // back door for local prototype work; real installations should remove
    // this seeder before going to production.
    const salt = window.auth && window.auth.generateSalt ? window.auth.generateSalt() : null;
    const hash = salt && window.auth && window.auth.hashPassword
      ? await window.auth.hashPassword(DEV_PASSWORD, salt)
      : null;
    const record = newUser({
      ...(current || {}),
      ...DEV_USER,
      createdAt: current && current.createdAt ? current.createdAt : now,
      passwordHash: hash,
      passwordSalt: salt,
      passwordSetAt: now,
      passwordSource: 'local-dev-seed',
    });
    await window.db.put('users', record);
    try {
      const authed = localStorage.getItem('lattice.authedUserId');
      if (authed && authed !== record.id) {
        const allUsers = await window.db.list('users').catch(() => []);
        if (!allUsers.some(u => u && u.id === authed)) {
          localStorage.removeItem('lattice.authedUserId');
        }
      }
      const legacy = localStorage.getItem(KEY);
      if (legacy && legacy !== record.id) {
        const allUsers = await window.db.list('users').catch(() => []);
        if (!allUsers.some(u => u && u.id === legacy)) {
          localStorage.removeItem(KEY);
        }
      }
    } catch (e) {}
    console.log('[current-user] local default user ready: test');
    return [
      ...afterLegacyCleanup.filter(u => u && u.id !== record.id),
      record,
    ];
  };

  // Auth-aware refresh:
  //   1. Always rebuild __userCache so historical actor lookups resolve.
  //   2. If localStorage['lattice.authedUserId'] is set, treat that id as
  //      the active operator (real auth flow via auth.verify).
  //   3. Otherwise fall back to the legacy `lattice.currentUserId` flag
  //      (set by the dev-only switcher path, kept for now for backwards-compat
  //      with snapshots / users that never logged in via the login page).
  //   4. If neither is set, currentUser is null — app.jsx gates on this and
  //      renders the LoginPage instead of the main shell.
  const refresh = async () => {
    const users = await window.db.list('users').catch(() => []);
    window.__userCache = Object.fromEntries(users.map(u => [u.id, u]));
    if (users.length === 0) {
      __cur = null;
      window.currentUser = null;
      __subs.forEach(fn => { try { fn(null); } catch (e) { console.error(e); } });
      return;
    }
    const authedId = (() => { try { return localStorage.getItem('lattice.authedUserId'); } catch (e) { return null; } })();
    const legacyId = localStorage.getItem(KEY);
    let cur = null;
    if (authedId) cur = users.find(u => u.id === authedId) || null;
    if (!cur && legacyId) cur = users.find(u => u.id === legacyId) || null;
    // No auto-fallback to users[0] anymore — that defeats the login gate.
    __cur = cur;
    window.currentUser = cur;
    __subs.forEach(fn => { try { fn(cur); } catch (e) { console.error(e); } });
  };

  const setCurrent = async (id) => {
    localStorage.setItem(KEY, id);
    await refresh();
  };

  const subscribe = (fn) => { __subs.add(fn); return () => __subs.delete(fn); };

  const start = async () => {
    if (__started) return;
    if (!window.db) { setTimeout(start, 0); return; }
    __started = true;
    // The users collection isn't watched anywhere yet; piggyback on db.subscribe
    // so adds/removals propagate to the topbar.
    window.db.subscribe('users', () => refresh());
    await seedUsers();
    await refresh();
  };

  const ensureDefaultUser = async () => {
    const users = await seedUsers();
    await refresh();
    return users;
  };

  // displayName(actor) — accepts a user id or a string actor like 'system'/'auto'/'rules'
  const displayName = (actor) => {
    if (!actor) return 'system';
    if (actor === 'system' || actor === 'auto' || actor === 'rules') return actor;
    if (window.__userCache && window.__userCache[actor]) {
      const u = window.__userCache[actor];
      return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || actor;
    }
    return actor;
  };

  window.currentUser = null;
  window.currentUserApi = { setCurrent, subscribe, displayName, refresh, ensureDefaultUser };

  start();
})();
