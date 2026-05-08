// user-roles.js — Identity, role, and permission resolution.
//
// Operates against `window.__userCache` (populated synchronously by
// current-user.js). Synchronous so render-loop call sites (table cells,
// audit-row pills, safety modal facts) don't pay an async hop per row.
//
// Surfaces:
//   usersByRole(roleId)              → User[] (active only, deduped)
//   userHasRole(userId, roleId)      → bool   (false on inactive / unknown)
//   userHasPermission(userId, perm)  → bool   (consults schema.PERMISSIONS)
//   resolveRoleRecipients(roleIds)   → User[] (active, deduped across roles)
//   userRolesSnapshot(userId)        → string[]  (frozen copy for audit stamping)
//   primaryRole(userId)              → roleId | null  (catalog-order priority)
//   primaryRoleMeta(userId)          → ROLE row | null
//
// Snapshot semantics for audit:
//   When an action is recorded, callers should stamp `actorRoles:
//   userRolesSnapshot(currentUser.id)` so the audit row freezes the
//   user's roles AT THE TIME of the action. Later role-change shouldn't
//   rewrite history. Stamping is opt-in per call site to keep the audit
//   shape backwards-compatible with older records.

(function () {

  const __cache = () => window.__userCache || {};

  const __activeUsers = () => {
    const out = [];
    for (const u of Object.values(__cache())) {
      if (!u || u.status === 'INACTIVE') continue;
      out.push(u);
    }
    return out;
  };

  const __rolesOf = (user) => {
    if (!user || !Array.isArray(user.roles)) return [];
    return user.roles;
  };

  // Catalog-order priority — first match in ROLES (Director, Supervisor, …)
  // wins. Letting users define their own ranking is a future iteration; for
  // the prototype the catalog ordering matches the medical hierarchy.
  const __catalogOrder = () => {
    const roles = (window.schema && window.schema.ROLES) || [];
    return roles.map(r => r.id);
  };

  const usersByRole = (roleId) => {
    if (!roleId) return [];
    return __activeUsers().filter(u => __rolesOf(u).includes(roleId));
  };

  const userHasRole = (userId, roleId) => {
    if (!userId || !roleId) return false;
    const u = __cache()[userId];
    if (!u || u.status === 'INACTIVE') return false;
    return __rolesOf(u).includes(roleId);
  };

  const userHasPermission = (userId, permission) => {
    if (!userId || !permission) return false;
    const u = __cache()[userId];
    if (!u || u.status === 'INACTIVE') return false;
    const matrix = window.schema && window.schema.PERMISSIONS;
    if (!matrix) return true;  // schema not ready yet — fail open until init
    const allowed = matrix[permission];
    // Unknown permissions are treated as "no gate" — caller is asking about
    // a capability not in the matrix, so we don't synthesize a deny.
    if (!Array.isArray(allowed)) return true;
    if (allowed.length === 0) return false;  // explicitly empty = no one
    const userRoles = __rolesOf(u);
    return allowed.some(r => userRoles.includes(r));
  };

  const resolveRoleRecipients = (roleIds) => {
    if (!Array.isArray(roleIds) || roleIds.length === 0) return [];
    const seen = new Set();
    const out = [];
    for (const roleId of roleIds) {
      for (const u of usersByRole(roleId)) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        out.push(u);
      }
    }
    return out;
  };

  // Frozen copy. Callers that stamp this on an audit event should NOT mutate
  // the returned array — but if they do, they only damage their own copy.
  const userRolesSnapshot = (userId) => {
    if (!userId) return [];
    const u = __cache()[userId];
    return u && Array.isArray(u.roles) ? [...u.roles] : [];
  };

  const primaryRole = (userId) => {
    const userRoles = userRolesSnapshot(userId);
    if (userRoles.length === 0) return null;
    const order = __catalogOrder();
    for (const roleId of order) {
      if (userRoles.includes(roleId)) return roleId;
    }
    // Catalog miss — return the first held role so we don't lose info.
    return userRoles[0];
  };

  const primaryRoleMeta = (userId) => {
    const id = primaryRole(userId);
    if (!id) return null;
    const map = window.schema && window.schema.ROLE_BY_ID;
    return (map && map[id]) || { id, label: id, tone: 'ghost', description: '' };
  };

  window.userRoles = {
    usersByRole,
    userHasRole,
    userHasPermission,
    resolveRoleRecipients,
    userRolesSnapshot,
    primaryRole,
    primaryRoleMeta,
  };
})();
