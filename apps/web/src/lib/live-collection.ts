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
  let cursor: CommitCursor | undefined;
  let complete = false;
  let coverageCursor: CommitCursor | undefined;
  let caughtUp = false;
  let loading: Promise<void> | null = null;
  let syncing: Promise<void> | null = null;
  let refreshAgain = false;
  let unsubscribe: (() => void) | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();
  const filters = options.filters ?? [];
  const metaKey = `sync-v2:${options.key}`;
  const publish = () => {
    state = { ...state, rows: [...rows.values()] };
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
      if (compare(row.committedAt, cursor) > 0) cursor = row.committedAt;
    }
  };
  const persist = (updates: T[], replace: boolean) => {
    const checkpoint = coverageCursor;
    writes = writes.then(async () => {
      await options.save(updates, replace);
      await localDb.catalogMeta.put({ key: metaKey, value: 1, cursor: checkpoint });
    }).catch(fail);
    return writes;
  };
  const load = () => loading ??= (async () => {
    const [cached, meta] = await Promise.all([options.load(), localDb.catalogMeta.get(metaKey)]);
    apply(cached); cursor = meta?.cursor; coverageCursor = cursor; complete = meta?.value === 1;
    publish();
  })().catch((cause: unknown) => { loading = null; throw cause; });
  const watch = () => {
    if (unsubscribe || !listeners.size) return;
    const since = cursor ? new Timestamp(cursor.seconds, cursor.nanoseconds) : new Timestamp(0, 0);
    unsubscribe = onSnapshot(query(options.collection, ...filters, where('committedAt', '>=', since), orderBy('committedAt', 'desc'), limit(300)), { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache) { state = { ...state, offline: !navigator.onLine }; publish(); return; }
      const updates = snapshot.docChanges().filter((change) => change.type !== 'removed')
        .map(({ doc }) => options.decode(doc.id, doc.data()));
      if (syncing || !caughtUp) updates.forEach((row) => liveDuringSync.set(options.id(row), row));
      apply(updates);
      state = { ...state, offline: false, error: null }; publish();
      const tail = snapshot.docs.at(-1)?.data();
      if (snapshot.size === 300 && compare(tail ? commitCursor(tail) : undefined, coverageCursor) >= 0) {
        if (syncing) refreshAgain = true;
        caughtUp = false; void refresh();
      } else if (complete && caughtUp && !syncing && updates.length) {
        coverageCursor = cursor; void persist(updates, false);
      }
    }, (error) => { unsubscribe?.(); unsubscribe = null; fail(error); });
  };
  const refresh = async () => {
    await load();
    if (syncing) return syncing;
    syncing = (async () => {
      do {
      refreshAgain = false;
      const initial = !complete;
      const since = coverageCursor ? new Timestamp(coverageCursor.seconds, coverageCursor.nanoseconds) : new Timestamp(0, 0);
      const updates: T[] = [];
      let pageCursor: QueryDocumentSnapshot<DocumentData> | undefined;
      do {
        const constraints = initial ? [orderBy(documentId())]
          : [where('committedAt', '>=', since), orderBy('committedAt'), orderBy(documentId())];
        const page = await getDocsFromServer(query(options.collection, ...filters, ...constraints,
          ...(pageCursor ? [startAfter(pageCursor)] : []), limit(300)));
        updates.push(...page.docs.map((doc) => options.decode(doc.id, doc.data())));
        pageCursor = page.size === 300 ? page.docs.at(-1) : undefined;
      } while (pageCursor);
      if (initial) rows.clear();
      apply(updates); apply([...liveDuringSync.values()]); liveDuringSync.clear();
      complete = true;
      if (refreshAgain) continue;
      caughtUp = true; coverageCursor = cursor; state = { ...state, offline: false, error: null }; publish();
      await persist([...rows.values()], true);
      } while (refreshAgain);
    })().catch(fail).finally(() => { syncing = null; });
    watch();
    return syncing;
  };
  const online = () => { if (listeners.size) { watch(); void refresh(); } };
  window.addEventListener('online', online, { passive: true });
  return {
    get: () => state,
    refresh,
    subscribe(listener: (value: CollectionState<T>) => void) {
      clearTimeout(stopTimer); listeners.add(listener); listener(state);
      if (!unsubscribe || !caughtUp) void load().then(() => { watch(); return refresh(); }).catch(fail);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stopTimer = setTimeout(() => { unsubscribe?.(); unsubscribe = null; caughtUp = false; }, 30000);
      };
    }
  };
}

export function commitCursor(data: DocumentData): CommitCursor | undefined {
  const value = data.committedAt;
  return value && typeof value.seconds === 'number' && typeof value.nanoseconds === 'number'
    ? { seconds: value.seconds, nanoseconds: value.nanoseconds } : undefined;
}
