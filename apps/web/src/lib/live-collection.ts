import { documentId, getDocsFromServer, limit, onSnapshot, orderBy, query, startAfter, Timestamp, where,
  type CollectionReference, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { localDb } from './catalog-cache';

export interface CommitCursor { seconds: number; nanoseconds: number }
interface Committed { committedAt?: CommitCursor }
interface RepositoryOptions<T> {
  key: string;
  collection: CollectionReference<DocumentData>;
  filters?: QueryConstraint[];
  load: () => Promise<T[]>;
  save: (rows: T[], replace: boolean) => Promise<void>;
  id: (row: T) => string;
  decode: (id: string, data: DocumentData) => T;
  onIdle?: () => void;
}
export interface CollectionState<T> { rows: T[]; offline: boolean; error: string | null }

function compare(a?: CommitCursor, b?: CommitCursor): number {
  return (a?.seconds ?? 0) - (b?.seconds ?? 0) || (a?.nanoseconds ?? 0) - (b?.nanoseconds ?? 0);
}

export function liveCollection<T extends Committed>(options: RepositoryOptions<T>) {
  const listeners = new Set<(state: CollectionState<T>) => void>();
  const rows = new Map<string, T>();
  const liveDuringSync = new Map<string, T>();
  let state: CollectionState<T> = { rows: [], offline: false, error: null };
  let complete = false;
  let coverageCursor: CommitCursor | undefined;
  let caughtUp = false;
  let loading: Promise<void> | null = null;
  let syncing: Promise<void> | null = null;
  let overflowCursor: CommitCursor | undefined;
  let cacheNeedsReplacement = false;
  let unsubscribe: (() => void) | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  let rowsChanged = false;
  let onlineAttached = false;
  const filters = options.filters ?? [];
  const metaKey = `sync-v2:${options.key}`;
  const publish = () => {
    if (rowsChanged) { state = { ...state, rows: [...rows.values()] }; rowsChanged = false; }
    listeners.forEach((listener) => listener(state));
  };
  const fail = (cause: unknown) => {
    const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
    state = { ...state, offline: !navigator.onLine || ['unavailable', 'deadline-exceeded'].includes(code),
      error: code === 'permission-denied' ? 'Tu acceso al catálogo cambió. Vuelve a iniciar sesión.'
        : code === 'failed-precondition' ? 'Falta publicar un índice del catálogo.' : 'No se pudo actualizar el catálogo.' };
    publish();
  };
  const apply = (updates: T[]) => {
    for (const row of updates) {
      const id = options.id(row);
      if (compare(row.committedAt, rows.get(id)?.committedAt) < 0) continue;
      rows.set(id, row);
      rowsChanged = true;
    }
  };
  const persist = (updates: T[], replace: boolean) => {
    const checkpoint = coverageCursor;
    writes = writes.then(async () => {
      await options.save(cacheNeedsReplacement ? [...rows.values()] : updates, replace || cacheNeedsReplacement);
      await localDb.catalogMeta.put({ key: metaKey, value: 1, cursor: checkpoint });
      cacheNeedsReplacement = false;
    }).catch((cause: unknown) => { cacheNeedsReplacement = true; fail(cause); });
    return writes;
  };
  const load = () => loading ??= (async () => {
    const [cached, meta] = await Promise.all([options.load(), localDb.catalogMeta.get(metaKey)]);
    apply(cached); coverageCursor = meta?.cursor; complete = meta?.value === 1;
    publish();
  })().catch((cause: unknown) => { loading = null; throw cause; });
  const watch = (sinceCursor = coverageCursor) => {
    if (unsubscribe || !listeners.size) return;
    const since = sinceCursor ? new Timestamp(sinceCursor.seconds, sinceCursor.nanoseconds) : new Timestamp(0, 0);
    let serverReady = false;
    unsubscribe = onSnapshot(query(options.collection, ...filters, where('committedAt', '>=', since), orderBy('committedAt', 'desc'), limit(300)), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
        serverReady = false; state = { ...state, offline: !navigator.onLine }; publish(); return;
      }
      const changed = serverReady ? snapshot.docChanges({ includeMetadataChanges: true })
        .filter((change) => change.type !== 'removed').map(({ doc }) => doc) : snapshot.docs;
      serverReady = true;
      const updates = changed.map((doc) => options.decode(doc.id, doc.data()));
      if (syncing || !caughtUp) updates.forEach((row) => liveDuringSync.set(options.id(row), row));
      apply(updates);
      state = { ...state, offline: false, error: null }; publish();
      const head = snapshot.docs[0] ? commitCursor(snapshot.docs[0].data()) : undefined;
      const tail = snapshot.docs.at(-1);
      if (snapshot.size === 300 && compare(tail ? commitCursor(tail.data()) : undefined, coverageCursor) > 0) {
        if (compare(head, overflowCursor) > 0) overflowCursor = head;
        caughtUp = false;
        if (!syncing) void refresh().catch(fail);
      } else if (complete && caughtUp && !syncing && updates.length) {
        if (compare(head, coverageCursor) > 0) coverageCursor = head;
        const changedIds = new Set([...liveDuringSync.keys(), ...updates.map(options.id)]);
        liveDuringSync.clear();
        void persist([...changedIds].map((id) => rows.get(id)!), false);
      }
    }, (error) => { unsubscribe?.(); unsubscribe = null; caughtUp = false; fail(error); });
  };
  const refresh = async () => {
    await load();
    if (syncing) return syncing;
    syncing = (async () => {
      do {
        const initial = !complete;
        const head = await getDocsFromServer(query(options.collection, ...filters, orderBy('committedAt', 'desc'), limit(1)));
        const fence = head.docs[0] ? commitCursor(head.docs[0].data()) : coverageCursor;
        const until = fence ? new Timestamp(fence.seconds, fence.nanoseconds) : new Timestamp(0, 0);
        // La cobertura termina en un commit observado antes de paginar, nunca en el máximo recibido en vivo.
        watch(initial ? fence : coverageCursor);
        const since = coverageCursor ? new Timestamp(coverageCursor.seconds, coverageCursor.nanoseconds) : new Timestamp(0, 0);
        const updates: T[] = [];
        let pageCursor: QueryDocumentSnapshot<DocumentData> | undefined;
        do {
          const constraints = initial ? [orderBy(documentId())]
            : [where('committedAt', '>=', since), where('committedAt', '<=', until), orderBy('committedAt'), orderBy(documentId())];
          const page = await getDocsFromServer(query(options.collection, ...filters, ...constraints,
            ...(pageCursor ? [startAfter(pageCursor)] : []), limit(300)));
          updates.push(...page.docs.map((doc) => options.decode(doc.id, doc.data())));
          pageCursor = page.size === 300 ? page.docs.at(-1) : undefined;
        } while (pageCursor);
        if (initial) { rows.clear(); rowsChanged = true; }
        const changedIds = new Set([...updates.map(options.id), ...liveDuringSync.keys()]);
        apply(updates); apply([...liveDuringSync.values()]); liveDuringSync.clear();
        complete = true;
        if (compare(fence, coverageCursor) > 0) coverageCursor = fence;
        caughtUp = compare(overflowCursor, coverageCursor) <= 0;
        state = { ...state, offline: false, error: null }; publish();
        await persist(initial ? [...rows.values()] : [...changedIds].map((id) => rows.get(id)!), initial);
      } while (compare(overflowCursor, coverageCursor) > 0);
      while (liveDuringSync.size) {
        const pending = [...liveDuringSync.keys()].map((id) => rows.get(id)!);
        liveDuringSync.clear();
        await persist(pending, false);
      }
    })().catch(fail).finally(() => { syncing = null; if (!listeners.size) scheduleStop(); });
    return syncing;
  };
  const online = () => { if (listeners.size) void refresh().catch(fail); };
  const scheduleStop = () => {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      if (listeners.size) return;
      if (syncing) { scheduleStop(); return; }
      unsubscribe?.(); unsubscribe = null; caughtUp = false;
      if (onlineAttached) window.removeEventListener('online', online);
      onlineAttached = false;
      void writes.then(() => {
        if (listeners.size || syncing) return;
        rows.clear(); liveDuringSync.clear(); loading = null; complete = false;
        coverageCursor = undefined; overflowCursor = undefined;
        state = { rows: [], offline: false, error: null }; rowsChanged = false;
        options.onIdle?.();
      });
    }, 30000);
  };
  scheduleStop();
  return {
    get: () => state,
    refresh,
    subscribe(listener: (value: CollectionState<T>) => void) {
      clearTimeout(stopTimer); listeners.add(listener); listener(state);
      if (!onlineAttached) { window.addEventListener('online', online, { passive: true }); onlineAttached = true; }
      if (!unsubscribe || !caughtUp) void refresh().catch(fail);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) scheduleStop();
      };
    }
  };
}

export function commitCursor(data: DocumentData): CommitCursor | undefined {
  const value = data.committedAt;
  return value && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number'
    ? { seconds: value.seconds, nanoseconds: value.nanoseconds } : undefined;
}
