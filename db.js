// db.js — Lattice LIS persistence adapter
//
// Browser today (IndexedDB). Electron tomorrow (better-sqlite3 in main process via IPC).
// Call sites only touch this surface — keep it small and stable so the swap is a one-file change.
//
//   await db.put(collection, record)        upsert by id
//   await db.get(collection, id)            single record or undefined
//   await db.list(collection, filter?)      array, optional (rec) => bool
//   await db.delete(collection, id)
//   await db.clear(collection)              wipe one collection
//   await db.dropAll()                      wipe everything (used by Admin → Reset)
//   db.subscribe(collection|'*', fn)        post-write notifier; returns unsubscribe
//
// Records must carry an `id`. Cross-tab updates are not propagated (single-tab assumption);
// can be lifted later via BroadcastChannel without changing the adapter contract.

const DB_NAME = 'lattice-lis';
// Bumped to 6 to add the 'notifications' collection (history of toasts).
const DB_VERSION = 8;
const COLLECTIONS = [
  'patients', 'orders', 'specimens', 'tests', 'results',
  'rules', 'instruments', 'interfaces', 'worklists', 'audit_events',
  'users', 'clients', 'mappers',
  'qc_levels', 'qc_results', 'qc_violations',
  'notifications',
  // lab_config is a singleton (one row keyed by id='lab_config') holding
  // installation-level configuration like Westgard rule selection.
  'lab_config',
  // Locations: facilities / departments / draw stations the lab serves.
  // An order's facility field can pin to a location row by id.
  'locations',
  // Label templates: per-specimen-type ZPL templates with field maps.
  // Drives label generation in `labels.build`.
  'label_templates',
];

let __dbPromise = null;
const __subs = new Map(); // collection name OR '*'  →  Set<fn>

const __notify = (collection) => {
  const fire = (set) => set && set.forEach(fn => {
    try { fn(collection); } catch (e) { console.error('[db] subscriber threw', e); }
  });
  fire(__subs.get(collection));
  fire(__subs.get('*'));
};

