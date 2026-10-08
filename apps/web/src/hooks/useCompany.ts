import { httpsCallable } from 'firebase/functions';
import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '../lib/auth';
import { onSnapshot } from '../lib/firestore-listener';
import { tenantDocFor } from '../lib/tenant-firestore';
import { functions } from '../lib/firebase';
import { DEFAULT_COMPANY, type CompanyConfig } from '../types';

interface CompanyState {
  value: CompanyConfig | null;
  listeners: Set<() => void>;
  stop?: () => void;
  timer?: ReturnType<typeof setTimeout>;
}
const companies = new Map<string, CompanyState>();
function repository(tenantId: string): CompanyState {
  let entry = companies.get(tenantId);
  if (!entry) { entry = { value: null, listeners: new Set() }; companies.set(tenantId, entry); }
  return entry;
}
function subscribe(tenantId: string, listener: () => void) {
  const entry = repository(tenantId);
  clearTimeout(entry.timer); entry.listeners.add(listener);
  if (!entry.stop) {
    const publish = (value: CompanyConfig | null) => { entry.value = value; entry.listeners.forEach((notify) => notify()); };
    entry.stop = onSnapshot(tenantDocFor(tenantId, 'config', 'company'), (snapshot) => {
      publish(snapshot.exists() ? { ...DEFAULT_COMPANY, ...snapshot.data() } as CompanyConfig : null);
    }, () => {
      // Compatibilidad con configuración antigua que todavía contiene campos privados.
      void httpsCallable<Record<string, never>, CompanyConfig | null>(functions, 'getCompanyConfig')({})
        .then(({ data }) => publish(data ? { ...DEFAULT_COMPANY, ...data } : null)).catch(() => publish(null));
    });
  }
  return () => { entry.listeners.delete(listener); if (!entry.listeners.size) entry.timer = setTimeout(() => {
    entry.stop?.(); entry.stop = undefined; entry.value = null;
  }, 30000); };
}
export function useCompany(): CompanyConfig | null {
  const tenantId = useAuth((state) => state.profile?.tenantId);
  return useSyncExternalStore(useCallback((listener) => tenantId ? subscribe(tenantId, listener) : () => undefined, [tenantId]),
    useCallback(() => tenantId ? repository(tenantId).value : null, [tenantId]));
}
