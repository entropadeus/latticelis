// Rules Engine — the centerpiece of Lattice
// A composable system: triggers + condition tree + action sequence
// All UI is real — you can create, edit, enable/disable, version, test rules.
// No seed data. Empty until you build something.

const { useState: useStateRE, useMemo: useMemoRE, useEffect: useEffectRE, useRef: useRefRE } = React;

// =====================================================================
// Top-level Rules page
// =====================================================================
const RulesEnginePage = ({ rules, setRules, onBack }) => {
  const [view, setView] = useStateRE('list'); // list | editor | test
  const [activeRuleId, setActiveRuleId] = useStateRE(null);
  const [filter, setFilter] = useStateRE({ q: '', status: 'all', cat: 'all' });
  const canEditRules = hasPermission('EDIT_RULES');

  const activeRule = rules.find(r => r.id === activeRuleId);

  const openRule = (id) => { setActiveRuleId(id); setView('editor'); };
  const newRule = () => {
    if (!hasPermission('EDIT_RULES')) return;
    const r = createBlankRule();
    setRules([r, ...rules]);
    setActiveRuleId(r.id);
    setView('editor');
  };
  const updateRule = async (updated, opts = {}) => {
    if (!hasPermission('EDIT_RULES')) return false;
    const prev = rules.find(r => r.id === updated.id) || null;
    if (!updated || !updated.id) return false;
    if (await needsRuleSafetyConfirm(prev, updated, opts)) {
      const ask = await confirmRuleSafety(prev, updated, opts);
      if (!ask.confirmed) return false;
      const fresh = window.db ? await window.db.get('rules', updated.id).catch(() => null) : null;
      if (fresh && fresh.updatedAt && prev && prev.updatedAt && fresh.updatedAt !== prev.updatedAt) {
        await window.safetyConfirm({
          id: 'admin.rule.changed_notice',
          tone: 'warning',
          title: 'Rule changed since opening',
          message: 'This rule changed in storage after you opened it. Reopen it before saving live automation changes.',
          facts: [
            ruleFact('rule id', updated.id),
            ruleFact('current updated', new Date(fresh.updatedAt).toLocaleString()),
            ruleFact('draft updated', new Date(prev.updatedAt).toLocaleString()),
          ],
          notice: true,
          confirmLabel: 'Close',
        });
        return false;
      }
    }
    if (!hasPermission('EDIT_RULES')) return false;
    setRules(rules.map(r => r.id === updated.id ? updated : r));
    return true;
  };
  const deleteRule = async (id) => {
    if (!hasPermission('EDIT_RULES')) return;
    const rule = rules.find(r => r.id === id);
    if (!rule) return;
    const ask = window.safetyConfirm
      ? await window.safetyConfirm({
          id: 'admin.rule.delete',
          tone: 'danger',
          title: 'Delete rule',
          message: 'This removes the automation rule from the rules engine.',
          facts: [
            { label: 'rule id', value: rule.id },
            { label: 'name', value: rule.name || '-' },
            { label: 'trigger', value: rule.trigger || '-' },
            { label: 'enabled', value: rule.enabled ? 'yes' : 'no' },
          ],
          entityType: 'rule',
          entityId: rule.id,
          confirmLabel: 'Delete rule',
        })
      : { confirmed: false };
    if (!ask.confirmed) return;
    if (!hasPermission('EDIT_RULES')) return;
    setRules(rules.filter(r => r.id !== id));
    if (activeRuleId === id) { setActiveRuleId(null); setView('list'); }
  };
  const duplicateRule = (id) => {
    if (!hasPermission('EDIT_RULES')) return;
    const src = rules.find(r => r.id === id);
    if (!src) return;
    const copy = { ...src, id: 'r_' + Math.random().toString(36).slice(2, 9), name: src.name + ' (copy)', enabled: false, version: 1, updatedAt: Date.now() };
    setRules([copy, ...rules]);
  };

  if (view === 'editor' && activeRule) {
    return (
      <RuleEditor
        rule={activeRule}
        onSave={(r) => updateRule(r, { source: 'editor-save' })}
        onClose={() => { setActiveRuleId(null); setView('list'); }}
        onDelete={deleteRule}
        onDuplicate={duplicateRule}
        canEdit={canEditRules}
      />
    );
  }

  return (
    <RulesListView
      rules={rules}
      filter={filter}
      setFilter={setFilter}
      onOpen={openRule}
      onNew={newRule}
      onToggle={(id, enabled) => {
        const rule = rules.find(r => r.id === id);
        if (!rule) return;
        updateRule({ ...rule, enabled, updatedAt: Date.now() }, { source: 'list-toggle' });
      }}
      onDuplicate={duplicateRule}
      onDelete={deleteRule}
      onBack={onBack}
      canEdit={canEditRules}
    />
  );
};

