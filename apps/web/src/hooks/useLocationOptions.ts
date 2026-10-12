import { useCallback, useEffect, useRef, useState } from 'react';
import { documentId, getDocs, limit, orderBy, query, startAfter, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { tenantCollectionFor } from '../lib/tenant-firestore';

export function useLocationOptions(tenantId: string) {
  const [rows, setRows] = useState<Array<{ id: string; name: string; source: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const session = useRef<{ active: boolean; busy: boolean; pages: Array<{ collection: string; cursor?: QueryDocumentSnapshot<DocumentData>; more: boolean }> } | undefined>(undefined);
  const next = useCallback(async () => {
    const current = session.current;
    if (!current?.active || current.busy) return;
    current.busy = true; setLoading(true); setError(null);
    try {
      const pages = await Promise.all(current.pages.filter((page) => page.more).map(async (page) => ({ page,
        snapshot: await getDocs(query(tenantCollectionFor(tenantId, page.collection), orderBy(documentId()),
          ...(page.cursor ? [startAfter(page.cursor)] : []), limit(50)))
      })));
      if (!current.active) return;
      const updates = pages.flatMap(({ page, snapshot }) => {
        page.cursor = snapshot.docs.at(-1); page.more = snapshot.size === 50;
        return snapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name ?? ''), source: page.collection }));
      });
      setRows((previous) => [...new Map([...previous, ...updates].map((row) => [`${row.source}:${row.id}`, row])).values()]);
      setHasNext(current.pages.some((page) => page.more));
    } catch { if (current.active) setError('No se pudieron cargar las ubicaciones.'); }
    finally { current.busy = false; if (current.active) setLoading(false); }
  }, [tenantId]);
  useEffect(() => {
    const current = { active: true, busy: false, pages: ['stores', 'warehouses'].map((collection) => ({ collection, more: true })) };
    session.current = current; setRows([]); setHasNext(false);
    void next();
    return () => { current.active = false; };
  }, [next]);
  return { rows, loading, error, hasNext, next };
}
