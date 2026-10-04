import { useEffect, useState } from 'react';
import { getDocs, limit, orderBy, query, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '../../lib/auth';
import { tenantCollection } from '../../lib/tenant-firestore';

interface IngressRecord {
  id: string;
  userName: string;
  createdAt: number;
  note: string;
  items: { productName: string; presentationLabel: string; presentationQty: number }[];
}

export function IngressHistory({ locationId, locationType, revision = 0 }: { locationId: string; locationType: 'store' | 'warehouse'; revision?: number }) {
  const uid = useAuth((s) => s.user?.uid);
  const tenantId = useAuth((s) => s.profile?.tenantId);
  const worker = useAuth((s) => s.profile?.role === 'trabajador');
  const [records, setRecords] = useState<IngressRecord[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [requestCursor, setRequestCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError('');
    const constraints = [where('locationId', '==', locationId), where('locationType', '==', locationType),
      ...(worker ? [where('userId', '==', uid)] : []), orderBy('createdAt', 'desc'),
      ...(requestCursor ? [startAfter(requestCursor)] : []), limit(10)];
    void getDocs(query(tenantCollection('stock_ingresses'), ...constraints)).then((snapshot) => {
      if (!current) return;
      const loaded = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id } as IngressRecord));
      setRecords((previous) => requestCursor ? [...previous, ...loaded] : loaded);
      setCursor(snapshot.size === 10 ? snapshot.docs.at(-1)! : null);
    }).catch(() => { if (current) setError('No se pudo cargar el historial. Revisa que las reglas y los índices estén publicados.'); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [locationId, locationType, tenantId, uid, worker, revision, page, requestCursor]);
  return <section className="card space-y-3 p-4">
    <h2 className="font-semibold">Ingresos registrados{worker ? ' por ti' : ''}</h2>
    {error && <p className="text-sm text-critical" role="alert">{error}</p>}
    {!records.length && !busy && !error && <p className="text-sm text-slate-500">No hay ingresos registrados.</p>}
    {records.map((record) => <details key={record.id} className="rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm"><span className="font-semibold">{new Date(record.createdAt).toLocaleString('es-PE')}</span> · {record.userName} · {record.items.length} líneas</summary>
      <p className="mt-2 break-all text-xs text-slate-500">Ingreso: {record.id}</p>
      <ul className="mt-2 space-y-1 text-sm">{record.items.map((item, index) => <li key={index}>{item.productName} · {item.presentationQty} {item.presentationLabel}</li>)}</ul>
      {record.note && <p className="mt-2 text-sm text-slate-500">{record.note}</p>}
    </details>)}
    {busy && <p className="text-sm text-slate-500">Cargando…</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setRequestCursor(null); setPage((value) => value + 1); }}>Actualizar historial</button>
      {cursor && <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setRequestCursor(cursor); setPage((value) => value + 1); }}>Ver más</button>}
    </div>
  </section>;
}
