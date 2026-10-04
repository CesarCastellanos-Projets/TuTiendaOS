import { useRef, useState, type FormEvent } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Plus, Trash2 } from 'lucide-react';
import { functions } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { refreshProductsCatalog } from '../../lib/catalog-repository';
import { uncertainInventoryResult } from '../../lib/worker-inventory';
import { useCompany } from '../../hooks/useCompany';
import { Modal } from '../ui/Modal';
import type { Product, ProductPresentation } from '../../types';

const DEFAULT_UNITS = ['UN', 'KG', 'LT', 'PAQ', 'CJA', 'DOC', 'DISPLAY', 'TIRA', 'SACHET', 'BOLSA', 'LATA', 'BOTELLA', 'SOBRE'];

interface PresentationDraft {
  id: string; description: string; unit: string; factor: string; barcode: string; salePrice: string;
  autoUnpackEnabled: boolean; allowFractionalSale: boolean; fractionStep: string;
}

export function NewWorkerProduct({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const tenantId = useAuth((s) => s.profile!.tenantId);
  const company = useCompany();
  const units = [...new Set([...DEFAULT_UNITS, ...(company?.customUnits ?? [])])];
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState('UN');
  const [price, setPrice] = useState('');
  const [minStock, setMinStock] = useState('');
  const [presentations, setPresentations] = useState<PresentationDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ creationId: string; product: Product } | null>(null);
  const update = (id: string, patch: Partial<PresentationDraft>) => setPresentations((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!pending.current) {
      const product: Product = { name: name.trim(), category: category.trim() || 'General', brand: brand.trim(),
        barcode: barcode.trim(), unit, salePrice: Number(price), minStock: Number(minStock || 0), active: true,
        presentations: presentations.map((row, index) => ({ id: row.id, unit: row.unit, description: row.description.trim(),
          factor: Number(row.factor), barcode: row.barcode.trim(), salePrice: Number(row.salePrice),
          autoUnpackEnabled: row.autoUnpackEnabled, allowFractionalSale: row.allowFractionalSale,
          fractionStep: row.allowFractionalSale ? Number(row.fractionStep) : 0.5, autoUnpackPriority: index + 1 })) };
      if (!product.name || product.salePrice <= 0 || product.presentations?.some((row) => row.factor <= 1 || !Number.isInteger(row.factor) || row.salePrice <= 0)) {
        setError('Completa el nombre, los precios y el contenido de cada presentación.');
        return;
      }
      pending.current = { creationId: crypto.randomUUID(), product };
    }
    setBusy(true);
    setError('');
    try {
      await httpsCallable<{ creationId: string; product: Product }, { id: string; presentations: ProductPresentation[] }>(functions, 'saveCatalogProduct')(pending.current);
      pending.current = null;
      setRetry(false);
      setName(''); setCategory(''); setBrand(''); setBarcode(''); setPrice(''); setMinStock(''); setUnit('UN'); setPresentations([]);
      await refreshProductsCatalog(tenantId).catch(() => undefined);
      onSaved();
    } catch (cause) {
      const uncertain = uncertainInventoryResult(cause);
      setRetry(uncertain);
      if (!uncertain) pending.current = null;
      setError(`${cause instanceof Error ? cause.message : 'No se pudo crear el producto.'}${uncertain ? ' Reintenta para confirmar la misma creación.' : ''}`);
    } finally { setBusy(false); }
  };
  return <Modal open={open} title="Crear producto nuevo" wide onClose={() => { if (!busy) onClose(); }}>
    <form className="space-y-4" onSubmit={(event) => void save(event)}>
      <p className="text-sm text-slate-500">El producto se agrega al catálogo de la empresa. Su stock se registra después, al confirmar el ingreso en tu tienda.</p>
      <fieldset disabled={busy || retry} className="space-y-4">
        <label className="block"><span className="label">Nombre *</span><input className="field" required maxLength={180} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className="label">Categoría</span><input className="field" maxLength={80} value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label><span className="label">Marca</span><input className="field" maxLength={80} value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
          <label><span className="label">Unidad base</span><select className="field" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span className="label">Precio por unidad base (S/) *</span><input className="field" type="number" inputMode="decimal" required min="0.01" max="1000000" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label><span className="label">Código de barras base</span><input className="field" maxLength={80} value={barcode} onChange={(e) => setBarcode(e.target.value)} /></label>
          <label><span className="label">Stock mínimo</span><input className="field" type="number" min="0" max="1000000" step="1" value={minStock} placeholder="0" onChange={(e) => setMinStock(e.target.value)} /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Presentaciones de venta</h3><button className="btn-secondary" type="button" disabled={presentations.length >= 30} onClick={() => setPresentations((rows) => [...rows, { id: crypto.randomUUID(), description: '', unit: 'CJA', factor: '12', barcode: '', salePrice: '', autoUnpackEnabled: false, allowFractionalSale: false, fractionStep: '0.5' }])}><Plus size={16} /> Agregar presentación</button></div>
        {presentations.map((row) => <section key={row.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="label">Nombre de presentación</span><input className="field" maxLength={80} placeholder="Caja x12" value={row.description} onChange={(e) => update(row.id, { description: e.target.value })} /></label>
            <label><span className="label">Presentación</span><select className="field" value={row.unit} onChange={(e) => update(row.id, { unit: e.target.value })}>{units.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span className="label">Contiene ({unit}) *</span><input className="field" required type="number" min="2" max="1000000" step="1" value={row.factor} onChange={(e) => update(row.id, { factor: e.target.value })} /></label>
            <label><span className="label">Precio de presentación (S/) *</span><input className="field" required type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" value={row.salePrice} onChange={(e) => update(row.id, { salePrice: e.target.value })} /></label>
            <label className="sm:col-span-2"><span className="label">Código de barras de presentación</span><input className="field" maxLength={80} value={row.barcode} onChange={(e) => update(row.id, { barcode: e.target.value })} /></label>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={row.autoUnpackEnabled} onChange={(e) => update(row.id, { autoUnpackEnabled: e.target.checked, allowFractionalSale: e.target.checked && row.allowFractionalSale })} /> Abrir para vender unidades (compartir stock)</label>
          <div className="grid items-center gap-3 sm:grid-cols-2">
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={!row.autoUnpackEnabled} checked={row.allowFractionalSale} onChange={(e) => update(row.id, { allowFractionalSale: e.target.checked })} /> Permitir venta fraccionada</label>
            <label><span className="label">Paso permitido</span><input className="field" type="number" disabled={!row.allowFractionalSale} required={row.allowFractionalSale} min="0.001" max="0.999" step="0.001" value={row.fractionStep} onChange={(e) => update(row.id, { fractionStep: e.target.value })} /></label>
          </div>
          <button className="btn-secondary text-critical" type="button" onClick={() => setPresentations((rows) => rows.filter((item) => item.id !== row.id))}><Trash2 size={16} /> Quitar presentación</button>
        </section>)}
      </fieldset>
      {error && <p className="text-sm text-critical" role="alert">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2"><button className="btn-secondary" type="button" disabled={busy} onClick={onClose}>Cerrar</button><button className="btn-brand" type="submit" disabled={busy}>{busy ? 'Guardando…' : retry ? 'Reintentar la misma creación' : 'Crear producto'}</button></div>
    </form>
  </Modal>;
}
