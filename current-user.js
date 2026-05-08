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
  const seedUsers = async () => {
    const existing = await window.db.list('users').catch(() => []);
    if (existing.length > 0) {
      // Backfill: if pre-newUser-factory records exist without a status field
      // or with stale roles, we don't rewrite — admin can edit. Same shape on
      // either side; callers read defensively.
      return existing;
    }
    const newUser = (window.schema && window.schema.newUser) || ((init) => init);
    const now = Date.now();
    const seeds = [
      { id: 'usr_seed_director', username: 'rivera', firstName: 'Sam',     lastName: 'Rivera',
        credentials: ['MD', 'FCAP'], roles: ['LAB_DIRECTOR', 'PATHOLOGIST'], createdAt: now },
      { id: 'usr_seed_super',    username: 'morgan',  firstName: 'Morgan', lastName: 'Lee',
        credentials: ['MT(ASCP)'],   roles: ['LAB_SUPERVISOR'],             createdAt: now },
      { id: 'usr_seed_tech',     username: 'alex',    firstName: 'Alex',   lastName: 'Tran',
        credentials: ['MLT'],        roles: ['MEDICAL_TECHNOLOGIST'],       createdAt: now },
      { id: 'usr_seed_assist',   username: 'priya',   firstName: 'Priya',  lastName: 'Patel',
        credentials: [],             roles: ['LAB_ASSISTANT'],              createdAt: now },
      { id: 'usr_seed_it',       username: 'jordan',  firstName: 'Jordan', lastName: 'Kim',
        credentials: [],             roles: ['IT_ADMIN'],                   createdAt: now },
    ];
    const records = seeds.map(s => newUser(s));
    for (const u of records) await window.db.put('users', u);
    return records;
  };

  const refresh = async () => {
    const users = await window.db.list('users').catch(() => []);
    // Keep a synchronous lookup cache so displayName() can resolve any actor id
    // without an async fetch — important for table cells rendered in tight loops.
    window.__userCache = Object.fromEntries(users.map(u => [u.id, u]));
    if (users.length === 0) return;
    const stored = localStorage.getItem(KEY);
    let cur = stored ? users.find(u => u.id === stored) : null;
    if (!cur) cur = users[0];
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
