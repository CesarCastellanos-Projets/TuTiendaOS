import { useEffect, useState } from 'react';
import { limit, query, startAfter, type DocumentData, type Query, type QueryDocumentSnapshot } from 'firebase/firestore';
import { onSnapshot } from '../lib/firestore-listener';

export function usePagedQuery<T extends { id: string }>(source: Query<DocumentData> | null, size = 50) {
  const [rows, setRows] = useState<T[]>([]);
  const [cursors, setCursors] = useState<Array<QueryDocumentSnapshot<DocumentData> | undefined>>([undefined]);
  const [last, setLast] = useState<QueryDocumentSnapshot<DocumentData>>();
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cursor = cursors.at(-1);
  useEffect(() => { setCursors([undefined]); setRows([]); }, [source]);
  useEffect(() => {
    setLoading(true); setError(null); setHasNext(false);
    if (!source) { setRows([]); setLoading(false); return; }
    return onSnapshot(query(source, ...(cursor ? [startAfter(cursor)] : []), limit(size)), (snapshot) => {
      setRows(snapshot.docs.map((document) => ({ ...document.data(), id: document.id }) as T));
      setLast(snapshot.docs.at(-1)); setHasNext(snapshot.size === size); setLoading(false);
    }, (cause) => { setError(cause.message); setLoading(false); });
  }, [source, size, cursor]);
  return { rows, error, loading, page: cursors.length, hasNext, hasPrevious: cursors.length > 1,
    next: () => { if (last && hasNext && !loading) setCursors((previous) => [...previous, last]); },
    previous: () => { if (cursors.length > 1 && !loading) setCursors((previous) => previous.slice(0, -1)); } };
}