const __open = () => {
  if (__dbPromise) return __dbPromise;
  __dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const idb = e.target.result;
      for (const name of COLLECTIONS) {
        if (!idb.objectStoreNames.contains(name)) {
          idb.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return __dbPromise;
};

const __wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const __store = async (collection, mode = 'readonly') => {
  const idb = await __open();
  if (!COLLECTIONS.includes(collection)) {
    throw new Error('[db] unknown collection: ' + collection);
  }
  return idb.transaction(collection, mode).objectStore(collection);
};

const SNAPSHOT_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxRecords: 15000,
  maxRecordBytes: 240 * 1024,
  maxIdLength: 180,
  maxKeysPerRecord: 140,
  maxArrayLength: 2500,
  maxStringLength: 120000,
  maxDepth: 12,
};

const __plainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

const __jsonBytes = (value) => {
  const text = JSON.stringify(value);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
};

const __scanValue = (value, path, errors, depth = 0) => {
  if (depth > SNAPSHOT_LIMITS.maxDepth) {
    errors.push(path + ' exceeds max nesting depth');
    return;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    errors.push(path + ' contains a non-data value');
    return;
  }
  if (typeof value === 'string' && value.length > SNAPSHOT_LIMITS.maxStringLength) {
    errors.push(path + ' string is too large');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > SNAPSHOT_LIMITS.maxArrayLength) errors.push(path + ' array is too large');
    value.slice(0, SNAPSHOT_LIMITS.maxArrayLength + 1).forEach((item, i) => __scanValue(item, path + '[' + i + ']', errors, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    if (!__plainObject(value)) {
      errors.push(path + ' contains a non-plain object');
      return;
    }
    const keys = Object.keys(value);
    if (keys.length > SNAPSHOT_LIMITS.maxKeysPerRecord) errors.push(path + ' has too many fields');
    keys.forEach(k => __scanValue(value[k], path + '.' + k, errors, depth + 1));
  }
};

const __validateSnapshot = (snapshot) => {
  const errors = [];
  const warnings = [];
  let totalRecords = 0;
  let totalBytes = 0;
  if (!__plainObject(snapshot)) {
    return { ok: false, errors: ['snapshot must be a plain object'], warnings, totalRecords, totalBytes };
  }
  if (!__plainObject(snapshot.collections)) {
    return { ok: false, errors: ['snapshot.collections must be an object'], warnings, totalRecords, totalBytes };
  }
  try {
    totalBytes = __jsonBytes(snapshot);
    if (totalBytes > SNAPSHOT_LIMITS.maxBytes) {
      errors.push('snapshot is too large (' + totalBytes + ' bytes)');
    }
  } catch (e) {
    errors.push('snapshot must be valid JSON data: ' + e.message);
  }
  for (const [name, records] of Object.entries(snapshot.collections)) {
    if (!COLLECTIONS.includes(name)) {
      warnings.push('unknown collection "' + name + '" will be skipped');
      continue;
    }
    if (!Array.isArray(records)) {
      errors.push(name + ' must be an array');
      continue;
    }
    totalRecords += records.length;
    const ids = new Set();
    records.forEach((rec, i) => {
      const path = name + '[' + i + ']';
      if (!__plainObject(rec)) {
        errors.push(path + ' must be a plain object');
        return;
      }
      if (typeof rec.id !== 'string' || rec.id.trim() === '') {
        errors.push(path + '.id must be a non-empty string');
      } else {
        if (rec.id.length > SNAPSHOT_LIMITS.maxIdLength) errors.push(path + '.id is too long');
        if (ids.has(rec.id)) errors.push(name + ' contains duplicate id ' + rec.id);
        ids.add(rec.id);
      }
      try {
        const recordBytes = __jsonBytes(rec);
        if (recordBytes > SNAPSHOT_LIMITS.maxRecordBytes) errors.push(path + ' is too large');
      } catch (e) {
        errors.push(path + ' cannot be serialized');
      }
      __scanValue(rec, path, errors);
    });
  }
  if (totalRecords > SNAPSHOT_LIMITS.maxRecords) {
    errors.push('snapshot has too many records (' + totalRecords + ')');
  }
  return { ok: errors.length === 0, errors, warnings, totalRecords, totalBytes };
};

const db = {
  COLLECTIONS,
  validateSnapshot: __validateSnapshot,

  put: async (collection, record) => {
    if (!record || !record.id) throw new Error('[db] record must have an id');
    record.updatedAt = Date.now();
    const store = await __store(collection, 'readwrite');
    await __wrap(store.put(record));
    __notify(collection);
    return record;
  },

  get: async (collection, id) => {
    if (!id) return undefined;
    const store = await __store(collection);
    return __wrap(store.get(id));
  },

  list: async (collection, filter) => {
    const store = await __store(collection);
    const all = await __wrap(store.getAll());
    return filter ? all.filter(filter) : all;
  },

  delete: async (collection, id) => {
    const store = await __store(collection, 'readwrite');
    await __wrap(store.delete(id));
    __notify(collection);
  },

  clear: async (collection) => {
    const store = await __store(collection, 'readwrite');
    await __wrap(store.clear());
    __notify(collection);
  },

  dropAll: async () => {
    for (const c of COLLECTIONS) {
      const store = await __store(c, 'readwrite');
      await __wrap(store.clear());
      __notify(c);
    }
  },

  // Whole-database export/import. Mirrors of the schema for backup,
  // audit reports, and migration. The shape is { version, exportedAt, collections: { name: [records] } }.
  // Importers MUST honor `version` — older snapshots may be missing collections;
  // newer snapshots may have collections this version doesn't know about.
  exportAll: async () => {
    const idb = await __open();
    const collections = {};
    for (const name of COLLECTIONS) {
      const tx = idb.transaction(name, 'readonly');
      collections[name] = await __wrap(tx.objectStore(name).getAll());
    }
    return {
      version: DB_VERSION,
      exportedAt: Date.now(),
      collections,
    };
  },

  // Compute a diff summary BEFORE importing. Lets the Admin UI show the user
  // exactly what's about to change so the wipe-and-restore isn't a black box.
  // Counts are sufficient for the v1 confirm dialog; per-record drill-down is
  // a future iteration.
  //
  //   db.diffSnapshot(snap)
  //     → {
  //         versionMatch: bool,
  //         currentVersion, snapshotVersion,
  //         collections: {
  //           [name]: { currentCount, incomingCount, added, removed, modified, unchanged }
  //         },
  //         unknownInSnapshot: [name, ...],   // collections in snap that this version doesn't have
  //         missingFromSnapshot: [name, ...], // collections current has but snap doesn't (will be wiped)
  //       }
  //
  // `modified` counts records present in both with different `updatedAt`.
  diffSnapshot: async (snapshot) => {
    const validation = __validateSnapshot(snapshot);
    if (!validation.ok) throw new Error('[db] invalid snapshot: ' + validation.errors.slice(0, 4).join('; '));
    const result = {
      versionMatch: snapshot.version === DB_VERSION,
      currentVersion: DB_VERSION,
      snapshotVersion: snapshot.version,
      collections: {},
      unknownInSnapshot: [],
      missingFromSnapshot: [],
      validation,
    };
    const snapNames = Object.keys(snapshot.collections);
    for (const name of snapNames) {
      if (!COLLECTIONS.includes(name)) {
        result.unknownInSnapshot.push(name);
        continue;
      }
    }
    for (const name of COLLECTIONS) {
      const incoming = snapshot.collections[name];
      const current = await db.list(name);
      if (!incoming) {
        result.missingFromSnapshot.push(name);
        result.collections[name] = {
          currentCount: current.length,
          incomingCount: 0,
          added: 0,
          removed: current.length,  // wipe
          modified: 0,
          unchanged: 0,
        };
        continue;
      }
      const currentById = new Map(current.map(r => [r.id, r]));
      const incomingById = new Map(incoming.map(r => [r && r.id, r]));
      let added = 0, removed = 0, modified = 0, unchanged = 0;
      for (const [id, rec] of incomingById) {
        if (!id) continue;
        const cur = currentById.get(id);
        if (!cur) { added++; continue; }
        if ((cur.updatedAt || 0) !== (rec.updatedAt || 0)) modified++;
        else unchanged++;
      }
      for (const [id] of currentById) {
        if (!incomingById.has(id)) removed++;
      }
      result.collections[name] = {
        currentCount: current.length,
        incomingCount: incoming.length,
        added, removed, modified, unchanged,
      };
    }
    return result;
  },

  // Replaces the database with the given snapshot. Drops everything first so
  // the result is a clean restore — caller must confirm BEFORE calling. Unknown
  // collections in the snapshot are skipped with a console warning.
  importAll: async (snapshot, opts = {}) => {
    const validation = __validateSnapshot(snapshot);
    if (!validation.ok) throw new Error('[db] invalid snapshot: ' + validation.errors.slice(0, 4).join('; '));
    if (!opts.allowVersionSkew && snapshot.version !== DB_VERSION) {
      throw new Error('[db] snapshot version ' + snapshot.version + ' does not match current ' + DB_VERSION + ' — pass allowVersionSkew:true to override');
    }
    await db.dropAll();
    let restored = 0, skipped = 0;
    for (const [name, records] of Object.entries(snapshot.collections)) {
      if (!COLLECTIONS.includes(name)) {
        console.warn('[db] importAll: unknown collection', name, 'skipped');
        skipped++;
        continue;
      }
      const store = await __store(name, 'readwrite');
      for (const rec of records) {
        if (!rec || !rec.id) continue;
        await __wrap(store.put(rec));
        restored++;
      }
      __notify(name);
    }
    return { restored, skipped };
  },

  subscribe: (collection, fn) => {
    if (!__subs.has(collection)) __subs.set(collection, new Set());
    __subs.get(collection).add(fn);
    return () => { __subs.get(collection) && __subs.get(collection).delete(fn); };
  },
};

window.db = db;
