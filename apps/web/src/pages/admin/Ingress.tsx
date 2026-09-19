import { useEffect, useState } from 'react';
import { query, limit } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { tenantCollection } from '../../lib/tenant-firestore';
import { ingressStock } from '../../lib/inventory';
import { ProductLines, useProductSearch, type PickLine } from '../../components/ui/ProductPicker';
import type { Store, Warehouse } from '../../types';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

export function IngressPage() {
  const [locations, setLocations] = useState<{ id: string; name: string; kind: 'store' | 'warehouse' }[]>([]);
  const [locationId, setLocationId] = useState('');
  const [lines, setLines] = useState<PickLine[]>([]);
  const { search } = useProductSearch();
  const { msg, flash } = useFlash();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const un1 = onSnapshot(query(tenantCollection('stores'), limit(50)), (s) =>
      setLocations((prev) => [
        ...prev.filter((p) => p.kind !== 'store'),
        ...s.docs.map((d) => ({ id: d.id, name: (d.data() as Store).name, kind: 'store' as const }))
      ])
    );
    const un2 = onSnapshot(query(tenantCollection('warehouses'), limit(50)), (s) =>
      setLocations((prev) => [
        ...prev.filter((p) => p.kind !== 'warehouse'),
        ...s.docs.map((d) => ({ id: d.id, name: (d.data() as Warehouse).name, kind: 'warehouse' as const }))
      ])
    );
    return () => {
      un1();
      un2();
    };
  }, []);

  const submit = async () => {
    if (!locationId || lines.length === 0) {
      flash('Error: elige ubicación y agrega al menos un producto');
      return;
    }
    const loc = locations.find((l) => l.id === locationId);
    if (!loc) return;
    setBusy(true);
    try {
      await ingressStock({
        locationId,
        locationType: loc.kind,
        items: lines.map((l) => ({ productId: l.productId, presentationId: l.presentationId, qty: l.qty }))
      });
      setLines([]);
      flash(`Ingreso registrado: ${lines.length} productos a ${loc.name}`);
    } catch (err) {
      flash(`Error: ${err instanceof Error ? err.message : 'no se pudo registrar'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl uppercase tracking-wide">Ingreso de mercadería</h1>

      <div className="card max-w-2xl space-y-4 p-4">
        <div>
          <label className="label">Destino *</label>
          <select className="field" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Elegir tienda o almacén…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.kind === 'warehouse' ? '[Almacén] ' : '[Tienda] '}
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <ProductLines lines={lines} setLines={setLines} searchFn={search} />

        <button className="btn-brand w-full" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Registrando…' : `Registrar ingreso${lines.length ? ` (${lines.length} productos)` : ''}`}
        </button>
      </div>

      <FlashBar msg={msg} />
    </div>
  );
}

export type { PickLine };