// =====================================================================
// Helpers — rule shape
// =====================================================================
const ruleFact = (label, value) => ({ label, value: value == null || value === '' ? '-' : String(value) });

const RULE_ACTION_RISK = {
  'route.to.lab': 'routes specimens',
  'route.to.analyzer': 'routes specimens',
  'route.to.refLab': 'sends specimens out',
  'route.to.dept': 'routes specimens',
  'route.split': 'creates aliquot workflow',
  'order.hold': 'holds orders',
  'order.reject': 'cancels/rejects orders',
  'order.requireDx': 'blocks billing/order flow',
  'order.requireAuth': 'blocks order flow',
  'order.flag': 'adds operational flags',
  'order.reflex.add': 'adds tests',
  'order.reflex.cancel': 'cancels tests',
  'order.reflex.replace': 'replaces tests',
  'order.panel.expand': 'adds panel tests',
  'result.flag.set': 'changes result interpretation',
  'result.range.apply': 'changes result interpretation',
  'result.comment.append': 'changes reported result text',
  'result.autoVerify': 'verifies results',
  'result.holdRelease': 'blocks release',
  'notify.provider': 'contacts providers',
  'notify.critical': 'triggers critical workflow',
  'message.send.hl7': 'sends interface messages',
  'message.transform': 'changes interface payloads',
  'label.print': 'prints labels',
  'report.generate': 'generates reports',
};

const ruleActionSummary = (rule) => {
  const actions = Array.isArray(rule && rule.actions) ? rule.actions : [];
  return actions
    .map(a => a && a.primitive)
    .filter(Boolean)
    .map(id => {
      const prim = window.ACTION_PRIMITIVES && window.ACTION_PRIMITIVES.find(p => p.id === id);
      return (prim ? prim.label : id) + (RULE_ACTION_RISK[id] ? ' - ' + RULE_ACTION_RISK[id] : '');
    });
};

const hasSensitiveRuleAction = (rule) => {
  const actions = Array.isArray(rule && rule.actions) ? rule.actions : [];
  return actions.some(a => a && RULE_ACTION_RISK[a.primitive]);
};

const needsRuleSafetyConfirm = async (prev, next, opts = {}) => {
  if (!window.safetyConfirm) return false;
  const enabledChanged = !!prev && !!prev.enabled !== !!next.enabled;
  const savingLiveRule = opts.source === 'editor-save' && (next.enabled || (prev && prev.enabled));
  return enabledChanged || (savingLiveRule && hasSensitiveRuleAction(next));
};

const confirmRuleSafety = async (prev, next, opts = {}) => {
  const enabling = (!prev || !prev.enabled) && next.enabled;
  const disabling = prev && prev.enabled && !next.enabled;
  const actionLines = ruleActionSummary(next);
  const facts = [
    ruleFact('rule id', next.id),
    ruleFact('name', next.name || 'Untitled rule'),
    ruleFact('trigger', next.trigger),
    ruleFact('enabled', next.enabled ? 'yes' : 'no'),
    ruleFact('actions', actionLines.length ? actionLines.join('; ') : 'none'),
  ];
  if (prev) facts.push(ruleFact('previous version', prev.version || 1));
  facts.push(ruleFact('next version', next.version || 1));
  const id = enabling ? 'admin.rule.enable'
    : disabling ? 'admin.rule.disable'
    : 'admin.rule.save_live';
  const title = enabling ? 'Enable automation rule'
    : disabling ? 'Disable automation rule'
    : 'Save live automation rule';
  const message = enabling
    ? 'This rule will run automatically when matching clinical events occur.'
    : disabling
      ? 'This stops automation that may currently protect routing, holds, notifications, or result handling.'
      : 'This changes an enabled rule. Future matching clinical events will use the new behavior.';
  return window.safetyConfirm({
    id,
    tone: enabling ? 'warning' : 'danger',
    title,
    message,
    facts,
    requireReason: true,
    reasonLabel: 'Change reason',
    reasonPlaceholder: 'why this automation change is safe',
    entityType: 'rule',
    entityId: next.id,
    confirmLabel: enabling ? 'Enable rule' : disabling ? 'Disable rule' : 'Save live rule',
  });
};

