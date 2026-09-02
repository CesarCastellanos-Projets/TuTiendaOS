import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { collection, doc, onSnapshot, query, setDoc, limit, orderBy, where, getDocs, updateDoc } from 'firebase/firestore';
import { Layers, Plus, Search, Trash2, Barcode, Boxes, Tag } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useCompany } from '../../hooks/useCompany';
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

export function ProductsPage() {
  const company = useCompany();
  const [products, setProducts] = useState<(Product & { id: string })[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<(Partial<Product> & { id?: string }) | null>(null);
  const [presentations, setPresentations] = useState<(ProductPresentation & { salePriceInput?: string; factorInput?: string })[]>([]);
  const [basePriceInput, setBasePriceInput] = useState('');
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

  useEffect(() => {
    const q = query(collection(db, 'products'), orderBy('name'), limit(300));
    return onSnapshot(q, (snap) => setProducts(snap.docs.map((d) => ({ ...(d.data() as Product), id: d.id }))));
  }, []);

  const openEditModal = (p: Partial<Product> & { id?: string }) => {
    setEditing(p);
    setBasePriceInput(p.salePrice !== undefined ? String(p.salePrice) : '');
    setPresentations(
      p.presentations
        ? p.presentations.map((pr) => ({
            ...pr,
            salePriceInput: pr.salePrice !== undefined ? String(pr.salePrice) : '',
            factorInput: String(pr.factor || 1)
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
      const q = query(collection(db, 'product_stocks'), where('productId', '==', p.id));
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
      await updateDoc(doc(db, 'company', 'main'), {
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
        unit: 'CJA',
        factor: 12,
        factorInput: '12',
        barcode: '',
        salePrice: 0,
        salePriceInput: ''
      }
    ]);
  };

  const updatePresentationRow = (index: number, field: string, value: string) => {
    setPresentations((prev) => {
      const updated = [...prev];
      const current = { ...updated[index] };
      if (field === 'salePrice') {
        const sanitized = value.replace(/[^0-9.,]/g, '');
        current.salePriceInput = sanitized;
        current.salePrice = parseFloat(sanitized.replace(',', '.')) || 0;
      } else if (field === 'factor') {
        const sanitized = value.replace(/[^0-9]/g, '');
        current.factorInput = sanitized;
        current.factor = Math.max(1, parseInt(sanitized) || 1);
      } else if (field === 'unit') {
        current.unit = value;
        if (current.factorInput === '1' || current.factorInput === '12' || current.factorInput === '6' || !current.factorInput) {
          const defFactor = value === 'DOC' || value === 'CJA' ? '12' : value === 'PAQ' ? '6' : '1';
          current.factorInput = defFactor;
          current.factor = parseInt(defFactor);
        }
      } else if (field === 'barcode') {
        current.barcode = value;
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
    const mainUnit = (clean(fd.get('unit')) || 'UN') as Unit;

    // Filter and sanitize presentations
    const validPresentations: ProductPresentation[] = presentations
      .map((p) => {
        const rawPrice = p.salePriceInput !== undefined ? p.salePriceInput : String(p.salePrice || '');
        const priceNum = parseFloat(rawPrice.replace(',', '.')) || 0;
        const rawFactor = p.factorInput !== undefined ? p.factorInput : String(p.factor || 1);
        const factorNum = Math.max(1, parseInt(rawFactor) || 1);
        return {
          unit: p.unit.trim().toUpperCase(),
          barcode: (p.barcode || '').trim() || undefined,
          salePrice: Math.round(priceNum * 100) / 100,
          factor: factorNum
        };
      })
      .filter((p) => p.unit && p.salePrice > 0);

    const data: Product = {
      name: clean(fd.get('name')),
      category: clean(fd.get('category')) || 'General',
      brand: clean(fd.get('brand')),
      unit: mainUnit,
      internalCode: clean(fd.get('internalCode')),
      barcode: clean(fd.get('barcode')),
      salePrice: mainPrice,
      minStock: Math.trunc(num(fd.get('minStock'))),
      locationHint: clean(fd.get('locationHint')),
      promoLabel: clean(fd.get('promoLabel')),
      promoActive: fd.get('promoActive') === 'on',
      sunatCode: clean(fd.get('sunatCode')),
      active: fd.get('active') === 'on',
      presentations: validPresentations,
      updatedAt: Date.now()
    };

    if (!data.name || data.salePrice <= 0) {
      flash('Error: nombre y precio base son obligatorios');
      return;
    }

    try {
      const ref = editing?.id ? doc(db, 'products', editing.id) : doc(collection(db, 'products'));
      await setDoc(ref, data);
      setEditing(null);
      flash(editing?.id ? 'Producto actualizado con éxito' : 'Producto creado con éxito');
    } catch {
      flash('Error al guardar el producto');
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
                <th className="th">Código Base</th>
                <th className="th text-right">Precio Base</th>
                <th className="th">Presentaciones / Unidades</th>
                <th className="th">Promo</th>
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
                    <td className="td font-mono text-xs text-slate-700">{p.barcode || p.internalCode || '—'}</td>
                    <td className="td text-right font-mono font-bold text-slate-900">
                      S/ {p.salePrice.toFixed(2)} <span className="text-xs text-slate-400 font-normal">/{p.unit}</span>
                    </td>
                    <td className="td">
                      {p.presentations && p.presentations.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          <span className="badge bg-indigo-50 text-primary border border-indigo-200 text-[11px]">
                            {p.unit}: S/ {p.salePrice.toFixed(2)}
                          </span>
                          {p.presentations.map((pr, idx) => (
                            <span key={idx} className="badge bg-slate-100 text-slate-700 border border-slate-200 text-[11px]">
                              {pr.unit} {pr.factor && pr.factor > 1 ? `(x${pr.factor})` : ''}: S/ {pr.salePrice.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="badge bg-slate-100 text-slate-600 text-xs">{p.unit} (Única)</span>
                      )}
                    </td>
                    <td className="td">
                      {p.promoActive ? (
                        <span className="badge bg-amber-50 text-amber-800 border border-amber-200 font-bold">
                          {p.promoLabel || 'Promo'}
                        </span>
                      ) : (
                        '—'
                      )}
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
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-900 font-display flex items-center gap-1.5">
                  <Boxes size={15} className="text-primary" /> Unidades, Códigos de Barra y Precios
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Define la unidad base y agrega otras presentaciones (ej. Six Pack, Caja) con sus propios códigos y precios.
                </p>
              </div>

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
                  <select name="unit" defaultValue={editing?.unit ?? 'UN'} className="field !h-10 text-xs font-bold">
                    {availableUnits.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[11px] font-bold uppercase text-slate-600 block mb-1">Equivale a</label>
                  <input
                    type="text"
                    disabled
                    value="1 base"
                    title="La presentación base equivale a 1 unidad fundamental"
                    className="field !h-10 text-center font-mono font-bold text-xs bg-slate-100/80 text-slate-500 cursor-not-allowed"
                  />
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
                    key={index}
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 animate-in fade-in"
                  >
                    <div className="w-full sm:w-28 shrink-0">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block sm:hidden mb-0.5">Unidad</label>
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

                    <div className="w-full sm:w-28 shrink-0">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block sm:hidden mb-0.5">Equivale a (un)</label>
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

                    <div className="w-full sm:flex-1 relative">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block sm:hidden mb-0.5">Código de barras / QR</label>
                      <Barcode size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={pres.barcode ?? ''}
                        onChange={(e) => updatePresentationRow(index, 'barcode', e.target.value)}
                        placeholder="Escanea o escribe el código de barras de esta caja / pack…"
                        className="field !h-9 !pl-8 font-mono text-xs"
                      />
                    </div>

                    <div className="w-full sm:w-28 shrink-0">
                      <label className="text-[10px] font-bold uppercase text-slate-500 block sm:hidden mb-0.5">Precio S/</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={pres.salePriceInput !== undefined ? pres.salePriceInput : (pres.salePrice || '')}
                        onChange={(e) => updatePresentationRow(index, 'salePrice', e.target.value)}
                        placeholder="0.00"
                        className="field !h-9 font-mono font-bold text-xs"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removePresentationRow(index)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
                      title="Eliminar presentación"
                    >
                      <Trash2 size={15} />
                    </button>
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

          {/* 3. Datos de Inventario y Control */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Código Interno</label>
              <input
                name="internalCode"
                defaultValue={editing?.internalCode}
                placeholder="Ej.: PROD-001"
                className="field font-mono"
              />
            </div>
            <div>
              <label className="label">Stock Mínimo (Alerta)</label>
              <input
                name="minStock"
                type="number"
                min="0"
                defaultValue={editing?.minStock ?? 5}
                className="field font-mono"
              />
            </div>
            <div>
              <label className="label">Ubicación física (Góndola)</label>
              <input
                name="locationHint"
                defaultValue={editing?.locationHint}
                placeholder="Ej.: Pasillo 3, estante B"
                className="field"
              />
            </div>
            <div>
              <label className="label">Código Producto SUNAT</label>
              <input
                name="sunatCode"
                defaultValue={editing?.sunatCode}
                placeholder="Código estándar SUNAT (opcional)"
                className="field font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Etiqueta de Promo (Opcional)</label>
              <input
                name="promoLabel"
                defaultValue={editing?.promoLabel}
                placeholder="Ej.: 2x1 este mes, 20% descuento"
                className="field"
              />
            </div>
          </div>

          {/* 4. Checkboxes de Estado */}
          <div className="flex items-center gap-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-3.5">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                name="promoActive"
                defaultChecked={editing?.promoActive}
                className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
              />
              <span>Activar promoción en POS</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                name="active"
                defaultChecked={editing ? editing.active : true}
                className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
              />
              <span>Producto Activo (Habilitado para venta)</span>
            </label>
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
