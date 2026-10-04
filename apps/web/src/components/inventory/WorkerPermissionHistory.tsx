import { useEffect, useState } from 'react';
import { getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { tenantCollection } from '../../lib/tenant-firestore';

interface PermissionEvent {
  id: string; workerName: string; userName: string; createdAt: number;
  after: { canIngress: boolean; canCreateProducts: boolean };
}

export function WorkerPermissionHistory({ storeId, revision }: { storeId: string; revision: number }) {
  const [events, setEvents] = useState<PermissionEvent[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [requestCursor, setRequestCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setBusy(true); setError('');
    void getDocs(query(tenantCollection('worker_permission_events'), where('storeId', '==', storeId), orderBy('createdAt', 'desc'),
      ...(requestCursor ? [startAfter(requestCursor)] : []), limit(10))).then((snapshot) => {
      if (!current) return;
      const loaded = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as PermissionEvent));
      setEvents((previous) => requestCursor ? [...previous, ...loaded] : loaded);
      setCursor(snapshot.size === 10 ? snapshot.docs.at(-1)! : null);
    }).catch(() => { if (current) setError('No se pudo cargar el historial de permisos.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [storeId, revision, requestCursor, page]);
  return <section className="card space-y-3 p-4"><h2 className="font-semibold">Historial de permisos</h2>
    {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    {!events.length && !busy && !error && <p className="text-sm text-slate-500">No hay cambios registrados.</p>}
    {events.map((event) => <div key={event.id} className="rounded-xl border border-slate-200 p-3 text-sm"><p><strong>{event.workerName}</strong> · {new Date(event.createdAt).toLocaleString('es-PE')}</p><p className="text-slate-500">{event.userName}: ingreso {event.after.canIngress ? 'permitido' : 'sin acceso'}, creación de productos {event.after.canCreateProducts ? 'permitida' : 'sin acceso'}.</p></div>)}
    {busy && <p className="text-sm text-slate-500">Cargando…</p>}
    <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy} onClick={() => { setRequestCursor(null); setPage((value) => value + 1); }}>Actualizar historial</button>{cursor && <button className="btn-secondary" disabled={busy} onClick={() => { setRequestCursor(cursor); setPage((value) => value + 1); }}>Ver más</button>}</div>
  </section>;
}
