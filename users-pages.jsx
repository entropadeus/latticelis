// users-pages.jsx — Admin > Users & Roles.
//
// CRUD over the `users` collection that current-user.js seeds. Adds, edits,
// deactivates, and (when safe) deletes users; assigns roles from the
// schema.ROLES catalog; surfaces credentials + facility scoping.
//
// Why deactivate-not-delete by default: every user record is a foreign key
// from audit_events, criticals (acked-by), QC overrides, releases, etc.
// Hard-deleting a user that has any history would orphan those references
// and break displayName resolution in historical views. The UI offers a
// hard-delete only when the user has zero audit history; otherwise the
// destructive button becomes a "Deactivate" button.

const UsersPage = ({ onBack }) => {
  const users = window.useEntities('users');
  const audit = window.useEntities('audit_events');
  const locations = window.useEntities('locations');

  const [editingId, setEditingId] = useStateOS(null);
  const [draft, setDraft] = useStateOS(null);
  const [q, setQ] = useStateOS('');
  const [statusFilter, setStatusFilter] = useStateOS('ALL'); // 'ALL' | 'ACTIVE' | 'INACTIVE'
  const [credInput, setCredInput] = useStateOS('');

  // Build "user → audit count" once so the row + form can both read it.
  // Counts both `actor === userId` and `criticalAckedBy === userId`-type
  // patterns by scanning audit_events.actor only — the canonical link.
  const auditCountByUser = useMemoOS(() => {
    const counts = {};
    for (const ev of audit) {
      if (!ev || !ev.actor) continue;
      counts[ev.actor] = (counts[ev.actor] || 0) + 1;
    }
    return counts;
  }, [audit]);

  const filtered = useMemoOS(() => {
    const needle = q.trim().toLowerCase();
    return [...users]
      .filter(u => statusFilter === 'ALL' ? true : (u.status || 'ACTIVE') === statusFilter)
      .filter(u => !needle || [
        u.firstName, u.lastName, u.username, u.email,
        ...(Array.isArray(u.roles) ? u.roles : []),
        ...(Array.isArray(u.credentials) ? u.credentials : []),
      ].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => {
        // Active first, then last name.
        const aActive = (a.status || 'ACTIVE') === 'ACTIVE' ? 0 : 1;
        const bActive = (b.status || 'ACTIVE') === 'ACTIVE' ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (a.lastName || a.username || '').localeCompare(b.lastName || b.username || '');
      });
  }, [users, q, statusFilter]);

  const pager = usePagination(filtered);

  const stats = useMemoOS(() => {
    const out = { total: users.length, active: 0, inactive: 0, byRole: {} };
    const roles = (window.schema && window.schema.ROLES) || [];
    for (const r of roles) out.byRole[r.id] = 0;
    for (const u of users) {
      if ((u.status || 'ACTIVE') === 'ACTIVE') out.active++; else out.inactive++;
      for (const r of (Array.isArray(u.roles) ? u.roles : [])) {
        out.byRole[r] = (out.byRole[r] || 0) + 1;
      }
    }
    return out;
  }, [users]);

  // Password fields are draft-only — never store plaintext on the user record.
  // On save, auth.setPassword does the hashing + persistence to passwordHash/Salt.
  // For new users: password is required (else they can't log in).
  // For existing users: blank means "leave existing hash alone."
  const [showPw, setShowPw] = useStateOS(false);

  const startNew = () => {
    setEditingId(null);
    setDraft({
      firstName: '', lastName: '', username: '', email: '',
      credentials: [], roles: [], facilityIds: [], status: 'ACTIVE',
      password: '', confirmPassword: '',
    });
    setCredInput('');
    setShowPw(false);
  };
  const startEdit = (u) => {
    setEditingId(u.id);
    setDraft({
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      username: u.username || '',
      email: u.email || '',
      credentials: Array.isArray(u.credentials) ? [...u.credentials] : [],
      roles: Array.isArray(u.roles) ? [...u.roles] : [],
      facilityIds: Array.isArray(u.facilityIds) ? [...u.facilityIds] : [],
      status: u.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      password: '', confirmPassword: '',
    });
    setCredInput('');
    setShowPw(false);
  };
  const cancel = () => { setEditingId(null); setDraft(null); setCredInput(''); setShowPw(false); };

  const toggleRole = (roleId) => {
    setDraft(d => {
      const has = d.roles.includes(roleId);
      return { ...d, roles: has ? d.roles.filter(r => r !== roleId) : [...d.roles, roleId] };
    });
  };
  const toggleFacility = (locId) => {
    setDraft(d => {
      const has = d.facilityIds.includes(locId);
      return { ...d, facilityIds: has ? d.facilityIds.filter(f => f !== locId) : [...d.facilityIds, locId] };
    });
  };
  const addCredential = () => {
    const v = credInput.trim();
    if (!v) return;
    setDraft(d => d.credentials.includes(v) ? d : { ...d, credentials: [...d.credentials, v] });
    setCredInput('');
  };
  const removeCredential = (c) => {
    setDraft(d => ({ ...d, credentials: d.credentials.filter(x => x !== c) }));
  };

  const save = async () => {
    if (!draft || !draft.firstName.trim() || !draft.lastName.trim()) return;
    if (!draft.username.trim()) {
      await safetyNotice({ tone: 'warning', title: 'Username required', message: 'Pick a username — it\'s what the operator types at sign-in.' });
      return;
    }
    if (draft.roles.length === 0) {
      await safetyNotice({ tone: 'warning', title: 'No roles selected', message: 'Pick at least one role so this user can do something.' });
      return;
    }
    // Password rules:
    //   New user: REQUIRED (otherwise they can't log in — login returns
    //     `no_password` and the operator has no path forward).
    //   Existing user: blank means "leave the current hash alone." Filled
    //     means "rotate the password to this value." Both fields must
    //     match when filled.
    const wantsPasswordChange = !!draft.password;
    if (!editingId && !wantsPasswordChange) {
      await safetyNotice({
        tone: 'warning',
        title: 'Password required',
        message: 'New users need a password set at create time, or they can\'t sign in. Use the field below the roster.',
      });
      return;
    }
    if (wantsPasswordChange) {
      if (draft.password.length < 4) {
        await safetyNotice({
          tone: 'warning',
          title: 'Password too short',
          message: 'Set a password of at least 4 characters. Stronger is better — this is browser-prototype hashing.',
        });
        return;
      }
      if (draft.password !== draft.confirmPassword) {
        await safetyNotice({
          tone: 'warning',
          title: 'Passwords don\'t match',
          message: 'The password and confirm fields differ — retype them so they line up.',
        });
        return;
      }
    }
    // Username uniqueness — case-insensitive, since auth.verify is case-insensitive.
    const usernameLower = draft.username.trim().toLowerCase();
    const conflict = users.find(u =>
      (u.username || '').toLowerCase() === usernameLower &&
      (!editingId || u.id !== editingId));
    if (conflict) {
      await safetyNotice({
        tone: 'danger',
        title: 'Username already taken',
        message: `Another user (${conflict.firstName} ${conflict.lastName}) already uses ${draft.username}. Pick a different one.`,
      });
      return;
    }
    const ask = await safetyConfirm({
      id: editingId ? 'admin.users.edit' : 'admin.users.create',
      tone: 'info',
      title: editingId ? 'Save user changes' : 'Create user',
      message: editingId
        ? 'Updating a user record changes who can do what across the lab.'
        : 'Adding a user gives them access to the LIS based on the roles you assign.',
      facts: [
        safetyFact('name', `${draft.firstName} ${draft.lastName}`),
        safetyFact('username', draft.username || '(none)'),
        safetyFact('roles', (draft.roles || []).join(', ') || 'none'),
        safetyFact('credentials', (draft.credentials || []).join(', ') || 'none'),
        safetyFact('status', draft.status),
        safetyFact('password', wantsPasswordChange
          ? (editingId ? 'rotating to a new password' : 'setting initial password')
          : 'unchanged'),
      ],
      entityType: 'user',
      entityId: editingId || 'new',
      confirmLabel: editingId ? 'Save user' : 'Create user',
    });
    if (!ask.confirmed) return;

    // Strip the plaintext draft fields so they never reach the user record.
    const { password, confirmPassword, ...persistable } = draft;
    let init = persistable;
    if (editingId) {
      const fresh = await window.db.get('users', editingId);
      init = { ...(fresh || {}), ...persistable, id: editingId };
    }
    const record = window.schema.newUser(init);
    await window.db.put('users', record);

    // Hash + persist the password AFTER the record exists, since auth.setPassword
    // reads the user back via window.db.get to set the hash on a known-real record.
    if (wantsPasswordChange && window.auth && window.auth.setPassword) {
      try {
        await window.auth.setPassword(record.id, password);
      } catch (e) {
        console.error('[users] setPassword failed', e);
        await safetyNotice({
          tone: 'danger',
          title: 'Password not set',
          message: 'The user record saved, but hashing the password failed: ' + (e.message || 'unknown error') + '. Edit and retry.',
        });
        return;
      }
    }
    cancel();
  };

  const clearPasswordFor = async (u) => {
    if (!u || !window.auth || !window.auth.clearPassword) return;
    const ask = await safetyConfirm({
      id: 'admin.users.clear_password',
      tone: 'warning',
      title: 'Clear password',
      message: 'After clearing, this user cannot sign in until an admin sets a new password. Use this when an account is compromised or the password needs reset.',
      facts: [
        safetyFact('name', `${u.firstName} ${u.lastName}`),
        safetyFact('username', u.username),
      ],
      entityType: 'user',
      entityId: u.id,
      confirmLabel: 'Clear password',
    });
    if (!ask.confirmed) return;
    await window.auth.clearPassword(u.id);
  };

  const deactivate = async (u) => {
    const ask = await safetyConfirm({
      id: 'admin.users.deactivate',
      tone: 'warning',
      title: 'Deactivate user',
      message: 'Deactivated users keep all audit history and historical attributions, but disappear from pickers and stop receiving role-targeted notifications. You can reactivate any time.',
      facts: [
        safetyFact('name', `${u.firstName} ${u.lastName}`),
        safetyFact('username', u.username || '(none)'),
        safetyFact('audit history', auditCountByUser[u.id] || 0),
      ],
      entityType: 'user',
      entityId: u.id,
      confirmLabel: 'Deactivate user',
    });
    if (!ask.confirmed) return;
    const fresh = await window.db.get('users', u.id);
    if (!fresh) return;
    await window.db.put('users', window.schema.newUser({ ...fresh, status: 'INACTIVE' }));
  };

  const reactivate = async (u) => {
    const fresh = await window.db.get('users', u.id);
    if (!fresh) return;
    await window.db.put('users', window.schema.newUser({ ...fresh, status: 'ACTIVE' }));
  };

  const hardDelete = async (u) => {
    const count = auditCountByUser[u.id] || 0;
    if (count > 0) {
      await safetyNotice({
        tone: 'danger',
        title: 'Delete blocked',
        message: `${u.firstName} ${u.lastName} has ${count} audit event${count === 1 ? '' : 's'} attributed to them. Deactivate instead — historical attributions need this record to resolve to a name.`,
      });
      return;
    }
    const ask = await safetyConfirm({
      id: 'admin.users.delete',
      tone: 'danger',
      title: 'Delete user',
      message: 'This user has no audit history yet, so a hard delete is safe. Otherwise we would block this and force a deactivate.',
      facts: [
        safetyFact('name', `${u.firstName} ${u.lastName}`),
        safetyFact('username', u.username || '(none)'),
      ],
      requireTypedText: 'DELETE',
      entityType: 'user',
      entityId: u.id,
      confirmLabel: 'Delete user',
    });
    if (!ask.confirmed) return;
    await window.db.delete('users', u.id);
    if (editingId === u.id) cancel();
  };

  const editingExisting = !!editingId;
  const editingUser = editingId ? users.find(u => u.id === editingId) : null;
  const auditCountForEditing = editingUser ? (auditCountByUser[editingUser.id] || 0) : 0;
  const roles = (window.schema && window.schema.ROLES) || [];
  const labLocations = (locations || []).filter(l => l.kind === 'LAB' || !l.kind);

  return (
    <Page label="Users & Roles">
      <PageHeader title="Users & Roles" sub="Operators, credentials, role assignments."
        actions={[
          <button key="b" className="btn" data-size="sm" data-variant="ghost" onClick={onBack}>
            <IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin
          </button>,
          <button key="n" className="btn" data-size="sm" data-variant="primary" onClick={startNew}>New user</button>,
        ]}/>

      <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {[
          { l: 'Total', v: stats.total, tone: 'slate' },
          { l: 'Active', v: stats.active, tone: 'sage' },
          { l: 'Inactive', v: stats.inactive, tone: 'ghost' },
          { l: 'Roles in use', v: Object.values(stats.byRole).filter(n => n > 0).length, tone: 'amber' },
        ].map((s, i) => (
          <div key={s.l} style={{ padding: '12px 16px', borderRight: i < 3 ? '1px solid var(--line)' : 'none' }}>
            <div className="section-title" style={{ fontSize: 10 }}>{s.l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <span className="mono tnum" style={{ fontSize: 22, fontWeight: 500, color: s.v ? 'var(--ink-900)' : 'var(--ink-300)' }}>{s.v}</span>
              <span className="pill" data-tone={s.tone} style={{ fontSize: 10 }}>{s.l.toLowerCase()}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: draft ? '1fr 1fr' : '1fr', gap: 12 }}>

        {/* List + filters */}
        <div className="panel">
          <div style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="input" placeholder="Search users…"
              value={q} onChange={e => setQ(e.target.value)}
              style={{ flex: 1 }}/>
            <select className="input" value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              style={{ width: 110 }}>
              <option value="ALL">All status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          {filtered.length > 0 && <TablePagination {...pager} pos="top"/>}
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: '36px 24px' }}>
              <div className="empty-title">No users match</div>
              <div className="empty-sub">{q ? 'Try a different search.' : 'Add a user with the New user button.'}</div>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}/>
                  <th>Name</th>
                  <th style={{ width: 140 }}>Username</th>
                  <th>Roles</th>
                  <th style={{ width: 100 }}>Credentials</th>
                  <th style={{ width: 70 }}>Status</th>
                  <th style={{ width: 70, textAlign: 'right' }}>Audit</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.map(u => {
                  const meta = window.userRoles ? window.userRoles.primaryRoleMeta(u.id) : null;
                  const userRoles = Array.isArray(u.roles) ? u.roles : [];
                  const inactive = u.status === 'INACTIVE';
                  return (
                    <tr key={u.id} onClick={() => startEdit(u)}
                      style={{
                        cursor: 'pointer',
                        background: editingId === u.id ? 'var(--sage-50)' : 'transparent',
                        opacity: inactive ? 0.65 : 1,
                      }}>
                      <td>
                        <span style={{
                          width: 26, height: 26, borderRadius: '50%',
                          background: 'var(--sage-200)', color: 'var(--sage-900)',
                          display: 'grid', placeItems: 'center',
                          fontSize: 10, fontWeight: 500,
                        }}>
                          {(u.firstName || '?').slice(0, 1).toUpperCase()}{(u.lastName || '').slice(0, 1).toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-900)' }}>
                          {[u.firstName, u.lastName].filter(Boolean).join(' ') || '(unnamed)'}
                        </div>
                        {u.email && (
                          <div style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>{u.email}</div>
                        )}
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{u.username || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {userRoles.length === 0 ? (
                            <span style={{ fontSize: 10.5, color: 'var(--ink-300)' }}>—</span>
                          ) : userRoles.map(roleId => {
                            const r = (window.schema && window.schema.ROLE_BY_ID && window.schema.ROLE_BY_ID[roleId]) || { tone: 'ghost', label: roleId };
                            const isPrimary = meta && meta.id === roleId;
                            return (
                              <span key={roleId} className="pill" data-tone={r.tone}
                                style={{ fontSize: 10, fontWeight: isPrimary ? 500 : 400 }}>
                                {r.label}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 10.5, color: 'var(--ink-500)' }}>
                        {(u.credentials || []).join(', ') || '—'}
                      </td>
                      <td>
                        <span className="pill" data-tone={inactive ? 'ghost' : 'sage'} style={{ fontSize: 10 }}>
                          {inactive ? 'inactive' : 'active'}
                        </span>
                      </td>
                      <td className="mono tnum" style={{ textAlign: 'right', fontSize: 11, color: 'var(--ink-400)' }}>
                        {auditCountByUser[u.id] || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {filtered.length > 0 && <TablePagination {...pager}/>}
        </div>

        {/* Edit form */}
        {draft && (
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {editingExisting ? 'Edit user' : 'New user'}
              </span>
              {editingExisting && auditCountForEditing > 0 && (
                <span className="pill" data-tone="ghost" style={{ marginLeft: 8, fontSize: 10 }}>
                  {auditCountForEditing} audit event{auditCountForEditing === 1 ? '' : 's'}
                </span>
              )}
              <span style={{ flex: 1 }}/>
              <button className="btn" data-size="xs" data-variant="ghost" onClick={cancel}>Close</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>First name</div>
                <input className="input" value={draft.firstName}
                  onChange={e => setDraft(d => ({ ...d, firstName: e.target.value }))}/>
              </div>
              <div>
                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Last name</div>
                <input className="input" value={draft.lastName}
                  onChange={e => setDraft(d => ({ ...d, lastName: e.target.value }))}/>
              </div>
              <div>
                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Username</div>
                <input className="input" value={draft.username}
                  onChange={e => setDraft(d => ({ ...d, username: e.target.value }))}
                  placeholder="alex"/>
              </div>
              <div>
                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Email</div>
                <input className="input" type="email" value={draft.email}
                  onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                  placeholder="alex@lab.example"/>
              </div>
            </div>

            {/* Password — required at create, optional at edit (blank keeps existing).
                Stored only in draft state; auth.setPassword does the hashing on save. */}
            <div style={{ marginBottom: 10, padding: '10px 12px', background: 'var(--ivory-50)', border: '1px solid var(--line-soft)', borderRadius: 5 }}>
              <div className="section-title" style={{ fontSize: 10, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{editingExisting ? 'Reset password' : 'Set password'}</span>
                {!editingExisting && <span style={{ color: 'var(--rust, #B5462E)', textTransform: 'none', letterSpacing: 0 }}>· required</span>}
                {editingExisting && (
                  <span style={{ color: 'var(--ink-300)', textTransform: 'none', letterSpacing: 0 }}>
                    · leave blank to keep current
                  </span>
                )}
                <span style={{ flex: 1 }}/>
                {editingExisting && editingUser && window.auth && window.auth.hasPassword(editingUser) && (
                  <span className="pill" data-tone="sage" style={{ fontSize: 9.5 }}>password set</span>
                )}
                {editingExisting && editingUser && window.auth && !window.auth.hasPassword(editingUser) && (
                  <span className="pill" data-tone="amber" style={{ fontSize: 9.5 }}>no password</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ position: 'relative' }}>
                  <input className="input" type={showPw ? 'text' : 'password'}
                    placeholder={editingExisting ? '••••••••' : 'min 4 characters'}
                    value={draft.password}
                    autoComplete="new-password"
                    onChange={e => setDraft(d => ({ ...d, password: e.target.value }))}
                    style={{ width: '100%', paddingRight: 50 }}/>
                  <button type="button"
                    onClick={() => setShowPw(s => !s)}
                    style={{
                      position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                      border: 0, background: 'transparent', cursor: 'pointer',
                      color: 'var(--ink-400)', fontSize: 10.5, padding: 4, lineHeight: 1,
                    }}
                    tabIndex={-1}
                    title={showPw ? 'Hide' : 'Show'}>
                    {showPw ? 'hide' : 'show'}
                  </button>
                </div>
                <input className="input" type={showPw ? 'text' : 'password'}
                  placeholder="confirm"
                  value={draft.confirmPassword}
                  autoComplete="new-password"
                  onChange={e => setDraft(d => ({ ...d, confirmPassword: e.target.value }))}/>
              </div>
              {draft.password && draft.confirmPassword && draft.password !== draft.confirmPassword && (
                <div style={{ fontSize: 10.5, color: 'var(--err-700, #B5462E)', marginTop: 4 }}>
                  passwords don't match yet
                </div>
              )}
              {editingExisting && editingUser && window.auth && window.auth.hasPassword(editingUser) && (
                <div style={{ marginTop: 6 }}>
                  <button type="button"
                    onClick={() => clearPasswordFor(editingUser)}
                    style={{
                      border: 0, background: 'transparent', cursor: 'pointer', padding: 0,
                      fontSize: 10.5, color: 'var(--ink-500)', textDecoration: 'underline',
                    }}>
                    Clear password (force admin reset before next sign-in)
                  </button>
                </div>
              )}
            </div>

            {/* Credentials chip input */}
            <div style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>Credentials</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                {draft.credentials.map(c => (
                  <span key={c} className="pill" data-tone="ghost" style={{ fontSize: 10 }}>
                    {c}
                    <button onClick={() => removeCredential(c)}
                      style={{ marginLeft: 6, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--ink-400)', padding: 0, fontSize: 11 }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input className="input" placeholder="MD, MT(ASCP), etc."
                  value={credInput}
                  onChange={e => setCredInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCredential(); } }}
                  style={{ flex: 1 }}/>
                <button className="btn" data-size="sm" onClick={addCredential}>Add</button>
              </div>
            </div>

            {/* Roles */}
            <div style={{ marginBottom: 10 }}>
              <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>
                Roles <span style={{ color: 'var(--ink-300)' }}>· at least one required</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
                {roles.map(r => {
                  const enabled = draft.roles.includes(r.id);
                  return (
                    <label key={r.id}
                      title={r.description}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                        padding: '6px 8px',
                        background: enabled ? '#fff' : 'var(--ivory-100)',
                        border: '1px solid var(--line)',
                        borderRadius: 4,
                        cursor: 'pointer',
                        opacity: enabled ? 1 : 0.7,
                      }}>
                      <input type="checkbox" checked={enabled}
                        onChange={() => toggleRole(r.id)}
                        style={{ marginTop: 2 }}/>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 500 }}>{r.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--ink-400)', lineHeight: 1.3 }}>{r.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Facilities */}
            {labLocations.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div className="section-title" style={{ fontSize: 10, marginBottom: 4 }}>
                  Facilities <span style={{ color: 'var(--ink-300)' }}>· empty = all</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {labLocations.map(loc => {
                    const enabled = draft.facilityIds.includes(loc.id);
                    return (
                      <button key={loc.id}
                        onClick={() => toggleFacility(loc.id)}
                        className="pill"
                        data-tone={enabled ? 'sage' : 'ghost'}
                        style={{ fontSize: 10, cursor: 'pointer', border: 'none', opacity: enabled ? 1 : 0.6 }}>
                        {enabled ? '✓ ' : ''}{loc.name || loc.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Status */}
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500 }}>Status</span>
              <button
                onClick={() => setDraft(d => ({ ...d, status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }))}
                className="pill"
                data-tone={draft.status === 'ACTIVE' ? 'sage' : 'ghost'}
                style={{ fontSize: 10, cursor: 'pointer', border: 'none' }}>
                {draft.status === 'ACTIVE' ? '✓ active' : 'inactive'}
              </button>
              <span style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>
                {draft.status === 'ACTIVE'
                  ? 'visible in pickers, receives role-targeted notifications'
                  : 'hidden from pickers; historical attributions still resolve'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button className="btn" data-size="sm" data-variant="primary" onClick={save}
                disabled={!draft.firstName.trim() || !draft.lastName.trim()}>
                {editingExisting ? 'Save user' : 'Create user'}
              </button>
              <button className="btn" data-size="sm" onClick={cancel}>Cancel</button>
              <span style={{ flex: 1 }}/>
              {editingExisting && editingUser && (editingUser.status || 'ACTIVE') === 'ACTIVE' && (
                <button className="btn" data-size="sm" data-variant="ghost"
                  onClick={() => deactivate(editingUser)}>
                  Deactivate
                </button>
              )}
              {editingExisting && editingUser && editingUser.status === 'INACTIVE' && (
                <button className="btn" data-size="sm" data-variant="ghost"
                  onClick={() => reactivate(editingUser)}>
                  Reactivate
                </button>
              )}
              {editingExisting && editingUser && (
                <button className="btn" data-size="sm" data-variant="danger"
                  onClick={() => hardDelete(editingUser)}
                  title={auditCountForEditing > 0 ? 'Blocked — user has audit history' : 'Hard delete (only safe with no audit history)'}>
                  Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Roster-by-role helper panel: shows who's actually on call for each role */}
      <div className="panel" style={{ marginTop: 14 }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>Roster by role</span>
          <span style={{ marginLeft: 8, fontSize: 10.5, color: 'var(--ink-400)' }}>
            who actually gets paged when a role is targeted
          </span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 220 }}>Role</th>
              <th style={{ width: 70, textAlign: 'right' }}>Active</th>
              <th>Users</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(r => {
              const matched = window.userRoles ? window.userRoles.usersByRole(r.id) : [];
              return (
                <tr key={r.id}>
                  <td>
                    <span className="pill" data-tone={r.tone} style={{ fontSize: 10 }}>{r.label}</span>
                    <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--ink-400)' }}>{r.description}</span>
                  </td>
                  <td className="mono tnum" style={{ textAlign: 'right', color: matched.length === 0 ? 'var(--warn-700)' : 'var(--ink-700)' }}>
                    {matched.length}
                  </td>
                  <td>
                    {matched.length === 0 ? (
                      <span style={{ fontSize: 10.5, color: 'var(--warn-700)' }}>
                        no active users — TAT/escalation alerts targeted here will page nobody
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {matched.map(u => (
                          <span key={u.id}
                            onClick={() => startEdit(u)}
                            className="pill" data-tone="ghost"
                            style={{ fontSize: 10.5, cursor: 'pointer' }}>
                            {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.username}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Page>
  );
};

window.UsersPage = UsersPage;
