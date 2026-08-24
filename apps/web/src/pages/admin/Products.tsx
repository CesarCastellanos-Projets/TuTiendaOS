import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, doc, onSnapshot, query, setDoc, limit, orderBy, where, getDocs } from 'firebase/firestore';
import { Layers, Plus, Search } from 'lucide-react';
import { db } from '../../lib/firebase';
import { clean, num } from '../../lib/utils';
import type { Product, ProductStock, Unit } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

const UNITS: Unit[] = ['UN', 'KG', 'LT', 'PAQ', 'CJA', 'DOC'];

export function ProductsPage() {
  const [products, setProducts] = useState<(Product & { id: string })[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<(Partial<Product> & { id?: string }) | null>(null);
  const [viewingStockProduct, setViewingStockProduct] = useState<(Product & { id: string }) | null>(null);
  const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name'), limit(300));
    return onSnapshot(q, (snap) => setProducts(snap.docs.map((d) => ({ ...(d.data() as Product), id: d.id }))));
  }, []);

  const openStockModal = async (p: Product & { id: string }) => {
    setViewingStockProduct(p);
    setLoadingStocks(true);
    try {
      const q = query(collection(db, 'product_stocks'), where('productId', '==', p.id));
      const snap = await getDocs(q);
      setProductStocks(snap.docs.map((d) => d.data() as ProductStock));
    } catch {
      flash('Error al cargar stocks');
    } finally {
      setLoadingStocks(false);
    }
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.barcode ?? '').includes(s) ||
        (p.internalCode ?? '').toLowerCase().includes(s) ||
        p.category.toLowerCase().includes(s)
    );
  }, [products, search]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: Product = {
      name: clean(fd.get('name')),
      category: clean(fd.get('category')) || 'General',
      brand: clean(fd.get('brand')),
      unit: (clean(fd.get('unit')) || 'UN') as Unit,
      internalCode: clean(fd.get('internalCode')),
      barcode: clean(fd.get('barcode')),
      salePrice: Math.round(num(fd.get('salePrice')) * 100) / 100,
      minStock: Math.trunc(num(fd.get('minStock'))),
      locationHint: clean(fd.get('locationHint')),
      promoLabel: clean(fd.get('promoLabel')),
      promoActive: fd.get('promoActive') === 'on',
      sunatCode: clean(fd.get('sunatCode')),
      active: fd.get('active') === 'on',
      updatedAt: Date.now()
    };
    if (!data.name || data.salePrice <= 0) {
      flash('Error: nombre y precio son obligatorios');
      return;
    }
    try {
      const ref = editing?.id ? doc(db, 'products', editing.id) : doc(collection(db, 'products'));
      await setDoc(ref, data);
      setEditing(null);
      flash(editing?.id ? 'Producto actualizado' : 'Producto creado');
    } catch {
      flash('Error al guardar el producto');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl uppercase tracking-wide">Productos</h1>
        <button className="btn-brand" onClick={() => setEditing({})}>
          <Plus size={16} /> Nuevo producto
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="field !pl-9"
          placeholder="Buscar por nombre, código o categoría"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Sin productos"
          hint="Registra tu catálogo para poder vender y controlar stock."
          action={
            <button className="btn-primary mt-2" onClick={() => setEditing({})}>
              Registrar primero
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Producto</th>
                <th className="th">Categoría</th>
                <th className="th">Código</th>
                <th className="th text-right">Precio</th>
                <th className="th">Promo</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-linea">
              {filtered.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'opacity-40'}>
                  <td className="td font-medium">{p.name}</td>
                  <td className="td">{p.category}</td>
                  <td className="td font-mono text-xs">{p.barcode || p.internalCode || '—'}</td>
                  <td className="td text-right font-mono">{p.salePrice.toFixed(2)}</td>
                  <td className="td">{p.promoActive ? <span className="badge bg-primary-hover">{p.promoLabel || 'Promo'}</span> : ''}</td>
                  <td className="td text-right flex items-center justify-end gap-2">
                    <button
                      className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                      onClick={() => void openStockModal(p)}
                      title="Ver stock en tiendas y almacenes"
                    >
                      <Layers size={13} /> Stock
                    </button>
                    <button className="text-sm font-semibold text-blue-600 hover:underline" onClick={() => setEditing(p)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Stock por Ubicación */}
      <Modal open={viewingStockProduct !== null} title={`Stock: ${viewingStockProduct?.name}`} onClose={() => setViewingStockProduct(null)}>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Existencia actual en cada tienda y almacén registrada en el sistema:
          </p>
          {loadingStocks ? (
            <p className="p-4 text-center text-sm text-slate-500">Cargando stock…</p>
          ) : productStocks.length === 0 ? (
            <p className="rounded-lg bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800">
              No hay stock registrado para este producto en ninguna ubicación.
            </p>
          ) : (
            <ul className="divide-y divide-linea rounded-lg border border-slate-200 bg-white">
              {productStocks.map((s) => (
                <li key={s.locationId} className="flex items-center justify-between p-3">
                  <div>
                    <p className="font-semibold text-sm">{s.locationName}</p>
                    <span className="badge bg-slate-100 text-xs text-slate-600 capitalize">
                      {s.locationType === 'warehouse' ? 'Almacén' : 'Tienda'}
                    </span>
                  </div>
                  <span className={`badge ${s.quantity === 0 ? 'bg-red-50 text-critical font-bold' : s.quantity <= (viewingStockProduct?.minStock ?? 5) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-success'}`}>
                    {s.quantity} unidades
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-right">
            <button className="btn-primary w-full sm:w-auto" onClick={() => setViewingStockProduct(null)}>
              Cerrar
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={editing !== null} title={editing?.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => setEditing(null)} wide>
        <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Nombre *</label>
            <input name="name" required defaultValue={editing?.name} className="field" />
          </div>
          <div>
            <label className="label">Categoría</label>
            <input name="category" defaultValue={editing?.category} className="field" />
          </div>
          <div>
            <label className="label">Marca</label>
            <input name="brand" defaultValue={editing?.brand} className="field" />
          </div>
          <div>
            <label className="label">Unidad</label>
            <select name="unit" defaultValue={editing?.unit ?? 'UN'} className="field">
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Precio venta S/ *</label>
            <input name="salePrice" type="number" step="0.10" min="0.10" required defaultValue={editing?.salePrice} className="field" />
          </div>
          <div>
            <label className="label">Código de barras</label>
            <input name="barcode" defaultValue={editing?.barcode} className="field font-mono" />
          </div>
          <div>
            <label className="label">Código interno</label>
            <input name="internalCode" defaultValue={editing?.internalCode} className="field font-mono" />
          </div>
          <div>
            <label className="label">Stock mínimo</label>
            <input name="minStock" type="number" min="0" defaultValue={editing?.minStock ?? 5} className="field" />
          </div>
          <div>
            <label className="label">Ubicación (góndola)</label>
            <input name="locationHint" defaultValue={editing?.locationHint} placeholder="Ej.: Pasillo 3, estante B" className="field" />
          </div>
          <div>
            <label className="label">Etiqueta de promo</label>
            <input name="promoLabel" defaultValue={editing?.promoLabel} className="field" />
          </div>
          <div>
            <label className="label">Código producto SUNAT</label>
            <input name="sunatCode" defaultValue={editing?.sunatCode} className="field" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="promoActive" defaultChecked={editing?.promoActive} /> En promoción
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="active" defaultChecked={editing ? editing.active : true} /> Activo
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button className="btn-primary">Guardar cambios</button>
          </div>
        </form>
      </Modal>

      <FlashBar msg={msg} />
    </div>
  );
}

