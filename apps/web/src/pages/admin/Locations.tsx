import { useEffect, useState } from 'react';
import { doc, query, setDoc, limit, deleteDoc } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { Building2, Plus, Warehouse as WarehouseIcon, Trash2 } from 'lucide-react';
import { requireCurrentTenantId, tenantCollection, tenantDoc } from '../../lib/tenant-firestore';
import { clean } from '../../lib/utils';
import type { Store, Warehouse } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

export function LocationsPage() {
  const [tab, setTab] = useState<'tiendas' | 'almacenes'>('tiendas');
  const [stores, setStores] = useState<Store[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);
  const [creatingStore, setCreatingStore] = useState(false);
  const [creatingWh, setCreatingWh] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => {
    const qs = query(tenantCollection('stores'), limit(50));
    const un1 = onSnapshot(qs, (s) => setStores(s.docs.map((d) => ({ ...(d.data() as Store), id: d.id }))));
    const qw = query(tenantCollection('warehouses'), limit(50));
    const un2 = onSnapshot(qw, (s) => setWarehouses(s.docs.map((d) => ({ ...(d.data() as Warehouse), id: d.id }))));
    return () => {
      un1();
      un2();
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl uppercase tracking-wide">Tiendas y almacenes</h1>
        <button
          className="btn-brand"
          onClick={() => (tab === 'tiendas' ? setCreatingStore(true) : setCreatingWh(true))}
        >
          <Plus size={16} /> {tab === 'tiendas' ? 'Nueva tienda' : 'Nuevo almacén'}
        </button>
      </div>

      <div className="flex gap-2">
        {(['tiendas', 'almacenes'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize ${
              tab === t ? 'bg-slate-900 text-slate-50' : 'bg-white border border-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'tiendas' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-start justify-between">
                <Building2 size={20} className="text-blue-600" />
                <div className="flex gap-1">
                  <button className="text-sm font-semibold text-blue-600 hover:underline" onClick={() => setEditingStore(s)}>
                    Editar
                  </button>
                  <button
                    aria-label="Eliminar"
                    className="text-critical hover:opacity-70"
                    onClick={() => {
                      if (confirm(`¿Eliminar la tienda ${s.name}? Los usuarios asignados quedarán sin tienda.`)) {
                        void deleteDoc(tenantDoc('stores', s.id)).catch(() => flash('Error al eliminar'));
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <p className="mt-2 font-semibold">{s.name}</p>
              <p className="text-xs text-slate-500">Código {s.code}{s.address ? ` · ${s.address}` : ''}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {warehouses.map((w) => (
            <div key={w.id} className="card p-4">
              <div className="flex items-start justify-between">
                <WarehouseIcon size={20} className="text-success" />
                <div className="flex gap-1">
                  <button className="text-sm font-semibold text-blue-600 hover:underline" onClick={() => setEditingWh(w)}>
                    Editar
                  </button>
                  <button
                    aria-label="Eliminar"
                    className="text-critical hover:opacity-70"
                    onClick={() => {
                      if (confirm(`¿Eliminar el almacén ${w.name}?`)) {
                        void deleteDoc(tenantDoc('warehouses', w.id)).catch(() => flash('Error al eliminar'));
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <p className="mt-2 font-semibold">{w.name}</p>
              <p className="text-xs text-slate-500">
                Código {w.code}
                {w.isCentral ? ' · Almacén central' : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <Modal open={creatingStore || editingStore !== null} title={editingStore ? 'Editar tienda' : 'Nueva tienda'} onClose={() => { setCreatingStore(false); setEditingStore(null); }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const data = {
              tenantId: requireCurrentTenantId(),
              name: clean(fd.get('name')),
              code: (clean(fd.get('code')) || '').toUpperCase(),
              address: clean(fd.get('address'))
            };
            if (!data.name || !data.code) return flash('Error: nombre y código son obligatorios');
            const ref = editingStore && stores.some((s) => s.id === editingStore.id) ? tenantDoc('stores', editingStore.id) : doc(tenantCollection('stores'));
            void setDoc(ref, data).then(() => {
              setCreatingStore(false);
              setEditingStore(null);
              flash('Tienda guardada');
            });
          }}
          className="space-y-3"
        >
          <div>
            <label className="label">Nombre *</label>
            <input name="name" required defaultValue={editingStore?.name} className="field" />
          </div>
          <div>
            <label className="label">Código corto *</label>
            <input name="code" required defaultValue={editingStore?.code} maxLength={12} placeholder="T01" className="field font-mono uppercase" />
          </div>
          <div>
            <label className="label">Dirección</label>
            <input name="address" defaultValue={editingStore?.address} className="field" />
          </div>
          <button className="btn-primary w-full">Guardar</button>
        </form>
      </Modal>

      <Modal open={creatingWh || editingWh !== null} title={editingWh ? 'Editar almacén' : 'Nuevo almacén'} onClose={() => { setCreatingWh(false); setEditingWh(null); }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const data = {
              tenantId: requireCurrentTenantId(),
              name: clean(fd.get('name')),
              code: (clean(fd.get('code')) || '').toUpperCase(),
              isCentral: fd.get('isCentral') === 'on'
            };
            if (!data.name || !data.code) return flash('Error: nombre y código son obligatorios');
            const ref = editingWh && warehouses.some((w) => w.id === editingWh.id) ? tenantDoc('warehouses', editingWh.id) : doc(tenantCollection('warehouses'));
            void setDoc(ref, data).then(() => {
              setCreatingWh(false);
              setEditingWh(null);
              flash('Almacén guardado');
            });
          }}
          className="space-y-3"
        >
          <div>
            <label className="label">Nombre *</label>
            <input name="name" required defaultValue={editingWh?.name} className="field" />
          </div>
          <div>
            <label className="label">Código corto *</label>
            <input name="code" required defaultValue={editingWh?.code} maxLength={12} placeholder="ALM01" className="field font-mono uppercase" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="isCentral" defaultChecked={editingWh?.isCentral} /> Es el almacén central
          </label>
          <button className="btn-primary w-full">Guardar</button>
        </form>
      </Modal>

      <FlashBar msg={msg} />
    </div>
  );
}
