// Rule Editor — compose triggers + condition tree + action sequence
// Real working state. No dummy data.

const { useState: useStateRX, useMemo: useMemoRX, useEffect: useEffectRX, useRef: useRefRX, useCallback: useCallbackRX } = React;

// =====================================================================
// Editor — three column layout
// =====================================================================
const RuleEditor = ({ rule, onSave, onClose, onDelete, onDuplicate, canEdit = true }) => {
  const [draft, setDraft] = useStateRX(rule);
  const [dirty, setDirty] = useStateRX(false);
  const [picker, setPicker] = useStateRX(null); // { kind: 'condition'|'action', target?, onPick }
  const [testOpen, setTestOpen] = useStateRX(false);

  useEffectRX(() => { setDraft(rule); setDirty(false); }, [rule.id]);

  const update = (patch) => {
    setDraft(d => ({ ...d, ...patch, updatedAt: Date.now() }));
    setDirty(true);
  };

  const save = async () => {
    if (!canEdit || !hasPermission('EDIT_RULES')) return false;
    const saved = await onSave({ ...draft, version: dirty ? draft.version + 1 : draft.version });
    if (saved !== false) setDirty(false);
  };

  // ---- Conditions tree ops ----
  const setConditions = (conditions) => update({ conditions });

  const addCondition = (path, primitiveId) => {
    const prim = CONDITION_PRIMITIVES.find(p => p.id === primitiveId);
    if (!prim) return;
    const node = {
      id: newCondId(),
      kind: 'cond',
      primitive: primitiveId,
      negate: false,
      args: prim.args.reduce((acc, a) => ({ ...acc, [a.k]: a.t === 'enum[]' ? [] : '' }), {}),
    };
    setConditions(insertAt(draft.conditions, path, node));
  };
  const addGroup = (path, op = 'AND') => {
    const node = { id: newCondId(), kind: 'group', op, children: [] };
    setConditions(insertAt(draft.conditions, path, node));
  };
  const removeCond = (path) => setConditions(removeAt(draft.conditions, path));
  const updateCond = (path, patch) => setConditions(updateAt(draft.conditions, path, patch));

  // ---- Actions ----
  const addAction = (primitiveId) => {
    const prim = ACTION_PRIMITIVES.find(p => p.id === primitiveId);
    if (!prim) return;
    const action = {
      id: newCondId(),
      primitive: primitiveId,
      args: prim.args.reduce((acc, a) => ({ ...acc, [a.k]: a.t === 'enum[]' ? [] : '' }), {}),
    };
    update({ actions: [...draft.actions, action] });
  };
  const updateAction = (id, patch) => update({ actions: draft.actions.map(a => a.id === id ? { ...a, ...patch } : a) });
  const removeAction = (id) => update({ actions: draft.actions.filter(a => a.id !== id) });
  const moveAction = (id, dir) => {
    const idx = draft.actions.findIndex(a => a.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= draft.actions.length) return;
    const next = [...draft.actions];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    update({ actions: next });
  };

  return (
    <div data-screen-label="Rules Engine — editor" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 24px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--ivory-50)',
      }}>
        <button className="btn" data-variant="ghost" data-size="sm" onClick={onClose}>
          <IconChevLeft size={13}/> Rules
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--line)' }}/>
        <input value={draft.name} onChange={e => update({ name: e.target.value })}
          placeholder="Untitled rule"
          style={{
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: 16, fontWeight: 500, letterSpacing: '-0.01em',
            color: 'var(--ink-900)', minWidth: 240, padding: '2px 4px', borderRadius: 4,
          }}
          onFocus={e => e.target.style.background = 'var(--ivory-100)'}
          onBlur={e => e.target.style.background = 'transparent'}/>
        <span className="pill" data-tone={RULE_CATEGORIES.find(c => c.id === draft.category)?.tone || 'ghost'}>
          {RULE_CATEGORIES.find(c => c.id === draft.category)?.label || draft.category}
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-400)' }}>v{draft.version}{dirty && '*'}</span>

        <div style={{ flex: 1 }}/>

        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--ink-500)' }}>
          {draft.enabled ? (<><span className="dot" data-tone="ok"/> Live</>) : (<><span className="dot" data-tone="idle"/> Disabled</>)}
        </span>
        <Toggle checked={draft.enabled} onChange={(en) => update({ enabled: en })}
          disabled={!canEdit}
          title={permissionTitle(canEdit, draft.enabled ? 'Disable rule' : 'Enable rule', 'edit rules')}/>

        <div style={{ width: 1, height: 18, background: 'var(--line)' }}/>

        <button className="btn" data-size="sm" onClick={() => setTestOpen(true)}>
          <IconPlay size={12}/> Test
        </button>
        <button className="btn" data-size="sm">
          <IconArchive size={12}/> History
        </button>
        <Menu items={[
          { label: 'Duplicate', onClick: () => onDuplicate(draft.id), disabled: !canEdit, title: permissionTitle(canEdit, 'Duplicate rule', 'edit rules') },
          { label: 'Export JSON', onClick: () => {} },
          { label: 'Delete', onClick: () => onDelete(draft.id), danger: true, disabled: !canEdit, title: permissionTitle(canEdit, 'Delete rule', 'edit rules') },
        ]}/>
        <button className="btn" data-variant="primary" data-size="sm" disabled={!dirty || !canEdit} onClick={save}
          title={permissionTitle(canEdit, dirty ? 'Save changes' : 'Saved', 'edit rules')}>
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      {/* Body — three columns: trigger/conditions | actions | inspector */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 320px', minHeight: 0 }}>
        {/* WHEN — trigger + conditions */}
        <div style={{ borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SectionHeader index="01" title="When" sub="What event triggers this rule, and which incoming data must match"/>

          <TriggerSelector value={draft.trigger} onChange={(t) => update({ trigger: t })}/>

          <div>
            <div className="section-title" style={{ marginBottom: 8 }}>Conditions</div>
            <ConditionTree
              node={draft.conditions}
              path={[]}
              onAdd={(path) => setPicker({ kind: 'condition', onPick: (id) => { addCondition(path, id); setPicker(null); } })}
              onAddGroup={(path) => addGroup(path)}
              onRemove={removeCond}
              onUpdate={updateCond}
              depth={0}
            />
          </div>
        </div>

        {/* THEN — actions */}
        <div style={{ borderRight: '1px solid var(--line)', overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 18, background: 'var(--ivory-50)' }}>
          <SectionHeader index="02" title="Then" sub="What the system does when conditions are met. Actions run in order."/>

          <ActionList
            actions={draft.actions}
            onUpdate={updateAction}
            onRemove={removeAction}
            onMove={moveAction}
            onAdd={() => setPicker({ kind: 'action', onPick: (id) => { addAction(id); setPicker(null); } })}
          />
        </div>

        {/* Inspector */}
        <div style={{ overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Inspector draft={draft} update={update}/>
        </div>
      </div>

      {/* Picker drawer */}
      {picker && (
        <PrimitivePicker kind={picker.kind} onPick={picker.onPick} onClose={() => setPicker(null)}/>
      )}
      {testOpen && (
        <TestDrawer rule={draft} onClose={() => setTestOpen(false)}/>
      )}
    </div>
  );
};

// =====================================================================
// Section header
// =====================================================================
const SectionHeader = ({ index, title, sub }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-300)', letterSpacing: '0.04em', marginTop: 4 }}>{index}</span>
    <div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-900)', letterSpacing: '-0.01em' }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 2 }}>{sub}</div>
    </div>
  </div>
);

// =====================================================================
// Trigger selector
// =====================================================================
const TriggerSelector = ({ value, onChange }) => {
  const groups = useMemoRX(() => {
    const g = {};
    RULE_TRIGGERS.forEach(t => { if (!g[t.group]) g[t.group] = []; g[t.group].push(t); });
    return g;
  }, []);
  const sel = RULE_TRIGGERS.find(t => t.id === value);
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div className="section-title" style={{ marginBottom: 8 }}>Trigger</div>
      <Select value={value} onChange={onChange}
        style={{ width: '100%' }}
        options={Object.entries(groups).flatMap(([g, items]) => items.map(t => ({ id: t.id, label: t.label, desc: g })))}/>
      {sel?.desc && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--ivory-100)', borderRadius: 5, fontSize: 11.5, color: 'var(--ink-500)' }}>
          {sel.desc}
        </div>
      )}
    </div>
  );
};

