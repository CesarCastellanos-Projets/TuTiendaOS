import { useEffect, useState } from 'react';
import { getDoc, getDocs, limit, orderBy, query, startAfter, documentId, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '../../lib/auth';
import { tenantCollection, tenantDoc } from '../../lib/tenant-firestore';
import { listInventoryWorkers, setInventoryWorkerAccess, type InventoryWorker } from '../../lib/worker-inventory';
import { WorkerPermissionHistory } from './WorkerPermissionHistory';
import { IngressHistory } from './IngressHistory';
import type { Store } from '../../types';

function WorkerAccessRow({ worker, disabled, onSave }: { worker: InventoryWorker; disabled: boolean;
  onSave: (worker: InventoryWorker, canIngress: boolean, canCreateProducts: boolean) => void }) {
  const [ingress, setIngress] = useState(worker.canIngress);
  const [create, setCreate] = useState(worker.canCreateProducts);
  const changed = ingress !== worker.canIngress || create !== worker.canCreateProducts;
  return <article className="card space-y-3 p-4">
    <div><h2 className="font-semibold">{worker.displayName}</h2><p className="text-xs text-slate-500">{worker.active ? 'Trabajador activo' : 'Trabajador desactivado'}</p></div>
    <fieldset disabled={disabled || !worker.active} className="grid gap-2 sm:grid-cols-2">
      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" checked={ingress} onChange={(event) => setIngress(event.target.checked)} /> Registrar ingresos de mercadería</label>
      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" checked={create} onChange={(event) => setCreate(event.target.checked)} /> Crear productos nuevos</label>
    </fieldset>
    {worker.updatedAt > 0 && <p className="text-xs text-slate-500">Último cambio: {worker.updatedByName} · {new Date(worker.updatedAt).toLocaleString('es-PE')}</p>}
    <div className="flex flex-wrap gap-2"><button className="btn-brand" disabled={disabled || !worker.active || !changed} onClick={() => onSave(worker, ingress, create)}>Guardar permisos</button>
      {(worker.canIngress || worker.canCreateProducts) && <button className="btn-secondary text-critical" disabled={disabled} onClick={() => onSave(worker, false, false)}>Retirar ambos permisos</button>}</div>
  </article>;
}

export function InventoryPermissionsWorkspace({ activeStoreId }: { activeStoreId?: string }) {
  const profile = useAuth((s) => s.profile)!;
  const [stores, setStores] = useState<Store[]>([]);
  const [storeCursor, setStoreCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [selected, setSelected] = useState('');
  const storeId = activeStoreId ?? selected;
  const [workers, setWorkers] = useState<InventoryWorker[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [requestCursor, setRequestCursor] = useState<string | undefined>();
  const [reload, setReload] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storeBusy, setStoreBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<'none' | 'permissions' | 'ingresses'>('none');
  const allowed = profile.role === 'admin' || (profile.role === 'pos' && profile.storeAccess === 'all');
  useEffect(() => {
    if (!allowed) return;
    let current = true;
    setStoreBusy(true);
    const load = activeStoreId ? getDoc(tenantDoc('stores', activeStoreId)).then((doc) => {
      if (current) setStores(doc.exists() ? [{ ...doc.data(), id: doc.id } as Store] : []);
    }) : getDocs(query(tenantCollection('stores'), orderBy(documentId()), limit(25))).then((snapshot) => {
      if (!current) return;
      setStores(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Store)));
      setStoreCursor(snapshot.size === 25 ? snapshot.docs.at(-1)! : null);
    });
    void load.catch(() => { if (current) setError('No se pudieron cargar las tiendas.'); }).finally(() => { if (current) setStoreBusy(false); });
    return () => { current = false; };
  }, [activeStoreId, allowed, profile.tenantId]);
  useEffect(() => {
    if (!allowed || !storeId) return;
    let current = true;
    setBusy(true); setError('');
    void listInventoryWorkers(storeId, requestCursor).then((page) => {
      if (!current) return;
      setWorkers((previous) => requestCursor ? [...previous, ...page.workers] : page.workers);
      setCursor(page.nextCursor);
    }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los trabajadores.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [allowed, storeId, profile.tenantId, requestCursor, reload]);
  const save = async (worker: InventoryWorker, canIngress: boolean, canCreateProducts: boolean) => {
    if (saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      await setInventoryWorkerAccess(storeId, worker, canIngress, canCreateProducts);
      setWorkers((rows) => rows.map((row) => row.id === worker.id ? { ...row, canIngress, canCreateProducts,
        updatedAt: Date.now(), updatedByName: profile.displayName } : row));
      setRevision((value) => value + 1);
      setMessage(canIngress || canCreateProducts ? `Permisos guardados para ${worker.displayName}.` : `Permisos retirados a ${worker.displayName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los permisos.');
    } finally { setSaving(false); }
  };
  const moreStores = async () => {
    if (!storeCursor || storeBusy) return;
    setStoreBusy(true);
    try {
      const snapshot = await getDocs(query(tenantCollection('stores'), orderBy(documentId()), startAfter(storeCursor), limit(25)));
      setStores((previous) => [...previous, ...snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as Store))]);
      setStoreCursor(snapshot.size === 25 ? snapshot.docs.at(-1)! : null);
    } catch { setError('No se pudieron cargar más tiendas.'); }
    finally { setStoreBusy(false); }
  };
  if (!allowed) return <p className="card p-4">Tu cuenta no puede administrar permisos de trabajadores.</p>;
  return <div className="mx-auto w-full max-w-3xl space-y-4">
    <h1 className="font-display text-2xl font-bold">Permisos de trabajadores</h1>
    <p className="text-sm text-slate-500">Habilita el ingreso de mercadería y la creación de productos para trabajadores de esta tienda. Retira el acceso cuando terminen.</p>
    {activeStoreId ? <p className="card p-4 text-sm">Tienda activa: <strong>{stores.find((store) => store.id === storeId)?.name ?? 'Cargando…'}</strong></p> : <section className="card space-y-2 p-4">
      <label><span className="label">Tienda</span><select className="field" disabled={saving} value={selected} onChange={(event) => { setSelected(event.target.value); setRequestCursor(undefined); setWorkers([]); setCursor(null); setHistory('none'); setMessage(''); }}><option value="">Seleccionar tienda…</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
      {storeCursor && <button className="btn-secondary" disabled={storeBusy} onClick={() => void moreStores()}>Cargar más tiendas</button>}
    </section>}
    {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-critical" role="alert">{error}</p>}
    {message && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{message}</p>}
    {storeId && <>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary" disabled={busy || saving} onClick={() => { setRequestCursor(undefined); setReload((value) => value + 1); }}>Actualizar trabajadores</button><button className="btn-secondary" onClick={() => setHistory(history === 'permissions' ? 'none' : 'permissions')}>Historial de permisos</button><button className="btn-secondary" onClick={() => setHistory(history === 'ingresses' ? 'none' : 'ingresses')}>Ingresos de la tienda</button></div>
      {!workers.length && !busy && !error && <p className="card p-4 text-sm text-slate-500">No hay trabajadores asignados a esta tienda. Puedes crearlos desde Usuarios y Accesos del admin.</p>}
      {workers.map((worker) => <WorkerAccessRow key={`${worker.id}:${worker.updatedAt}:${worker.canIngress}:${worker.canCreateProducts}`} worker={worker} disabled={saving || busy} onSave={(row, ingress, create) => void save(row, ingress, create)} />)}
      {busy && <p className="text-sm text-slate-500">Cargando trabajadores…</p>}
      {cursor && <button className="btn-secondary" disabled={busy || saving} onClick={() => setRequestCursor(cursor)}>Ver más trabajadores</button>}
      {history === 'permissions' && <WorkerPermissionHistory key={`${profile.tenantId}:${storeId}:${revision}`} storeId={storeId} revision={revision} />}
      {history === 'ingresses' && <IngressHistory key={`${profile.tenantId}:${storeId}`} locationId={storeId} locationType="store" />}
    </>}
  </div>;
}
