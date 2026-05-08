// store.js — Reactive React hooks over the persistence adapter
//
// useEntities(collection, filter?)    array, re-renders on writes to the collection
// useEntity(collection, id)           single record (or null), re-renders on writes
// useStoreCount(collection, filter?)  number, re-renders on writes
//
// Filters are evaluated client-side. Re-runs when the collection changes; filter
// identity is captured in a ref so callers can pass inline arrows without thrashing.

const { useState: useStateST, useEffect: useEffectST, useRef: useRefST } = React;

const useEntities = (collection, filter) => {
  const [items, setItems] = useStateST([]);
  const filterRef = useRefST(filter);
  filterRef.current = filter;

  useEffectST(() => {
    let cancelled = false;
    const reload = async () => {
      try {
        const data = await window.db.list(collection, filterRef.current);
        if (!cancelled) setItems(data);
      } catch (e) {
        console.error('[store] useEntities reload failed', collection, e);
      }
    };
    reload();
    const unsub = window.db.subscribe(collection, reload);
    return () => { cancelled = true; unsub(); };
  }, [collection]);

  return items;
};

const useEntity = (collection, id) => {
  const [item, setItem] = useStateST(null);

  useEffectST(() => {
    let cancelled = false;
    if (!id) { setItem(null); return; }
    const reload = async () => {
      try {
        const data = await window.db.get(collection, id);
        if (!cancelled) setItem(data || null);
      } catch (e) {
        console.error('[store] useEntity reload failed', collection, id, e);
      }
    };
    reload();
    const unsub = window.db.subscribe(collection, reload);
    return () => { cancelled = true; unsub(); };
  }, [collection, id]);

  return item;
};

const useStoreCount = (collection, filter) => {
  const items = useEntities(collection, filter);
  return items.length;
};

window.useEntities = useEntities;
window.useEntity = useEntity;
window.useStoreCount = useStoreCount;