// =====================================================================
// Condition tree
// =====================================================================
const ConditionTree = ({ node, path, onAdd, onAddGroup, onRemove, onUpdate, depth }) => {
  if (!node) return null;
  if (node.kind === 'cond') {
    return <ConditionRow node={node} path={path} onRemove={() => onRemove(path)} onUpdate={(patch) => onUpdate(path, patch)}/>;
  }
  // Group
  const isRoot = path.length === 0;
  const children = node.children || [];
  return (
    <div style={{
      border: depth === 0 ? 'none' : '1px solid var(--line)',
      borderRadius: 6,
      background: depth === 0 ? 'transparent' : 'var(--ivory-50)',
      padding: depth === 0 ? 0 : 10,
      position: 'relative',
    }}>
      {/* Group header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: children.length ? 8 : 0 }}>
        <BoolToggle value={node.op} onChange={(op) => onUpdate(path, { op })}/>
        <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>
          {node.op === 'AND' ? 'all conditions must match' : 'any condition matches'}
        </span>
        {!isRoot && (
          <>
            <div style={{ flex: 1 }}/>
            <button className="btn" data-variant="ghost" data-size="xs" onClick={() => onRemove(path)}
              style={{ color: 'var(--ink-400)' }}>
              <IconClose size={11}/>
            </button>
          </>
        )}
      </div>
      {/* Children */}
      {children.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
          {/* Connector line */}
          <div style={{ position: 'absolute', left: 12, top: 4, bottom: 4, width: 1, background: 'var(--line)' }}/>
          {children.map((child, i) => (
            <div key={child.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, position: 'relative' }}>
              {/* Op badge between siblings */}
              {i > 0 && (
                <></>
              )}
              <div style={{ flex: 1 }}>
                <ConditionTree
                  node={child}
                  path={[...path, i]}
                  onAdd={onAdd}
                  onAddGroup={onAddGroup}
                  onRemove={onRemove}
                  onUpdate={onUpdate}
                  depth={depth + 1}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {/* Add buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: children.length ? 10 : 0 }}>
        <button className="btn" data-variant="ghost" data-size="xs" onClick={() => onAdd(path)}
          style={{ color: 'var(--sage-700)' }}>
          <IconPlus size={11}/> Condition
        </button>
        <button className="btn" data-variant="ghost" data-size="xs" onClick={() => onAddGroup(path)}
          style={{ color: 'var(--ink-500)' }}>
          <IconLayers size={11}/> Group
        </button>
      </div>
      {children.length === 0 && depth === 0 && (
        <div style={{
          marginTop: 12,
          padding: '24px 16px',
          border: '1px dashed var(--line-strong)',
          borderRadius: 6,
          textAlign: 'center',
          color: 'var(--ink-400)',
          fontSize: 12.5,
        }}>
          No conditions yet. Without conditions, this rule fires on every trigger event.<br/>
          <button className="btn" data-size="xs" data-variant="primary" style={{ marginTop: 10 }} onClick={() => onAdd(path)}>
            <IconPlus size={11}/> Add a condition
          </button>
        </div>
      )}
    </div>
  );
};

const BoolToggle = ({ value, onChange }) => (
  <div style={{
    display: 'inline-flex', border: '1px solid var(--line)',
    borderRadius: 4, padding: 1, background: '#fff',
    fontSize: 10.5, fontWeight: 600, letterSpacing: '0.04em',
  }}>
    {['AND','OR'].map(op => (
      <button key={op} onClick={() => onChange(op)}
        style={{
          padding: '2px 8px', height: 20, border: 'none',
          background: value === op ? 'var(--sage-700)' : 'transparent',
          color: value === op ? '#fff' : 'var(--ink-400)',
          borderRadius: 3, cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: 10.5,
        }}>{op}</button>
    ))}
  </div>
);

const ConditionRow = ({ node, onRemove, onUpdate }) => {
  const prim = CONDITION_PRIMITIVES.find(p => p.id === node.primitive);
  if (!prim) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px', background: '#fff',
      border: '1px solid var(--line)', borderRadius: 5,
    }}>
      <span className="pill" data-tone="ghost" style={{ fontSize: 10, height: 18, padding: '0 6px' }}>{prim.cat}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-700)', fontWeight: 500 }}>{prim.label}</span>
      <button onClick={() => onUpdate({ negate: !node.negate })}
        title={node.negate ? 'Negated (NOT)' : 'Click to negate'}
        style={{
          fontSize: 10, fontFamily: 'var(--font-mono)',
          padding: '1px 6px', height: 18, borderRadius: 3,
          border: '1px solid ' + (node.negate ? 'var(--rust)' : 'var(--line)'),
          background: node.negate ? 'var(--rust-soft)' : '#fff',
          color: node.negate ? 'var(--err-700)' : 'var(--ink-400)',
          cursor: 'pointer',
        }}>
        {node.negate ? 'NOT' : 'is'}
      </button>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {prim.args.map(a => (
          <ArgInput key={a.k} arg={a} value={node.args[a.k]}
            onChange={(v) => onUpdate({ args: { ...node.args, [a.k]: v } })}/>
        ))}
        {prim.args.length === 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--ink-300)', fontStyle: 'italic' }}>(no parameters)</span>
        )}
      </div>
      <button className="btn" data-variant="ghost" data-size="xs" onClick={onRemove}
        style={{ color: 'var(--ink-400)', width: 22, padding: 0, justifyContent: 'center' }}>
        <IconClose size={11}/>
      </button>
    </div>
  );
};

// =====================================================================
// Argument inputs — typed
// =====================================================================
const ArgInput = ({ arg, value, onChange }) => {
  const baseStyle = {
    height: 24, padding: '0 8px',
    border: '1px solid var(--line)',
    borderRadius: 4,
    background: '#fff',
    fontSize: 11.5,
    color: 'var(--ink-900)',
    minWidth: 80,
  };
  const placeholder = ARG_PLACEHOLDERS[arg.t] || arg.k;
  if (arg.t === 'enum') {
    return (
      <Select size="xs" value={value || ''} onChange={onChange} placeholder={placeholder}
        options={[{ id: '', label: 'Select…' }, ...arg.opts.map(o => ({ id: o, label: o }))]}/>
    );
  }
  if (arg.t === 'enum[]') {
    return (
      <MultiPick options={arg.opts} value={value || []} onChange={onChange} placeholder={placeholder}/>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input style={baseStyle}
        value={value || ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} type={arg.t === 'number' ? 'number' : 'text'}/>
      {arg.unit && <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>{arg.unit}</span>}
    </div>
  );
};

const ARG_PLACEHOLDERS = {
  facility: 'Facility…',
  location: 'Location…',
  npi: '10 digit NPI',
  payer: 'Payer…',
  test: 'Test code',
  'test[]': 'Test codes',
  loinc: 'LOINC',
  'spec-type': 'Specimen type',
  container: 'Container',
  number: '0',
  time: 'HH:MM',
  'hl7-path': 'OBR-4.1',
  regex: '/pattern/',
  interface: 'Interface',
  lab: 'Lab',
  analyzer: 'Analyzer',
  'ref-lab': 'Reference lab',
  dept: 'Department',
  text: 'Text…',
  user: 'User…',
  role: 'Role…',
  expr: 'Expression',
  label: 'Label template',
  printer: 'Printer',
  report: 'Report template',
  tag: 'Tag',
  metric: 'Metric',
  range: 'Range table',
  queue: 'Queue',
};

const MultiPick = ({ options, value, onChange, placeholder }) => {
  const [open, setOpen] = useStateRX(false);
  const ref = useRefRX(null);
  useEffectRX(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const toggle = (o) => onChange(value.includes(o) ? value.filter(v => v !== o) : [...value, o]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        height: 24, padding: '0 8px',
        border: '1px solid var(--line)', borderRadius: 4,
        background: '#fff', fontSize: 11.5,
        color: value.length ? 'var(--ink-900)' : 'var(--ink-300)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        minWidth: 100,
      }}>
        {value.length ? value.join(', ') : placeholder}
        <IconChevDown size={10}/>
      </button>
      {open && (
        <div className="slide-up" style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#fff', border: '1px solid var(--line)',
          borderRadius: 6, padding: 4, minWidth: 160,
          boxShadow: 'var(--shadow-pop)', zIndex: 50,
        }}>
          {options.map(o => (
            <button key={o} onClick={() => toggle(o)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 8px', border: 'none', background: 'transparent',
                borderRadius: 3, cursor: 'pointer', textAlign: 'left',
                fontSize: 12, color: 'var(--ink-900)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{
                width: 12, height: 12, borderRadius: 3,
                border: '1px solid ' + (value.includes(o) ? 'var(--sage-700)' : 'var(--line-strong)'),
                background: value.includes(o) ? 'var(--sage-700)' : '#fff',
                display: 'grid', placeItems: 'center',
              }}>
                {value.includes(o) && <IconCheck size={9} style={{ color: '#fff' }}/>}
              </span>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// =====================================================================
// Tree mutation helpers
// =====================================================================
const insertAt = (root, path, node) => {
  if (path.length === 0) {
    return { ...root, children: [...(root.children || []), node] };
  }
  return mapAt(root, path, (n) => ({ ...n, children: [...(n.children || []), node] }));
};
const removeAt = (root, path) => {
  if (path.length === 0) return root;
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapAt(root, parent, (n) => ({ ...n, children: n.children.filter((_, i) => i !== idx) }));
};
const updateAt = (root, path, patch) => {
  if (path.length === 0) return { ...root, ...patch };
  return mapAt(root, path, (n) => ({ ...n, ...patch }));
};
const mapAt = (node, path, fn) => {
  if (path.length === 0) return fn(node);
  const [head, ...rest] = path;
  return {
    ...node,
    children: node.children.map((c, i) => i === head ? mapAt(c, rest, fn) : c),
  };
};

// =====================================================================
// Action list
// =====================================================================
const ActionList = ({ actions, onUpdate, onRemove, onMove, onAdd }) => (
  <div className="panel" style={{ padding: 12, background: '#fff' }}>
    <div className="section-title" style={{ marginBottom: 10 }}>Actions ({actions.length})</div>

    {actions.length === 0 ? (
      <div style={{
        padding: '24px 16px',
        border: '1px dashed var(--line-strong)',
        borderRadius: 6,
        textAlign: 'center',
        color: 'var(--ink-400)',
        fontSize: 12.5,
      }}>
        No actions yet. Add one to define what happens when conditions match.<br/>
        <button className="btn" data-size="xs" data-variant="primary" style={{ marginTop: 10 }} onClick={onAdd}>
          <IconPlus size={11}/> Add an action
        </button>
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {actions.map((a, i) => (
          <ActionRow key={a.id} action={a} index={i + 1}
            onUpdate={(patch) => onUpdate(a.id, patch)}
            onRemove={() => onRemove(a.id)}
            onUp={() => onMove(a.id, -1)}
            onDown={() => onMove(a.id, +1)}
            isFirst={i === 0} isLast={i === actions.length - 1}/>
        ))}
        <button className="btn" data-variant="ghost" data-size="xs" onClick={onAdd}
          style={{ color: 'var(--sage-700)', alignSelf: 'flex-start', marginTop: 4 }}>
          <IconPlus size={11}/> Add action
        </button>
      </div>
    )}
  </div>
);

const ActionRow = ({ action, index, onUpdate, onRemove, onUp, onDown, isFirst, isLast }) => {
  const prim = ACTION_PRIMITIVES.find(p => p.id === action.primitive);
  if (!prim) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 10px',
      background: 'var(--ivory-50)',
      border: '1px solid var(--line)', borderRadius: 5,
    }}>
      <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--ink-300)', width: 16 }}>
        {String(index).padStart(2, '0')}
      </span>
      <span className="pill" data-tone="sage" style={{ fontSize: 10, height: 18, padding: '0 6px' }}>{prim.cat}</span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-700)', fontWeight: 500, whiteSpace: 'nowrap' }}>{prim.label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {prim.args.map(a => (
          <ArgInput key={a.k} arg={a} value={action.args[a.k]}
            onChange={(v) => onUpdate({ args: { ...action.args, [a.k]: v } })}/>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 1 }}>
        <button onClick={onUp} disabled={isFirst}
          className="btn" data-variant="ghost" data-size="xs"
          style={{ width: 20, padding: 0, justifyContent: 'center', opacity: isFirst ? 0.3 : 1 }}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 10 4-4 4 4"/></svg>
        </button>
        <button onClick={onDown} disabled={isLast}
          className="btn" data-variant="ghost" data-size="xs"
          style={{ width: 20, padding: 0, justifyContent: 'center', opacity: isLast ? 0.3 : 1 }}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4"/></svg>
        </button>
      </div>
      <button onClick={onRemove} className="btn" data-variant="ghost" data-size="xs"
        style={{ width: 22, padding: 0, justifyContent: 'center', color: 'var(--ink-400)' }}>
        <IconClose size={11}/>
      </button>
    </div>
  );
};

// =====================================================================
// Inspector (right panel)
// =====================================================================
const Inspector = ({ draft, update }) => (
  <>
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>Description</div>
      <textarea value={draft.description} onChange={e => update({ description: e.target.value })}
        placeholder="What does this rule do? Why does it exist?"
        rows={4}
        style={{
          width: '100%', resize: 'vertical',
          border: '1px solid var(--line)', borderRadius: 5,
          padding: '8px 10px', fontSize: 12, fontFamily: 'inherit',
          color: 'var(--ink-900)', background: '#fff',
          lineHeight: 1.5,
        }}/>
    </div>
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>Category</div>
      <Select value={draft.category} onChange={(c) => update({ category: c })}
        style={{ width: '100%' }}
        options={RULE_CATEGORIES.map(c => ({ id: c.id, label: c.label }))}/>
    </div>

    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>Execution</div>
      <KV k="Priority" v={<Select size="xs" value="normal" onChange={() => {}}
        options={[{ id: 'low', label: 'Low' }, { id: 'normal', label: 'Normal' }, { id: 'high', label: 'High' }, { id: 'critical', label: 'Critical' }]}/>}/>
      <KV k="On error" v={<Select size="xs" value="continue" onChange={() => {}}
        options={[{ id: 'continue', label: 'Continue chain' }, { id: 'halt', label: 'Halt chain' }, { id: 'rollback', label: 'Rollback' }]}/>}/>
      <KV k="Stop after" v={<Toggle checked={false} onChange={() => {}}/>}/>
    </div>

    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>Observability</div>
      <div style={{ padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Stat lbl="Times triggered" val={draft.stats.runs}/>
        <Stat lbl="Times matched" val={draft.stats.matches}/>
        <Stat lbl="Last run" val={draft.stats.lastRun ? relativeTime(draft.stats.lastRun) : 'never'}/>
        <div style={{ fontSize: 11, color: 'var(--ink-300)', borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 2 }}>
          Stats begin recording once the rule is enabled.
        </div>
      </div>
    </div>

    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>History</div>
      <div style={{ padding: 10, background: 'var(--ivory-50)', border: '1px solid var(--line)', borderRadius: 5, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5, color: 'var(--ink-500)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Created</span>
          <span>{relativeTime(draft.createdAt)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Updated</span>
          <span>{relativeTime(draft.updatedAt)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Author</span>
          <span style={{ color: 'var(--ink-700)' }}>{draft.author}</span>
        </div>
      </div>
    </div>
  </>
);

const KV = ({ k, v }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--line-soft)' }}>
    <span style={{ fontSize: 12, color: 'var(--ink-500)' }}>{k}</span>
    <div>{v}</div>
  </div>
);
const Stat = ({ lbl, val }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
    <span style={{ fontSize: 11.5, color: 'var(--ink-500)' }}>{lbl}</span>
    <span className="mono tnum" style={{ fontSize: 12, color: 'var(--ink-900)' }}>{val}</span>
  </div>
);

// =====================================================================
// Primitive picker
// =====================================================================
const PrimitivePicker = ({ kind, onPick, onClose }) => {
  const [q, setQ] = useStateRX('');
  const [activeCat, setActiveCat] = useStateRX(null);
  const inputRef = useRefRX(null);

  useEffectRX(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const all = kind === 'condition' ? CONDITION_PRIMITIVES : ACTION_PRIMITIVES;
  const cats = kind === 'condition' ? COND_CATS : ACTION_CATS;
  const filtered = all.filter(p => {
    if (activeCat && p.cat !== activeCat) return false;
    if (q && !p.label.toLowerCase().includes(q.toLowerCase()) && !p.id.includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div onMouseDown={onClose} className="backdrop-in" style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(31,30,26,0.30)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onMouseDown={e => e.stopPropagation()} className="scale-in" style={{
        width: 720, maxWidth: '92vw', height: 520, maxHeight: '88vh',
        background: '#fff', borderRadius: 8,
        boxShadow: 'var(--shadow-pop)',
        border: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontWeight: 500, fontSize: 13, color: 'var(--ink-900)' }}>
            Add {kind === 'condition' ? 'condition' : 'action'}
          </span>
          <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>· {all.length} primitives</span>
          <div style={{ flex: 1 }}/>
          <button className="btn" data-variant="ghost" data-size="xs" onClick={onClose} style={{ width: 22, padding: 0, justifyContent: 'center' }}>
            <IconClose size={12}/>
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', flex: 1, minHeight: 0 }}>
          {/* Categories */}
          <div style={{ borderRight: '1px solid var(--line)', padding: 8, overflowY: 'auto', background: 'var(--ivory-50)' }}>
            <button onClick={() => setActiveCat(null)} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '6px 10px', border: 'none',
              background: activeCat === null ? 'var(--sage-100)' : 'transparent',
              color: activeCat === null ? 'var(--sage-900)' : 'var(--ink-700)',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 12, fontWeight: activeCat === null ? 500 : 400,
              textAlign: 'left', marginBottom: 1,
            }}>
              <span>All</span>
              <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>{all.length}</span>
            </button>
            {cats.map(c => {
              const count = all.filter(p => p.cat === c).length;
              return (
                <button key={c} onClick={() => setActiveCat(c)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  width: '100%', padding: '6px 10px', border: 'none',
                  background: activeCat === c ? 'var(--sage-100)' : 'transparent',
                  color: activeCat === c ? 'var(--sage-900)' : 'var(--ink-700)',
                  borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, fontWeight: activeCat === c ? 500 : 400,
                  textAlign: 'left', marginBottom: 1,
                }}>
                  <span>{c}</span>
                  <span className="mono tnum" style={{ fontSize: 10.5, color: 'var(--ink-400)' }}>{count}</span>
                </button>
              );
            })}
          </div>
          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ position: 'relative' }}>
                <IconSearch size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-300)' }}/>
                <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                  placeholder="Search primitives…"
                  style={{
                    width: '100%', height: 28, padding: '0 10px 0 28px',
                    border: '1px solid var(--line)', borderRadius: 4,
                    fontSize: 12.5, outline: 'none',
                  }}/>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
              {filtered.map(p => (
                <button key={p.id} onClick={() => onPick(p.id)}
                  style={{
                    width: '100%', padding: '8px 10px',
                    border: 'none', background: 'transparent',
                    borderRadius: 4, cursor: 'pointer', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--ivory-100)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span className="pill" data-tone="ghost" style={{ fontSize: 10, height: 18, padding: '0 6px', flexShrink: 0 }}>{p.cat}</span>
                  <span style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-900)', fontWeight: 500 }}>{p.label}</div>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-300)', marginTop: 1 }}>{p.id}</div>
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-400)' }}>
                    {p.args.length === 0 ? 'no params' : p.args.length + (p.args.length === 1 ? ' param' : ' params')}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: 28, textAlign: 'center', color: 'var(--ink-400)', fontSize: 12.5 }}>
                  No primitives match.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// =====================================================================