const newId = () => 'r_' + Math.random().toString(36).slice(2, 9);
const newCondId = () => 'c_' + Math.random().toString(36).slice(2, 7);

const createBlankRule = () => ({
  id: newId(),
  name: 'Untitled rule',
  description: '',
  category: 'Routing',
  trigger: 'order.created',
  enabled: false,
  version: 1,
  // Conditions: tree with AND/OR groups
  conditions: { op: 'AND', children: [] },
  // Actions: ordered list
  actions: [],
  // Metadata
  createdAt: Date.now(),
  updatedAt: Date.now(),
  author: 'You',
  // Stats — empty until rule has run
  stats: { runs: 0, matches: 0, lastRun: null },
});

const RULE_CATEGORIES = [
  { id: 'Routing',     label: 'Routing & Triage',  tone: 'sage' },
  { id: 'Validation',  label: 'Validation',        tone: 'amber' },
  { id: 'Reflex',      label: 'Reflex & Cascade',  tone: 'info' },
  { id: 'Result',      label: 'Result Handling',   tone: 'sage' },
  { id: 'Notify',      label: 'Notifications',     tone: 'slate' },
  { id: 'Output',      label: 'Output / HL7',      tone: 'slate' },
  { id: 'Audit',       label: 'Audit & Tagging',   tone: 'ghost' },
];

