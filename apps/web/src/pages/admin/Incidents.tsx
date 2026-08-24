import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import type { Incident, IncidentStatus } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

const TYPE_LABEL: Record<Incident['type'], string> = {
  danado: 'Producto dañado',
  vencido: 'Vencido',
  sin_etiqueta: 'Sin etiqueta de precio',
  sin_codigo: 'Sin código',
  otro: 'Otro'
};

export function IncidentsAdminPage() {
  const [filter, setFilter] = useState<IncidentStatus>('abierta');
  const [incidents, setIncidents] = useState<(Incident & { id: string })[]>([]);
  const [resolving, setResolving] = useState<(Incident & { id: string }) | null>(null);
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const { msg, flash } = useFlash();

  useEffect(() => {
    const q = query(collection(db, 'incidents'), orderBy('createdAt', 'desc'), limit(100));
    return onSnapshot(q, (s) => {
      const all = s.docs.map((d) => ({ ...(d.data() as Incident), id: d.id }));
      setIncidents(all.filter((x) => x.status === filter));
    });
  }, [filter]);

  const resolve = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !resolving) return;
    const fd = new FormData(e.currentTarget);
    try {
      await updateDoc(doc(db, 'incidents', resolving.id), {
        status: 'resuelta',
        resolutionNote: (fd.get('note') as string ?? '').trim(),
        resolvedBy: user.uid,
        resolvedByName: profile.displayName,
        resolvedAt: Date.now()
      });
      setResolving(null);
      flash('Incidencia resuelta');
    } catch {
      flash('Error al resolver');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl uppercase tracking-wide">Incidencias</h1>
        <select className="field !min-h-9 w-40" value={filter} onChange={(e) => setFilter(e.target.value as IncidentStatus)}>
          <option value="abierta">Abiertas</option>
          <option value="resuelta">Resueltas</option>
        </select>
      </div>

      {incidents.length === 0 ? (
        <EmptyState title={`Sin incidencias ${filter === 'abierta' ? 'abiertas' : 'resueltas'}`} />
      ) : (
        <div className="space-y-3">
          {incidents.map((i) => (
            <div key={i.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    <span className="badge bg-slate-100 mr-2 text-slate-900">{TYPE_LABEL[i.type]}</span>
                    {i.productName ?? 'General'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {i.storeName} · {fmtDateTime(i.createdAt)} · reportó {i.createdByName}
                  </p>
                </div>
                {i.status === 'abierta' && (
                  <button className="btn-primary !min-h-9 !px-3 !py-1.5 text-sm" onClick={() => setResolving(i)}>
                    Resolver
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm">{i.description}</p>
              {i.resolutionNote && (
                <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-success">
                  Resolución: {i.resolutionNote} — {i.resolvedByName}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={resolving !== null} title="Resolver incidencia" onClose={() => setResolving(null)}>
        <form onSubmit={resolve} className="space-y-3">
          <p className="text-sm text-slate-500">
            Si corresponde, haz el ajuste de inventario en la sección Ajustes.
          </p>
          <div>
            <label className="label">Nota de resolución</label>
            <textarea name="note" rows={3} className="field" placeholder="Ej.: producto retirado de góndola y dado de baja" />
          </div>
          <button className="btn-primary w-full">Marcar como resuelta</button>
        </form>
      </Modal>

      <FlashBar msg={msg} />
    </div>
  );
}
