import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { db, storage } from '../../lib/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useAuth } from '../../lib/auth';
import type { Incident, IncidentType } from '../../types';
import { fmtDateTime } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

const TYPES: { value: IncidentType; label: string }[] = [
  { value: 'danado', label: 'Producto dañado' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'sin_etiqueta', label: 'Sin etiqueta de precio' },
  { value: 'sin_codigo', label: 'Sin código' },
  { value: 'otro', label: 'Otro' }
];

export function IncidentsWorkerPage() {
  const profile = useAuth((s) => s.profile)!;
  const uid = useAuth((s) => s.user?.uid);
  const [incidents, setIncidents] = useState<(Incident & { id: string })[]>([]);
  const [creating, setCreating] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);

  useEffect(() => {
    if (!profile.storeId) return;
    return onSnapshot(
      query(
        collection(db, 'incidents'),
        where('storeId', '==', profile.storeId),
        orderBy('createdAt', 'desc'),
        limit(50)
      ),
      (s) =>
        setIncidents(
          s.docs
            .map((d) => ({ ...(d.data() as Incident), id: d.id }))
            .filter((i) => !mineOnly || i.createdBy === uid)
        )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.storeId, mineOnly]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-2xl uppercase tracking-wide">Incidencias</h1>
        <button className="btn-brand" onClick={() => setCreating(true)}>
          Reportar
        </button>
      </div>

      <label className="flex w-fit items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
        Solo las mías
      </label>

      {incidents.length === 0 ? (
        <EmptyState title="Sin incidencias" hint="Reporta productos dañados, vencidos o sin precio." />
      ) : (
        <ul className="space-y-2">
          {incidents.map((i) => (
            <li key={i.id} className="card p-3.5">
              <p className="font-semibold">
                <span className="badge bg-slate-100 mr-2 text-slate-900">
                  {TYPES.find((t) => t.value === i.type)?.label ?? i.type}
                </span>
                {i.productName ?? 'General'}
              </p>
              <p className="mt-1 text-sm">{i.description}</p>
              <p className="mt-1.5 text-xs text-slate-500">
                {fmtDateTime(i.createdAt)} · por {i.createdByName}
                {i.status === 'resuelta' ? ` · resuelta: ${i.resolutionNote}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {creating && <IncidentFormModal onClose={() => setCreating(false)} />}
    </div>
  );
}

export function IncidentFormModal({
  preset,
  onClose
}: {
  preset?: { productId?: string; productName?: string; type?: IncidentType };
  onClose: () => void;
}) {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const [type, setType] = useState<IncidentType>(preset?.type ?? 'danado');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { msg, flash } = useFlash();
  const [storeName, setStoreName] = useState('Mi tienda');

  useEffect(() => {
    if (!profile.storeId) return;
    void getDoc(doc(db, 'stores', profile.storeId)).then((s) => {
      if (s.exists()) setStoreName((s.data() as { name: string }).name);
    });
  }, [profile.storeId]);

  const submit = async () => {
    if (!user || description.trim().length < 3) {
      flash('Error: describe la incidencia');
      return;
    }
    setBusy(true);
    try {
      let photoUrl: string | null = null;
      if (file && file.size <= 5 * 1024 * 1024) {
        const path = `incidents/${user.uid}/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        photoUrl = await getDownloadURL(storageRef);
      }
      await setDoc(doc(collection(db, 'incidents')), {
        storeId: profile.storeId,
        storeName,
        productId: preset?.productId ?? null,
        productName: preset?.productName ?? null,
        type,
        description: description.trim(),
        photoUrl,
        status: 'abierta',
        createdBy: user.uid,
        createdByName: profile.displayName,
        createdAt: Date.now()
      });
      flash('Incidencia reportada. Gracias.');
      onClose();
    } catch {
      flash('Error al enviar el reporte');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title="Reportar incidencia" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value as IncidentType)} className="field" disabled={Boolean(preset?.type)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {!preset?.productId && (
          <div>
            <label className="label">Producto (opcional)</label>
            <input defaultValue={preset?.productName} className="field" readOnly={Boolean(preset?.productName)} />
          </div>
        )}
        {preset?.productName && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold">{preset.productName}</p>
        )}

        <div>
          <label className="label">¿Qué pasó? *</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej.: cajas aplastadas en pasillo 2"
            className="field"
          />
        </div>

        <div>
          <label className="label">Foto (opcional)</label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
        </div>

        <button className="btn-primary w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Enviando…' : 'Enviar reporte'}
        </button>
      </div>

      <FlashBar msg={msg} />
    </Modal>
  );
}