// =====================================================================
// Rules List View
// =====================================================================
const RulesListView = ({ rules, filter, setFilter, onOpen, onNew, onToggle, onDuplicate, onDelete, onBack, canEdit }) => {
  const filtered = rules.filter(r => {
    if (filter.status === 'enabled' && !r.enabled) return false;
    if (filter.status === 'disabled' && r.enabled) return false;
    if (filter.cat !== 'all' && r.category !== filter.cat) return false;
    if (filter.q && !(r.name + ' ' + r.description).toLowerCase().includes(filter.q.toLowerCase())) return false;
    return true;
  });

  const counts = useMemoRE(() => ({
    total: rules.length,
    enabled: rules.filter(r => r.enabled).length,
    byCategory: RULE_CATEGORIES.map(c => ({ ...c, count: rules.filter(r => r.category === c.id).length })),
  }), [rules]);

  return (
    <div data-screen-label="Rules Engine — list" style={{ padding: '0 32px 24px', display: 'flex', flexDirection: 'column', gap: 18, height: '100%', overflow: 'auto' }}>
      {/* Header — paddingTop here (not on the scroll container) so sticky
          children inside the scroll area sit flush at the top when scrolled. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, paddingTop: 24 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Rules Engine</h1>
          <p className="page-sub">Composable, observable logic that governs orders, specimens, results, and messages.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {onBack && (
            <button className="btn" data-size="sm" data-variant="ghost" onClick={onBack}>
              <IconChevRight size={13} style={{ transform: 'rotate(180deg)' }}/> Admin
            </button>
          )}
          <button className="btn" data-size="sm">
            <IconBook size={13}/> Library
          </button>
          <button className="btn" data-size="sm">
            <IconArchive size={13}/> Versions
          </button>
          <button className="btn" data-variant="primary" data-size="sm" onClick={onNew}
            disabled={!canEdit}
            title={permissionTitle(canEdit, 'Create new rule', 'edit rules')}>
            <IconPlus size={13}/> New rule
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 0.65fr) minmax(130px, 0.65fr) minmax(0, 3fr)', gap: 0, border: '1px solid var(--line)', borderRadius: 7, background: '#fff', overflow: 'hidden' }}>
        <StatBlock label="Total rules" value={counts.total}/>
        <StatBlock label="Enabled" value={counts.enabled} accent="sage"/>
        <div style={{ borderLeft: '1px solid var(--line)', padding: '11px 16px', display: 'grid', gridTemplateColumns: '88px 1fr', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div className="section-title" style={{ fontSize: 10 }}>By category</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '7px 14px', minWidth: 0 }}>
          {counts.byCategory.map(c => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(44px, max-content) auto', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--ink-500)' }}>
              <span className="dot" data-tone={c.count > 0 ? 'ok' : 'idle'}/>
              <span>{c.label}</span>
              <span className="mono tnum" style={{ color: 'var(--ink-700)' }}>{c.count}</span>
            </div>
          ))}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderBottom: '1px solid var(--line)' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
            <IconSearch size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-300)' }}/>
            <input className="input" style={{ paddingLeft: 30, height: 28 }}
              placeholder="Search rules…"
              value={filter.q} onChange={e => setFilter({ ...filter, q: e.target.value })}/>
          </div>
          <SegSelect options={[
            { id: 'all', label: 'All' },
            { id: 'enabled', label: 'Enabled' },
            { id: 'disabled', label: 'Disabled' },
          ]} value={filter.status} onChange={v => setFilter({ ...filter, status: v })}/>
          <Select value={filter.cat} onChange={v => setFilter({ ...filter, cat: v })}
            options={[{ id: 'all', label: 'All categories' }, ...RULE_CATEGORIES.map(c => ({ id: c.id, label: c.label }))]}/>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-size="sm" data-variant="ghost"><IconFilter size={13}/> More filters</button>
          <button className="btn" data-size="sm" data-variant="ghost"><IconSort size={13}/> Sort</button>
        </div>

        {filtered.length === 0 ? (
          <RulesEmpty hasAny={rules.length > 0} onNew={onNew} canEdit={canEdit}/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th>Name</th>
                <th style={{ width: 140 }}>Category</th>
                <th style={{ width: 200 }}>Trigger</th>
                <th style={{ width: 90 }}>Conditions</th>
                <th style={{ width: 90 }}>Actions</th>
                <th style={{ width: 150 }}>Activity</th>
                <th style={{ width: 90 }}>Version</th>
                <th style={{ width: 130 }}>Updated</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <RuleRow key={r.id} rule={r}
                  onOpen={() => onOpen(r.id)}
                  onToggle={(en) => onToggle(r.id, en)}
                  onDuplicate={() => onDuplicate(r.id)}
                  onDelete={() => onDelete(r.id)}
                  canEdit={canEdit}/>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const StatBlock = ({ label, value, accent }) => (
  <div style={{ padding: '14px 18px', borderRight: '1px solid var(--line)' }}>
    <div className="section-title" style={{ fontSize: 10 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em', color: accent === 'sage' ? 'var(--sage-700)' : 'var(--ink-900)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </div>
);

const RuleRow = ({ rule, onOpen, onToggle, onDuplicate, onDelete, canEdit }) => {
  const cat = RULE_CATEGORIES.find(c => c.id === rule.category);
  const trig = RULE_TRIGGERS.find(t => t.id === rule.trigger);
  const condCount = countConditions(rule.conditions);
  return (
    <tr style={{ cursor: 'pointer' }} onClick={onOpen}>
      <td onClick={e => e.stopPropagation()}>
        <Toggle checked={rule.enabled} onChange={onToggle}
          disabled={!canEdit}
          title={permissionTitle(canEdit, rule.enabled ? 'Disable rule' : 'Enable rule', 'edit rules')}/>
      </td>
      <td>
        <div style={{ fontWeight: 500, color: 'var(--ink-900)' }}>{rule.name}</div>
        {rule.description && <div style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{rule.description}</div>}
      </td>
      <td><span className="pill" data-tone={cat?.tone || 'ghost'}>{cat?.label || rule.category}</span></td>
      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{trig?.label || rule.trigger}</span></td>
      <td><span className="tnum" style={{ color: 'var(--ink-500)' }}>{condCount} {condCount === 1 ? 'cond' : 'conds'}</span></td>
      <td><span className="tnum" style={{ color: 'var(--ink-500)' }}>{rule.actions.length} {rule.actions.length === 1 ? 'action' : 'actions'}</span></td>
      <td><RuleActivity stats={rule.stats}/></td>
      <td><span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>v{rule.version}</span></td>
      <td><span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>{relativeTime(rule.updatedAt)}</span></td>
      <td onClick={e => e.stopPropagation()}>
        <Menu items={[
          { label: 'Open', onClick: onOpen },
          { label: 'Duplicate', onClick: onDuplicate, disabled: !canEdit, title: permissionTitle(canEdit, 'Duplicate rule', 'edit rules') },
          { label: 'Delete', onClick: onDelete, danger: true, disabled: !canEdit, title: permissionTitle(canEdit, 'Delete rule', 'edit rules') },
        ]}/>
      </td>
    </tr>
  );
};

const RulesEmpty = ({ hasAny, onNew, canEdit }) => (
  <div className="empty" style={{ padding: '60px 24px' }}>
    <div className="empty-icon"><IconRules size={18}/></div>
    <div className="empty-title">{hasAny ? 'No rules match your filters' : 'No rules yet'}</div>
    <div className="empty-sub">
      {hasAny
        ? 'Try clearing search or status filters.'
        : 'Rules govern how orders, specimens, results, and messages flow through the system. Compose them from atomic primitives — start with one.'}
    </div>
    {!hasAny && (
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn" data-variant="primary" data-size="sm" onClick={onNew}
          disabled={!canEdit}
          title={permissionTitle(canEdit, 'Create first rule', 'edit rules')}>
          <IconPlus size={13}/> Create first rule
        </button>
        <button className="btn" data-size="sm">
          <IconBook size={13}/> Browse templates
        </button>
      </div>
    )}
  </div>
);

const countConditions = (node) => {
  if (!node) return 0;
  if (node.kind === 'cond') return 1;
  if (node.children) return node.children.reduce((a, c) => a + countConditions(c), 0);
  return 0;
};

const RuleActivity = ({ stats }) => {
  const s = stats || { runs: 0, matches: 0, lastRun: null };
  if (!s.runs) {
    return <span style={{ fontSize: 11, color: 'var(--ink-300)' }}>not yet evaluated</span>;
  }
  const matchRate = s.runs > 0 ? Math.round((s.matches / s.runs) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
      <span className="mono tnum" style={{ color: 'var(--ink-700)' }}>
        {s.matches}/{s.runs}
      </span>
      <span style={{ color: 'var(--ink-400)' }}>
        {matchRate}%
      </span>
      <span style={{ color: 'var(--ink-300)' }}>·</span>
      <span style={{ color: 'var(--ink-400)' }}>
        {relativeTime(s.lastMatched || s.lastRun)}
      </span>
    </div>
  );
};

const relativeTime = (ts) => {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
};

// =====================================================================
// Small UI atoms
// =====================================================================
const Toggle = ({ checked, onChange, size = 'sm', disabled = false, title }) => {
  const w = size === 'sm' ? 26 : 32, h = size === 'sm' ? 14 : 18;
  return (
    <button onClick={() => { if (!disabled) onChange(!checked); }}
      disabled={disabled}
      title={title}
      style={{
        width: w, height: h, padding: 0,
        border: '1px solid ' + (checked ? 'var(--sage-700)' : 'var(--line-strong)'),
        background: checked ? 'var(--sage-700)' : 'var(--ivory-100)',
        borderRadius: 999, position: 'relative',
        transition: 'background 100ms linear, border-color 100ms linear',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}>
      <span style={{
        position: 'absolute', top: 1, left: checked ? (w - h + 1) : 1,
        width: h - 4, height: h - 4,
        background: '#fff', borderRadius: 999,
        transition: 'left 120ms ease-out',
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }}/>
    </button>
  );
};

const SegSelect = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 5, padding: 2, background: '#fff', height: 28 }}>
    {options.map(o => (
      <button key={o.id} onClick={() => onChange(o.id)}
        style={{
          padding: '0 10px', height: 22,
          border: 'none', borderRadius: 3,
          background: value === o.id ? 'var(--ivory-200)' : 'transparent',
          color: value === o.id ? 'var(--ink-900)' : 'var(--ink-500)',
          fontSize: 11.5, fontWeight: value === o.id ? 500 : 400,
          cursor: 'pointer',
        }}>{o.label}</button>
    ))}
  </div>
);

const Select = ({ value, onChange, options, placeholder, size = 'sm', style = {} }) => {
  const [open, setOpen] = useStateRE(false);
  const ref = useRefRE(null);
  const sel = options.find(o => o.id === value);
  useEffectRE(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative', ...style }}>
      <button onClick={() => setOpen(!open)} className="btn" data-size={size}
        style={{ justifyContent: 'space-between', minWidth: 140, gap: 8, paddingRight: 8 }}>
        <span style={{ flex: 1, textAlign: 'left', color: sel ? 'var(--ink-900)' : 'var(--ink-300)' }}>
          {sel ? sel.label : (placeholder || 'Select…')}
        </span>
        <IconChevDown size={11} style={{ color: 'var(--ink-400)' }}/>
      </button>
      {open && (
        <div className="slide-up" style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#fff', border: '1px solid var(--line)',
          borderRadius: 6, padding: 4,
          minWidth: '100%',
          boxShadow: 'var(--shadow-pop)', zIndex: 50,
          maxHeight: 320, overflowY: 'auto',
        }}>
          {options.map(o => (
            <button key={o.id} onClick={() => { onChange(o.id); setOpen(false); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', border: 'none',
                background: o.id === value ? 'var(--ivory-100)' : 'transparent',
                color: 'var(--ink-900)',
                borderRadius: 4, cursor: 'pointer', textAlign: 'left',
                fontSize: 12.5, whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
              onMouseLeave={e => e.currentTarget.style.background = o.id === value ? 'var(--ivory-100)' : 'transparent'}>
              {o.id === value && <IconCheck size={12} style={{ color: 'var(--sage-700)' }}/>}
              <span style={{ marginLeft: o.id === value ? 0 : 20 }}>{o.label}</span>
              {o.desc && <span style={{ marginLeft: 'auto', color: 'var(--ink-300)', fontSize: 11 }}>{o.desc}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const Menu = ({ items }) => {
  const [open, setOpen] = useStateRE(false);
  const ref = useRefRE(null);
  useEffectRE(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} className="btn" data-variant="ghost" data-size="xs"
        style={{ width: 24, height: 22, padding: 0, justifyContent: 'center' }}>
        <IconMore size={13}/>
      </button>
      {open && (
        <div className="slide-up" style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#fff', border: '1px solid var(--line)',
          borderRadius: 6, padding: 4, minWidth: 140,
          boxShadow: 'var(--shadow-pop)', zIndex: 50,
        }}>
          {items.map((it, i) => (
            <button key={i} onClick={() => { if (it.disabled) return; setOpen(false); it.onClick(); }}
              disabled={it.disabled}
              title={it.title}
              style={{
                width: '100%', display: 'block', textAlign: 'left',
                padding: '6px 10px', border: 'none', background: 'transparent',
                color: it.danger ? 'var(--err-700)' : 'var(--ink-900)',
                borderRadius: 4, cursor: it.disabled ? 'not-allowed' : 'pointer', fontSize: 12.5,
                opacity: it.disabled ? 0.5 : 1,
              }}
              onMouseEnter={e => e.currentTarget.style.background = it.danger ? '#F5E5DD' : 'var(--ivory-100)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

Object.assign(window, {
  RulesEnginePage, createBlankRule, RULE_CATEGORIES,
  Toggle, Select, SegSelect, Menu, newCondId,
});
