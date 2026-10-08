import { useMemo, useState } from 'react';
import { documentId, orderBy, query } from 'firebase/firestore';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { Pagination } from '../../components/ui/Pagination';
import { Building2, Plus, Warehouse as WarehouseIcon, Trash2 } from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { durableCommand } from '../../lib/durable-command';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import { clean } from '../../lib/utils';
import type { Store, Warehouse } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

export function LocationsPage() {
  const [tab, setTab] = useState<'tiendas' | 'almacenes'>('tiendas');
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);
  const [creatingStore, setCreatingStore] = useState(false);
  const [creatingWh, setCreatingWh] = useState(false);
  const { msg, flash } = useFlash();

  const locationQuery = useMemo(() => query(tenantCollection(tab === 'tiendas' ? 'stores' : 'warehouses'), orderBy(documentId())), [tab]);
  const locationPage = usePagedQuery<Store & Warehouse>(locationQuery);
  const stores = locationPage.rows.filter((row) => row.active !== false);
  const warehouses = stores;

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

      {locationPage.error && <p role="alert" className="text-critical">{locationPage.error}</p>}
      <Pagination {...locationPage} />
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
                    aria-label="Archivar"
                    className="text-critical hover:opacity-70"
                    onClick={() => {
                      if (confirm(`¿Archivar la tienda ${s.name}? Debe estar sin stock ni operaciones pendientes.`)) {
                        void httpsCallable(functions, 'archiveLocation')({ type: 'store', id: s.id }).catch((error: unknown) => flash(error instanceof Error ? error.message : 'No se pudo archivar'));
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
                    aria-label="Archivar"
                    className="text-critical hover:opacity-70"
                    onClick={() => {
                      if (confirm(`¿Archivar el almacén ${w.name}? Debe estar sin stock ni operaciones pendientes.`)) {
                        void httpsCallable(functions, 'archiveLocation')({ type: 'warehouse', id: w.id }).catch((error: unknown) => flash(error instanceof Error ? error.message : 'No se pudo archivar'));
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
              name: clean(fd.get('name')),
              code: (clean(fd.get('code')) || '').toUpperCase(),
              address: clean(fd.get('address'))
            };
            if (!data.name || !data.code) return flash('Error: nombre y código son obligatorios');
            void durableCommand('saveLocation', { ...data, type: 'store', ...(editingStore ? { id: editingStore.id } : {}) }).then(() => {
              setCreatingStore(false);
              setEditingStore(null);
              flash('Tienda guardada');
            }).catch((error: unknown) => flash(error instanceof Error ? error.message : 'No se pudo guardar'));
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
              name: clean(fd.get('name')),
              code: (clean(fd.get('code')) || '').toUpperCase(),
              isCentral: fd.get('isCentral') === 'on'
            };
            if (!data.name || !data.code) return flash('Error: nombre y código son obligatorios');
            void durableCommand('saveLocation', { ...data, type: 'warehouse', ...(editingWh ? { id: editingWh.id } : {}) }).then(() => {
              setCreatingWh(false);
              setEditingWh(null);
              flash('Almacén guardado');
            }).catch((error: unknown) => flash(error instanceof Error ? error.message : 'No se pudo guardar'));
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
