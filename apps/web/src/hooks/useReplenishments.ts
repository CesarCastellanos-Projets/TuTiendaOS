import { useCallback, useSyncExternalStore } from 'react';
import { limit, orderBy, query, where, documentId } from 'firebase/firestore';
import { onSnapshot } from '../lib/firestore-listener';
import { tenantCollection } from '../lib/tenant-firestore';
import { useAuth } from '../lib/auth';
import type { ReplenishmentRequest } from '../types';

export type PendingReplenishment = ReplenishmentRequest & { id: string };
interface Feed { items: PendingReplenishment[]; error: string | null; loading: boolean }
const empty: Feed = { items: [], error: null, loading: true };
const feeds = new Map<string, { value: Feed; listeners: Set<() => void>; stop?: () => void; closeTimer?: ReturnType<typeof setTimeout> }>();
export const REPLENISHMENT_PAGE_SIZE = 25;
export function pendingReplenishmentQuery() {
  return query(tenantCollection('replenishment_requests'), where('status', '==', 'pendiente'), orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(REPLENISHMENT_PAGE_SIZE));
}
export function useReplenishments() {
  const profile = useAuth((state) => state.profile);
  const uid = useAuth((state) => state.user?.uid);
  const allowed = profile?.role === 'admin' || (profile?.role === 'pos' && profile.storeAccess === 'all');
  const key = allowed && uid ? `${profile!.tenantId}:${uid}` : '';
  if (key && !feeds.has(key)) feeds.set(key, { value: empty, listeners: new Set() });
  const subscribe = useCallback((listener: () => void) => {
    if (!key) return () => undefined;
    const feed = feeds.get(key)!;
    clearTimeout(feed.closeTimer);
    feed.listeners.add(listener);
    if (!feed.stop) {
      feed.stop = onSnapshot(pendingReplenishmentQuery(), (snapshot) => {
        feed.value = { items: snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as PendingReplenishment)), error: null, loading: false };
        feed.listeners.forEach((notify) => notify());
      }, () => {
        feed.value = { items: [], error: 'No se pudieron cargar las reposiciones. Revisa la conexión, las reglas y los índices publicados.', loading: false };
        feed.listeners.forEach((notify) => notify());
      });
    }
    return () => {
      feed.listeners.delete(listener);
      if (!feed.listeners.size) feed.closeTimer = setTimeout(() => { feed.stop?.(); feeds.delete(key); }, 0);
    };
  }, [key]);
  const snapshot = useCallback(() => key ? feeds.get(key)?.value ?? empty : empty, [key]);
  const value = useSyncExternalStore(subscribe, snapshot);
  return { ...value, allowed };
}