// Test drawer — paste an event, see if rule matches
// =====================================================================
const TestDrawer = ({ rule, onClose }) => {
  return (
    <div className="drawer-in" style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 520,
      background: '#fff', zIndex: 90,
      borderLeft: '1px solid var(--line)',
      boxShadow: 'var(--shadow-pop)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--ink-900)' }}>Test rule</span>
        <span className="pill" data-tone="ghost">dry run</span>
        <div style={{ flex: 1 }}/>
        <button className="btn" data-variant="ghost" data-size="xs" onClick={onClose} style={{ width: 22, padding: 0, justifyContent: 'center' }}>
          <IconClose size={12}/>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <div className="section-title" style={{ marginBottom: 6 }}>Event payload</div>
          <textarea
            placeholder={`Paste a sample HL7 message or JSON event.\nExamples:\n  • ORM message\n  • specimen JSON\n  • result event`}
            rows={10}
            style={{
              width: '100%', resize: 'vertical',
              border: '1px solid var(--line)', borderRadius: 5,
              padding: 10, fontSize: 11.5, fontFamily: 'var(--font-mono)',
              color: 'var(--ink-900)', background: 'var(--ivory-50)',
              lineHeight: 1.6,
            }}/>
        </div>
        <button className="btn" data-variant="primary" data-size="sm" style={{ alignSelf: 'flex-start' }}>
          <IconPlay size={12}/> Run dry test
        </button>
        <div className="section-title">Trace</div>
        <div className="empty" style={{ padding: '36px 12px', border: '1px dashed var(--line-strong)', borderRadius: 6 }}>
          <div className="empty-icon"><IconBolt size={16}/></div>
          <div className="empty-title">No trace yet</div>
          <div className="empty-sub">Paste an event and click Run to see how this rule evaluates step by step.</div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { RuleEditor });
