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

  // ── Auto-seed: at least one user must exist or the picker is empty. ───────
  // We seed two operators on first run so the switcher has options and shows
  // something other than "no user". Both have role hints that align with
  // Appendix A's Role enum (LAB_ASSISTANT, MEDICAL_TECHNOLOGIST).

  // Seed a starter roster on first install. Goes through schema.newUser so
  // role coercion + status normalization apply consistently with admin-page
  // creates. Fixed ids (`usr_seed_…`) so existing localStorage `currentUserId`
  // selections survive and so audit history pre-dating a fresh install
  // continues to resolve. Roles are spread across the catalog to give the
  // TAT recipient picker / Users admin page realistic rosters out of the box
  // without anyone having to hand-create users to see the routing work.
  // Default seed credentials: each user's password equals their username.
  // Documented on the LoginPage's "dev seed" disclosure so the user knows
  // what to type. Backfill: if seed users exist but lack a passwordHash
  // (e.g. records from before auth landed), we hash a default for them so
  // the prototype is usable on second-run installs without manual reset.
  const SEED_USERS = [
    // Owner account. Password is non-default (set explicitly, not = username);
    // deliberately excluded from the LoginPage "dev seed credentials"
    // disclosure so it isn't shown alongside the prototype demo accounts.
    // Roles span the full admin spectrum so this account hits no Forbidden
    // panels anywhere — Director (clinical) + IT Admin (technical).
    { id: 'usr_owner_blona',   username: 'blona',  firstName: 'Ben',    lastName: 'Lona',
      credentials: [],             roles: ['LAB_DIRECTOR', 'IT_ADMIN'],   password: 'Privia1!' },
    { id: 'usr_seed_director', username: 'rivera', firstName: 'Sam',     lastName: 'Rivera',
      credentials: ['MD', 'FCAP'], roles: ['LAB_DIRECTOR', 'PATHOLOGIST'] },
    { id: 'usr_seed_super',    username: 'morgan',  firstName: 'Morgan', lastName: 'Lee',
      credentials: ['MT(ASCP)'],   roles: ['LAB_SUPERVISOR'] },
    { id: 'usr_seed_tech',     username: 'alex',    firstName: 'Alex',   lastName: 'Tran',
      credentials: ['MLT'],        roles: ['MEDICAL_TECHNOLOGIST'] },
    { id: 'usr_seed_assist',   username: 'priya',   firstName: 'Priya',  lastName: 'Patel',
      credentials: [],             roles: ['LAB_ASSISTANT'] },
    { id: 'usr_seed_it',       username: 'jordan',  firstName: 'Jordan', lastName: 'Kim',
      credentials: [],             roles: ['IT_ADMIN'] },
  ];

  // Resolve the default password for a seed entry. Owner / personal accounts
  // declare `password` explicitly; everyone else falls back to `username`
  // (the prototype demo convention surfaced on the login page).
  const __seedPassword = (seed) => seed.password || seed.username;

  const __hashSeed = async (password) => {
    if (!window.auth || !window.auth.hashPassword || !window.auth.generateSalt) return null;
    const salt = window.auth.generateSalt();
    const hash = await window.auth.hashPassword(password, salt);
    return { salt, hash };
  };

  const seedUsers = async () => {
    const existing = await window.db.list('users').catch(() => []);
    const newUser = (window.schema && window.schema.newUser) || ((init) => init);
    const now = Date.now();
    const existingById = new Map(existing.map(u => [u.id, u]));

    if (existing.length === 0) {
      // First-install path: create the full roster with hashed default passwords.
      const records = [];
      for (const s of SEED_USERS) {
        const h = await __hashSeed(__seedPassword(s));
        const { password, ...rest } = s;
        records.push(newUser({
          ...rest,
          createdAt: now,
          passwordHash: h ? h.hash : null,
          passwordSalt: h ? h.salt : null,
          passwordSetAt: h ? now : null,
        }));
      }
      for (const u of records) await window.db.put('users', u);
      return records;
    }

    // Backfill path: existing browser DB. We do TWO things here.
    // (1) Create any seed user that doesn't exist yet (so adding a new entry
    //     to SEED_USERS retroactively propagates to existing installs).
    // (2) For seed users that exist but lack a password hash (records from
    //     before auth shipped), hash the default and persist it.
    // Custom (non-seed) user records are left alone — those need an admin
    // to assign a password via the Users admin page.
    let created = 0;
    let touched = 0;
    for (const seed of SEED_USERS) {
      const cur = existingById.get(seed.id);
      if (!cur) {
        // Missing → create.
        const h = await __hashSeed(__seedPassword(seed));
        const { password, ...rest } = seed;
        const rec = newUser({
          ...rest,
          createdAt: now,
          passwordHash: h ? h.hash : null,
          passwordSalt: h ? h.salt : null,
          passwordSetAt: h ? now : null,
        });
        await window.db.put('users', rec);
        created++;
        continue;
      }
      // Exists → only touch if it lacks a password hash.
      if (cur.passwordHash && cur.passwordSalt) continue;
      const h = await __hashSeed(__seedPassword(seed));
      if (!h) continue;
      const next = newUser({ ...cur, passwordHash: h.hash, passwordSalt: h.salt, passwordSetAt: now });
      await window.db.put('users', next);
      touched++;
    }
    if (created > 0) console.log('[current-user] created ' + created + ' missing seed user(s)');
    if (touched > 0) console.log('[current-user] backfilled passwords for ' + touched + ' seed user(s)');
    return existing;
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
  window.currentUserApi = { setCurrent, subscribe, displayName, refresh };

  start();
})();
