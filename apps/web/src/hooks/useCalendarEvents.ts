import { useEffect, useRef, useState } from 'react';
import {
  documentId,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { tenantCollectionFor } from '../lib/tenant-firestore';
import { useAuth } from '../lib/auth';
import type { CalendarEvent } from '../types';

export function useCalendarEvents(month: string) {
  const profile = useAuth((state) => state.profile);
  const tenantId = profile?.tenantId;
  const allowed = profile?.canManageCalendar === true;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const cursor = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const generation = useRef(0);
  const snapshotVersion = useRef(0);
  const [paging, setPaging] = useState(false);
  const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 7);
  useEffect(() => {
    const revision = ++generation.current;
    setEvents([]);
    setLoading(true);
    setError(null);
    setMore(false);
    setPaging(false);
    cursor.current = null;
    if (!tenantId || !allowed) {
      setLoading(false);
      return;
    }
    const unsubscribe = onSnapshot(
      query(
        tenantCollectionFor(tenantId, 'calendar_events'),
        where('dueDate', '>=', `${month}-01`),
        where('dueDate', '<', `${nextMonth}-01`),
        orderBy('dueDate'),
        orderBy(documentId()),
        limit(51)
      ),
      (snapshot) => {
        if (generation.current !== revision) return;
        snapshotVersion.current++;
        const page = snapshot.docs.slice(0, 50);
        setEvents(page.map((doc) => ({ ...doc.data(), id: doc.id }) as CalendarEvent));
        cursor.current = page.at(-1) ?? null;
        setMore(snapshot.size > 50);
        setLoading(false);
      },
      () => {
        setEvents([]);
        setError('No se pudo cargar el calendario. Revisa la conexión y tus permisos.');
        setLoading(false);
      }
    );
    return () => {
      unsubscribe();
      generation.current = revision + 1;
    };
  }, [tenantId, allowed, month, nextMonth]);
  const loadMore = async () => {
    if (!tenantId || !allowed || !cursor.current || paging) return;
    const revision = generation.current;
    const snapshotRevision = snapshotVersion.current;
    setPaging(true);
    try {
      const snapshot = await getDocs(
        query(
          tenantCollectionFor(tenantId, 'calendar_events'),
          where('dueDate', '>=', `${month}-01`),
          where('dueDate', '<', `${nextMonth}-01`),
          orderBy('dueDate'),
          orderBy(documentId()),
          startAfter(cursor.current),
          limit(51)
        )
      );
      if (generation.current !== revision || snapshotVersion.current !== snapshotRevision) return;
      const page = snapshot.docs.slice(0, 50);
      setEvents((current) =>
        [...current, ...page.map((doc) => ({ ...doc.data(), id: doc.id }) as CalendarEvent)].filter(
          (item, index, all) => all.findIndex((other) => other.id === item.id) === index
        )
      );
      cursor.current = page.at(-1) ?? null;
      setMore(snapshot.size > 50);
    } catch {
      setError('No se pudieron cargar más eventos.');
    } finally {
      setPaging(false);
    }
  };
  return { events, error, loading, more, paging, loadMore };
}
