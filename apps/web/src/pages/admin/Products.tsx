import { useMemo, useState, type FormEvent } from 'react';
import { query, where, getDocs, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Layers, Plus, Search, Trash2, Barcode, Boxes, Tag } from 'lucide-react';
import { useCompany } from '../../hooks/useCompany';
import { useProductsCatalog } from '../../hooks/useProductsCatalog';
import { refreshProductsCatalog } from '../../lib/catalog-repository';
import { requireCurrentTenantId, tenantCollection, tenantDoc } from '../../lib/tenant-firestore';
import { functions } from '../../lib/firebase';
import { clean, num } from '../../lib/utils';
import type { Product, ProductPresentation, ProductStock, Unit } from '../../types';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, FlashBar, useFlash } from '../../components/ui/Feedback';

const DEFAULT_UNITS: string[] = [
  'UN',
  'KG',
  'LT',
  'PAQ',
  'CJA',
  'DOC',
  'DISPLAY',
  'TIRA',
  'SACHET',
  'BOLSA',
  'LATA',
  'BOTELLA',
  'SOBRE'
];

function newPresentationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `pres-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ProductsPage() {
  const company = useCompany();
  const products = useProductsCatalog();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<(Partial<Product> & { id?: string }) | null>(null);
  const [presentations, setPresentations] = useState<(ProductPresentation & { salePriceInput?: string; factorInput?: string })[]>([]);
  const [basePriceInput, setBasePriceInput] = useState('');
  const [baseUnit, setBaseUnit] = useState<Unit>('UN');
  const [viewingStockProduct, setViewingStockProduct] = useState<(Product & { id: string }) | null>(null);
  const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [customUnitInput, setCustomUnitInput] = useState('');
  const [showAddUnitInput, setShowAddUnitInput] = useState(false);
  const { msg, flash } = useFlash();

  // Combine default units with company custom units
  const availableUnits = useMemo(() => {
    const list = new Set([...DEFAULT_UNITS, ...(company?.customUnits ?? [])]);
    return Array.from(list);
  }, [company?.customUnits]);

  const openEditModal = (p: Partial<Product> & { id?: string }) => {
    setEditing(p);
    setBasePriceInput(p.salePrice !== undefined ? String(p.salePrice) : '');
    setBaseUnit(p.unit ?? 'UN');
    setPresentations(
      p.presentations
        ? p.presentations.map((pr) => ({
            ...pr,
            salePriceInput: pr.salePrice !== undefined ? String(pr.salePrice) : '',
            id: pr.id || newPresentationId(),
            factorInput: String(pr.factor || 1),
            description: pr.description || `${pr.unit} x${pr.factor || 1}`,
            fractionStep: pr.fractionStep ?? 0.5,
            autoUnpackPriority: pr.autoUnpackPriority ?? 1
          }))
        : []
    );
    setShowAddUnitInput(false);
    setCustomUnitInput('');
  };

  const openStockModal = async (p: Product & { id: string }) => {
    setViewingStockProduct(p);
    setLoadingStocks(true);
    try {
      const q = query(tenantCollection('product_stocks'), where('productId', '==', p.id));
      const snap = await getDocs(q);
      setProductStocks(snap.docs.map((d) => d.data() as ProductStock));
    } catch {
      flash('Error al cargar stocks');
    } finally {
      setLoadingStocks(false);
    }
  };

  const handleAddCustomUnit = async () => {
    const u = customUnitInput.trim().toUpperCase();
    if (!u) return;
    if (availableUnits.includes(u)) {
      setShowAddUnitInput(false);
      setCustomUnitInput('');
      return;
    }
    try {
      const newUnits = [...(company?.customUnits ?? DEFAULT_UNITS), u];
      await updateDoc(tenantDoc('config', 'company'), {
        customUnits: Array.from(new Set(newUnits)),
        updatedAt: Date.now()
      });
      flash(`Nueva unidad "${u}" guardada exitosamente`);
      setCustomUnitInput('');
      setShowAddUnitInput(false);
    } catch {
      flash('No se pudo guardar la unidad en la base de datos');
    }
  };

  const addPresentationRow = () => {
    setPresentations((prev) => [
      ...prev,
      {
        id: newPresentationId(),
        unit: 'CJA',
        description: 'Caja x12',
        factor: 12,
        factorInput: '12',
        barcode: '',
        salePrice: 0,
        salePriceInput: '',
        allowFractionalSale: false,
        fractionStep: 0.5,
        autoUnpackEnabled: false,
        autoUnpackPriority: prev.length + 1
      }
    ]);
  };

  const updatePresentationRow = (index: number, field: string, value: string | boolean) => {
    setPresentations((prev) => {
      const updated = [...prev];
      const current = { ...updated[index] };
      if (field === 'salePrice') {
        const sanitized = String(value).replace(/[^0-9.,]/g, '');
        current.salePriceInput = sanitized;
        current.salePrice = parseFloat(sanitized.replace(',', '.')) || 0;
      } else if (field === 'factor') {
        const sanitized = String(value).replace(/[^0-9]/g, '');
        current.factorInput = sanitized;
        current.factor = Math.max(1, parseInt(sanitized) || 1);
      } else if (field === 'unit') {
        current.unit = String(value);
        if (current.factorInput === '1' || current.factorInput === '12' || current.factorInput === '6' || !current.factorInput) {
          const defFactor = value === 'DOC' || value === 'CJA' ? '12' : value === 'PAQ' ? '6' : '1';
          current.factorInput = defFactor;
          current.factor = parseInt(defFactor);
        }
      } else if (field === 'barcode') {
        current.barcode = String(value);
      } else if (field === 'description') {
        current.description = String(value);
      } else if (field === 'allowFractionalSale') {
        current.allowFractionalSale = Boolean(value);
      } else if (field === 'fractionStep') {
        current.fractionStep = Math.max(0.001, Math.min(0.999, Number(String(value).replace(',', '.')) || 0.5));
      } else if (field === 'autoUnpackEnabled') {
        current.autoUnpackEnabled = Boolean(value);
      } else if (field === 'autoUnpackPriority') {
        current.autoUnpackPriority = Math.max(1, Math.trunc(Number(value) || 1));
      }
      updated[index] = current;
      return updated;
    });
  };

  const removePresentationRow = (index: number) => {
    setPresentations((prev) => prev.filter((_, i) => i !== index));
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.barcode ?? '').includes(s) ||
        (p.internalCode ?? '').toLowerCase().includes(s) ||
        p.category.toLowerCase().includes(s) ||
        (p.presentations ?? []).some((pr) => (pr.barcode ?? '').includes(s) || pr.unit.toLowerCase().includes(s))
    );
  }, [products, search]);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const mainPrice = Math.round((parseFloat(basePriceInput.replace(',', '.')) || 0) * 100) / 100;
    const mainUnit = baseUnit;

    // Filter and sanitize presentations
    const validPresentations: ProductPresentation[] = presentations
      .map((p) => {
        const rawPrice = p.salePriceInput !== undefined ? p.salePriceInput : String(p.salePrice || '');
        const priceNum = parseFloat(rawPrice.replace(',', '.')) || 0;
        const rawFactor = p.factorInput !== undefined ? p.factorInput : String(p.factor || 1);
        const factorNum = Math.max(1, parseInt(rawFactor) || 1);
        return {
          id: p.id || newPresentationId(),
          unit: p.unit.trim().toUpperCase(),
          description: (p.description || `${p.unit} x${factorNum}`).trim(),
          barcode: (p.barcode || '').trim() || undefined,
          salePrice: Math.round(priceNum * 100) / 100,
          factor: factorNum,
          allowFractionalSale: p.allowFractionalSale === true,
          fractionStep: p.fractionStep ?? 0.5,
          autoUnpackEnabled: p.autoUnpackEnabled === true,
          autoUnpackPriority: p.autoUnpackPriority ?? 1
        };
      })
      .filter((p) => p.unit && p.salePrice > 0);

    const invalidFraction = validPresentations.find((presentation) =>
      presentation.allowFractionalSale
      && !Number.isInteger(Math.round((presentation.fractionStep ?? 0.5) * 1000) * presentation.factor / 1000)
    );
    if (invalidFraction) {
      flash(`El paso de ${invalidFraction.description || invalidFraction.unit} debe equivaler a unidades completas.`);
      return;
    }

    const data: Product = {
      tenantId: requireCurrentTenantId(),
      name: clean(fd.get('name')),
      category: clean(fd.get('category')) || 'General',
      brand: clean(fd.get('brand')),
      unit: mainUnit,
      barcode: clean(fd.get('barcode')),
      salePrice: mainPrice,
      minStock: Math.max(0, Math.trunc(num(fd.get('minStock')))),
      locationHint: clean(fd.get('locationHint')),
      active: fd.get('active') === 'on',
      presentations: validPresentations,
      updatedAt: Date.now()
    };

    if (!data.name || data.salePrice <= 0) {
      flash('Error: nombre y precio base son obligatorios');
      return;
    }

    try {
      const callable = httpsCallable<
        { productId?: string; product: Product },
        { id: string; presentations: ProductPresentation[] }
      >(functions, 'saveCatalogProduct');
      await callable({ productId: editing?.id, product: data });
      await refreshProductsCatalog(data.tenantId!);
      setEditing(null);
      flash(editing?.id ? 'Producto actualizado con éxito' : 'Producto creado con éxito');
    } catch (error) {
      flash(`Error: ${error instanceof Error ? error.message : 'no se pudo guardar el producto'}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Productos y Catálogo</h1>
          <p className="text-xs text-slate-500">
            Control de productos, múltiples unidades de venta, códigos de barra y precios.
          </p>
        </div>
        <button className="btn-brand" onClick={() => openEditModal({})}>
          <Plus size={16} /> Nuevo producto
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="field !pl-9"
          placeholder="Buscar por nombre, código de barra (cualquier unidad) o categoría…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Sin productos"
          hint="Registra tu catálogo para poder vender y controlar stock."
          action={
            <button className="btn-primary mt-2" onClick={() => openEditModal({})}>
              Registrar primer producto
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="border-b border-slate-200">
              <tr>
                <th className="th">Producto</th>
                <th className="th">Categoría</th>
                <th className="th">Código de Barras</th>
                <th className="th text-right">Precio Base</th>
                <th className="th">Presentaciones / Unidades</th>
                <th className="th">Ubicación / Mín.</th>
                <th className="th text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className={p.active ? 'hover:bg-slate-50/60' : 'opacity-40 hover:bg-slate-50/60'}>
                    <td className="td">
                      <p className="font-bold text-slate-900 leading-tight">{p.name}</p>
                      {p.brand && <span className="text-xs text-slate-400 font-medium">{p.brand}</span>}
                    </td>
                    <td className="td text-xs font-semibold text-slate-600">{p.category}</td>
                    <td className="td font-mono text-xs text-slate-700">{p.barcode || '—'}</td>
                    <td className="td text-right font-mono font-bold text-slate-900">
                      S/ {p.salePrice.toFixed(2)} <span className="text-xs text-slate-400 font-normal">/{p.unit}</span>
                    </td>
                    <td className="td">
                      {p.presentations && p.presentations.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          <span className="badge bg-indigo-50 text-primary border border-indigo-200 text-[11px]">
                            {p.unit}: S/ {p.salePrice.toFixed(2)}
                          </span>
                          {p.presentations.map((pr, index) => (
                            <span key={pr.id || `legacy-${index + 1}`} className="badge bg-slate-100 text-slate-700 border border-slate-200 text-[11px]">
                              {pr.description || `${pr.unit} x${pr.factor}`}: S/ {pr.salePrice.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-600 text-xs">{p.unit} (Única)</span>
                      )}
                    </td>
                    <td className="td">
                      {p.locationHint && (
                        <span className="text-xs font-medium text-slate-700 block truncate max-w-[140px]">
                          {p.locationHint}
                        </span>
                      )}
                      <span className="text-[11px] font-mono text-slate-400 block">
                        Mín: {p.minStock ?? 5} un.
                      </span>
                    </td>
                    <td className="td text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                          onClick={() => void openStockModal(p)}
                          title="Ver existencias en almacenes y tiendas"
                        >
                          <Layers size={14} /> Stock
                        </button>
                        <button
                          className="btn-ghost !min-h-[32px] !px-3 !py-1 text-xs font-bold text-primary"
                          onClick={() => openEditModal(p)}
                        >
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── MODAL STOCK POR UBICACIÓN ───────────────────────────────────────── */}
      <Modal
        open={viewingStockProduct !== null}
        title={`Stock Actual: ${viewingStockProduct?.name}`}
        onClose={() => setViewingStockProduct(null)}
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Existencia actual en cada tienda y almacén registrada en el sistema:
          </p>
          {loadingStocks ? (
            <p className="p-4 text-center text-sm text-slate-500">Cargando existencias…</p>
          ) : productStocks.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-xs font-bold text-amber-900">
              No hay stock registrado para este producto en ninguna ubicación.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
              {productStocks.map((s) => (
                <li key={s.locationId} className="flex items-center justify-between p-3.5">
                  <div>
                    <p className="font-bold text-sm text-slate-900">{s.locationName}</p>
                    <span className="badge bg-slate-100 text-xs text-slate-600 font-semibold capitalize mt-0.5">
                      {s.locationType === 'warehouse' ? 'Almacén' : 'Tienda'}
                    </span>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Sueltas: {s.baseQuantity ?? s.quantity}
                      {(viewingStockProduct?.presentations ?? []).map((presentation, index) => {
                        const presentationId = presentation.id || `legacy-${index + 1}`;
                        return ` · ${presentation.description || presentation.unit}: ${s.presentationQuantities?.[presentationId] ?? 0}`;
                      })}
                    </p>
                  </div>
                  <span
                    className={`badge text-xs font-mono font-bold ${
                      s.quantity === 0
                        ? 'bg-red-50 text-critical'
                        : s.quantity <= (viewingStockProduct?.minStock ?? 5)
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-50 text-success'
                    }`}
                  >
                    {s.quantity} unidades
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-right">
            <button className="btn-primary w-full sm:w-auto" onClick={() => setViewingStockProduct(null)}>
              Cerrar
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── MODAL CREAR / EDITAR PRODUCTO (CON MULTI-PRESENTACIÓN) ─────────── */}
      <Modal
        open={editing !== null}
        title={editing?.id ? 'Editar producto' : 'Nuevo producto'}
        onClose={() => setEditing(null)}
        wide
      >
        <form onSubmit={save} className="space-y-5">
          {/* 1. Datos Principales del Producto */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 font-display flex items-center gap-1.5">
              <Tag size={15} className="text-primary" /> Información Base del Producto
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Nombre del Producto *</label>
                <input
                  name="name"
                  required
                  defaultValue={editing?.name}
                  placeholder="Ej.: Gaseosa Cola 500ml"
                  className="field"
                />
              </div>
              <div>
                <label className="label">Categoría</label>
                <input
                  name="category"
                  defaultValue={editing?.category}
                  placeholder="Ej.: Bebidas, Abarrotes"
                  className="field"
                />
              </div>
              <div>
                <label className="label">Marca</label>
                <input
                  name="brand"
                  defaultValue={editing?.brand}
                  placeholder="Ej.: Don Victor, Gloria"
                  className="field"
                />
              </div>
            </div>
          </div>

          {/* 2. Unidad Base y Presentaciones de Venta */}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-950 font-display flex items-center gap-1.5">
                <Boxes size={16} className="text-primary" /> Presentaciones y Precios
              </span>

              {/* Botón para agregar unidad personalizada al catálogo */}
              <button
                type="button"
                onClick={() => setShowAddUnitInput(!showAddUnitInput)}
                className="text-xs font-bold text-primary hover:underline"
              >
                {showAddUnitInput ? 'Ocultar' : '+ Crear nueva unidad'}
              </button>
            </div>

            {/* Input para nueva unidad personalizada */}
            {showAddUnitInput && (
              <div className="flex gap-2 rounded-xl border border-indigo-200 bg-white p-2.5 animate-in fade-in">
                <input
                  value={customUnitInput}
                  onChange={(e) => setCustomUnitInput(e.target.value)}
                  placeholder="Escribe la unidad (Ej. BALDE, TIRA, DISPLAY)…"
                  className="field !h-9 text-xs uppercase"
                />
                <button
                  type="button"
                  onClick={() => void handleAddCustomUnit()}
                  className="btn-primary shrink-0 !h-9 !px-3 text-xs font-bold"
                >
                  Guardar unidad
                </button>
              </div>
            )}

            {/* Fila 1: Presentación Principal / Unidad Base */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="badge bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider">
                  Presentación Base (Por Defecto)
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                <div className="sm:col-span-3">
                  <label className="text-[11px] font-bold uppercase text-slate-600 block mb-1">Unidad Base *</label>
                  <select name="unit" value={baseUnit} onChange={(event) => setBaseUnit(event.target.value)} className="field !h-10 text-xs font-bold">
                    {availableUnits.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-bold uppercase text-slate-600 block mb-1">Contiene</label>
                  <div className="field !h-10 flex items-center justify-center text-xs font-bold text-slate-600">1 unidad base</div>
                </div>
                <div className="sm:col-span-4">
                  <label className="text-[11px] font-bold uppercase text-slate-600 block mb-1">Código de Barras</label>
                  <div className="relative">
                    <Barcode size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      name="barcode"
                      defaultValue={editing?.barcode}
                      placeholder="Escanea o escribe código…"
                      className="field !h-10 !pl-8 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <label className="text-[11px] font-bold uppercase text-slate-600 block mb-1">Precio Venta S/ *</label>
                  <input
                    name="salePrice"
                    type="text"
                    inputMode="decimal"
                    required
                    value={basePriceInput}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.,]/g, '');
                      setBasePriceInput(val);
                    }}
                    placeholder="0.00"
                    className="field !h-10 font-mono font-bold text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Presentaciones Adicionales */}
            {presentations.length > 0 && (
              <div className="space-y-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 block">
                  Presentaciones Secundarias (Packs, Cajas, Docenas)
                </span>
                {presentations.map((pres, index) => (
                  <div
                    key={pres.id}
                    className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 animate-in fade-in sm:grid-cols-12"
                  >
                    <div className="sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Nombre de la presentación</label>
                      <input
                        value={pres.description ?? ''}
                        onChange={(e) => updatePresentationRow(index, 'description', e.target.value)}
                        placeholder={`Ej.: ${pres.unit} x${pres.factor}`}
                        className="field !h-9 text-xs font-semibold"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Presentación</label>
                      <select
                        value={pres.unit}
                        onChange={(e) => updatePresentationRow(index, 'unit', e.target.value)}
                        className="field !h-9 text-xs font-bold"
                      >
                        {availableUnits.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Contiene ({baseUnit})</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={pres.factorInput !== undefined ? pres.factorInput : (pres.factor ?? 12)}
                        onChange={(e) => updatePresentationRow(index, 'factor', e.target.value)}
                        placeholder="12"
                        title="Cuántas unidades base contiene este empaque"
                        className="field !h-9 font-mono font-bold text-xs text-center"
                      />
                    </div>

                    <div className="relative sm:col-span-4">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Código de barras / QR</label>
                      <Barcode size={14} className="pointer-events-none absolute left-3 top-[2rem] -translate-y-1/2 text-slate-400" />
                      <input
                        value={pres.barcode ?? ''}
                        onChange={(e) => updatePresentationRow(index, 'barcode', e.target.value)}
                        placeholder="Escanea o escribe el código de barras de esta caja / pack…"
                        className="field !h-9 !pl-8 font-mono text-xs"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-0.5">Precio por {pres.unit.toLowerCase()} S/</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pres.salePriceInput !== undefined ? pres.salePriceInput : (pres.salePrice || '')}
                        onChange={(e) => updatePresentationRow(index, 'salePrice', e.target.value)}
                        placeholder="0.00"
                        className="field !h-9 font-mono font-bold text-xs"
                      />
                    </div>

                    <div className="sm:col-span-9 grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-3">
                      <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={pres.allowFractionalSale === true} onChange={(e) => updatePresentationRow(index, 'allowFractionalSale', e.target.checked)} />
                        Permitir venta fraccionada
                      </label>
                      <label className="text-[10px] font-bold uppercase text-slate-500">
                        Paso permitido
                        <input type="number" min="0.001" max="0.999" step="0.001" disabled={!pres.allowFractionalSale} value={pres.fractionStep ?? 0.5} onChange={(e) => updatePresentationRow(index, 'fractionStep', e.target.value)} className="field mt-1 !h-9 text-center text-xs" />
                      </label>
                      <label className="flex min-h-11 items-center gap-2 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={pres.autoUnpackEnabled === true} onChange={(e) => updatePresentationRow(index, 'autoUnpackEnabled', e.target.checked)} />
                        Abrir para vender unidades
                      </label>
                    </div>
                    <div className="flex items-end gap-2 sm:col-span-3">
                      <label className="flex-1 text-[10px] font-bold uppercase text-slate-500">
                        Prioridad de apertura
                        <input type="number" min="1" value={pres.autoUnpackPriority ?? index + 1} onChange={(e) => updatePresentationRow(index, 'autoUnpackPriority', e.target.value)} className="field mt-1 !h-9 text-center text-xs" />
                      </label>
                      <button type="button" onClick={() => removePresentationRow(index)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-critical transition-colors" title="Eliminar presentación">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <p className="sm:col-span-12 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-950">
                      1 {pres.unit} = {pres.factor} {baseUnit} · S/ {(pres.salePrice || 0).toFixed(2)} por {pres.unit.toLowerCase()}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Botón para añadir otra fila de presentación */}
            <button
              type="button"
              onClick={addPresentationRow}
              className="btn-ghost w-full !min-h-[38px] !py-2 text-xs font-bold border-dashed border-indigo-200 text-primary hover:bg-indigo-50/50"
            >
              <Plus size={15} /> Agregar otra unidad con su código y precio
            </button>
          </div>

          {/* 3. Control de Stock y Ubicación Física */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Stock Mínimo (Alerta de Reposición)</label>
              <input
                name="minStock"
                type="number"
                min="0"
                defaultValue={editing?.minStock ?? 5}
                placeholder="Ej.: 5"
                className="field font-mono"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Avisa cuando el stock baje de este umbral
              </span>
            </div>
            <div>
              <label className="label">Ubicación física (Góndola / Pasillo)</label>
              <input
                name="locationHint"
                defaultValue={editing?.locationHint}
                placeholder="Ej.: Pasillo 3, estante B"
                className="field"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Ayuda al personal a ubicar el producto en tienda
              </span>
            </div>
          </div>

          {/* 4. Estado del Producto */}
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
            <label className="flex items-center gap-2.5 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing ? editing.active : true}
                className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
              />
              <span>Producto Activo (Habilitado para venta en POS)</span>
            </label>
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Desmarca para pausar su venta sin borrarlo
            </span>
          </div>

          {/* Botones de Acción */}
          <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
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
