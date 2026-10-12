import { useEffect, useMemo, useState } from 'react';
import { documentId, limit, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { onSnapshot } from '../lib/firestore-listener';
import { tenantCollection } from '../lib/tenant-firestore';
import { usePagedQuery } from './usePagedQuery';
import { useCalendarClock } from './useCalendarClock';
import type { Quotation } from '../types';

interface Cursor { createdAt: number; id: string }
export function useQuotations(storeId: string, open: boolean) {
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [cutoff] = useState(() => Date.now() - 30 * 86400000);
  const [cursors, setCursors] = useState<(Cursor | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<Cursor | null>(null);
  const [matches, setMatches] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useCalendarClock();
  const source = useMemo(() => open && !search ? query(tenantCollection('quotations'), where('storeId', '==', storeId), where('status', '==', 'pendiente'), where('createdAt', '>', cutoff), orderBy('createdAt', 'desc')) : null, [open, search, storeId, cutoff]);
  const paged = usePagedQuery<Quotation>(source, 20);
  useEffect(() => { const timer = setTimeout(() => { setSearch(term.trim()); setCursors([null]); }, 350); return () => clearTimeout(timer); }, [term]);
  const cursor = cursors.at(-1);
  useEffect(() => {
    setMatches([]); setNextCursor(null); setError(null);
    if (!open || !search) return;
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    setLoading(true);
    void httpsCallable<unknown, { items: Quotation[]; cursor: Cursor | null }>(functions, 'searchQuotations')({ storeId, term: search, cursor }).then(({ data }) => {
      if (!alive) return;
      setMatches(data.items); setNextCursor(data.cursor); setLoading(false);
      if (data.items.length) unsubscribe = onSnapshot(query(tenantCollection('quotations'), where(documentId(), 'in', data.items.map((item) => item.id)), limit(20)), (snapshot) => {
        const current = new Map(snapshot.docs.map((doc) => [doc.id, { ...doc.data(), id: doc.id } as Quotation]));
        setMatches(data.items.flatMap((item) => { const updated = current.get(item.id); return updated?.status === 'pendiente' ? [updated] : []; }));
      }, () => setError('No se pudieron actualizar las cotizaciones.'));
    }).catch((failure: unknown) => { if (alive) { setLoading(false); setError(failure instanceof Error ? failure.message : 'No se pudo buscar.'); } });
    return () => { alive = false; unsubscribe?.(); };
  }, [search, cursor, open, storeId]);
  const result = search ? { rows: matches, error, loading, page: cursors.length, hasNext: Boolean(nextCursor), hasPrevious: cursors.length > 1,
    next: () => { if (nextCursor && !loading) setCursors([...cursors, nextCursor]); }, previous: () => setCursors(cursors.slice(0, -1)) } : paged;
  return { ...result, rows: result.rows.filter((quote) => quote.status === 'pendiente' && (quote.expiresAt ?? quote.createdAt + 30 * 86400000) > now), term, setTerm, searching: Boolean(search) };
}
