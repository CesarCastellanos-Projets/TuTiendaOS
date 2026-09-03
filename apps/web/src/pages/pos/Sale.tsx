import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  Camera,
  CheckCircle2,
  DollarSign,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Trash2,
  User,
  Building2,
  X,
  Printer,
  Sparkles,
  AlertCircle,
  Vault,
  ScanLine,
  Calculator,
  WalletCards,
  FileText
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';
import { findInCatalog, useCatalogSearch, useStoreCatalog } from '../../hooks/useStoreCatalog';
import { useScanner, WedgeInput } from '../../hooks/useScanner';
import { createSale } from '../../lib/sales';
import { sendToSunat } from '../../services/sunat';
import { lookupClient } from '../../services/ruc';
import { ticketHtml, printTicket } from '../../lib/print';
import type { CashSession, ClientDoc, PaymentMethod, ProductStock, SaleItem, Quotation } from '../../types';
import { DNI_RE, money, RUC_RE } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';

interface CartLine extends SaleItem {
  lineId: string;
  stock: number;
  promo?: boolean;
}

const BANKS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Caja Huancayo', 'Caja Arequipa', 'Banco de la Nación', 'Otro'];

const PAYMENTS: { id: PaymentMethod; label: string; icon: any; colorClass: string }[] = [
  { id: 'efectivo', label: 'Efectivo', icon: DollarSign, colorClass: 'border-emerald-500 text-emerald-700 bg-emerald-50/70' },
  { id: 'transferencia', label: 'Transferencia', icon: Building2, colorClass: 'border-blue-500 text-blue-700 bg-blue-50/70' },
  { id: 'yape', label: 'Yape', icon: QrCode, colorClass: 'border-purple-600 text-purple-700 bg-purple-50/70' },
  { id: 'plin', label: 'Plin', icon: QrCode, colorClass: 'border-cyan-500 text-cyan-700 bg-cyan-50/70' },
  { id: 'sip', label: 'Sip', icon: WalletCards, colorClass: 'border-amber-500 text-amber-700 bg-amber-50/70' }
];

export function PosSale() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const company = useCompany();
  const storeId = profile.storeId!;
  const { items: catalog, products } = useStoreCatalog(storeId);
  const searchIn = useCatalogSearch(catalog);

  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem(`denzoz_pos_cart_${storeId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.cart)) return parsed.cart;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [term, setTerm] = useState('');
  const [clientDoc, setClientDoc] = useState<ClientDoc>(() => {
    try {
      const saved = localStorage.getItem(`denzoz_pos_cart_${storeId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.clientDoc) return parsed.clientDoc;
      }
    } catch {
      // ignore
    }
    return { tipo: '-', numero: '', nombre: '' };
  });
  const [payment, setPayment] = useState<PaymentMethod>('efectivo');
  const [paid, setPaid] = useState('');
  const [bankName, setBankName] = useState('BCP');
  const [docType, setDocType] = useState<'boleta' | 'factura' | 'nota'>(() => {
    try {
      const saved = localStorage.getItem(`denzoz_pos_cart_${storeId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.docType) return parsed.docType;
      }
    } catch {
      // ignore
    }
    return 'boleta';
  });
  const [dniModal, setDniModal] = useState(false);
  const [rucValue, setRucValue] = useState('');
  const [dniValue, setDniValue] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [receiptDone, setReceiptDone] = useState<{ code: string; total: number; change: number; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionOpen, setSessionOpen] = useState<(CashSession & { id: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [storeName, setStoreName] = useState('Tienda');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');

  // Cotizaciones
  const [quoteModal, setQuoteModal] = useState(false);
  const [quotesList, setQuotesList] = useState<Quotation[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const openQuoteModal = async () => {
    setQuoteModal(true);
    setLoadingQuotes(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'quotations'), orderBy('createdAt', 'desc'), limit(20))
      );
      setQuotesList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Quotation)));
    } catch {
      // fallback
    } finally {
      setLoadingQuotes(false);
    }
  };

  const loadQuoteIntoCart = (q: Quotation) => {
    const newCart: CartLine[] = [];
    for (const item of q.items) {
      const inCat = catalog.find((c) => c.productId === item.productId);
      const stock = inCat ? inCat.quantity : item.availableQty;
      const effectiveQty = Math.max(1, item.qty);
      const lineId = `${item.productId}_${item.barcode || 'base'}_${item.unitPrice}`;
      newCart.push({
        lineId,
        productId: item.productId,
        name: item.name,
        qty: effectiveQty,
        unitPrice: item.unitPrice,
        total: round2(effectiveQty * item.unitPrice),
        stock: stock,
        presentationUnit: item.unit,
        factor: 1,
        barcode: item.barcode
      });
    }
    setCart(newCart);
    if (q.clientName && q.clientName !== 'Cliente Cotización') {
      setClientDoc({ tipo: '-', numero: '', nombre: q.clientName });
    }
    setQuoteModal(false);
  };

  useEffect(() => {
    void getDoc(doc(db, 'stores', storeId)).then((s) => {
      if (s.exists()) setStoreName((s.data() as { name: string }).name);
    });
  }, [storeId]);
  const busyRef = useRef(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, 'cash_sessions'), where('userId', '==', user?.uid ?? ''), where('status', '==', 'abierta'), limit(1)),
      (s) => setSessionOpen(s.empty ? null : ({ ...(s.docs[0].data() as CashSession), id: s.docs[0].id }))
    );
  }, [user?.uid]);

  // Guardar automáticamente el carrito y datos de venta en localStorage para protección ante apagones o cierres
  useEffect(() => {
    if (!storeId) return;
    try {
      if (cart.length > 0 || clientDoc.tipo !== '-' || docType !== 'boleta') {
        localStorage.setItem(
          `denzoz_pos_cart_${storeId}`,
          JSON.stringify({ cart, clientDoc, docType, savedAt: Date.now() })
        );
      } else {
        localStorage.removeItem(`denzoz_pos_cart_${storeId}`);
      }
    } catch {
      // ignore
    }
  }, [cart, clientDoc, docType, storeId]);

  // Sincronizar stock del catálogo en los ítems del carrito recuperados
  useEffect(() => {
    if (cart.length === 0 || catalog.length === 0) return;
    setCart((prev) =>
      prev.map((line) => {
        const found = catalog.find((c) => c.productId === line.productId);
        return found && found.quantity !== line.stock ? { ...line, stock: found.quantity } : line;
      })
    );
  }, [catalog]);

  const total = useMemo(() => cart.reduce((s, l) => s + l.total, 0), [cart]);
  const change = Math.max(0, (Number(paid) || 0) - total);

  // Extract categories for fast filter chips
  const categories = useMemo(() => {
    const set = new Set<string>();
    catalog.forEach((p) => {
      if (p.locationName) set.add(p.locationName);
    });
    return Array.from(set);
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    if (selectedCategory === 'todos') return catalog;
    return catalog.filter((p) => p.locationName === selectedCategory);
  }, [catalog, selectedCategory]);

  function addToCart(p: ProductStock & { presentationUnit?: string; factor?: number }): void {
    setError(null);
    const factor = p.factor || 1;
    const lineId = `${p.productId}_${p.barcode || 'base'}_${p.salePrice}`;

    setCart((prev) => {
      const currentAllocated = prev
        .filter((l) => l.productId === p.productId)
        .reduce((sum, l) => sum + l.qty * (l.factor || 1), 0);

      if (currentAllocated + factor > p.quantity) {
        setError(`Stock insuficiente: quedan ${p.quantity} unidades base de ${p.productName}`);
        return prev;
      }

      const existing = prev.find((l) => l.lineId === lineId);
      if (existing) {
        return prev.map((l) =>
          l.lineId === lineId
            ? { ...l, qty: l.qty + 1, total: round2((l.qty + 1) * l.unitPrice) }
            : l
        );
      }

      if (p.quantity < factor) {
        setError(`${p.productName} sin stock disponible`);
        return prev;
      }

      return [
        ...prev,
        {
          lineId,
          productId: p.productId,
          name: p.productName,
          qty: 1,
          unitPrice: p.salePrice,
          total: round2(p.salePrice),
          stock: p.quantity,
          presentationUnit: p.presentationUnit,
          factor,
          barcode: p.barcode ?? undefined
        }
      ];
    });
  }

  const scanCode = (code: string) => {
    void findInCatalog(storeId, code, catalog).then((p) => {
      if (p) {
        addToCart(p);
        if (navigator.vibrate) navigator.vibrate(80);
      } else {
        setError(`Código no encontrado: ${code}`);
      }
    });
  };

  const scanner = useScanner(scanCode);
  const results = term.trim().length >= 2 ? searchIn(term) : [];

  async function doRucLookup(): Promise<void> {
    if (!RUC_RE.test(rucValue)) {
      setError('El RUC debe tener exactamente 11 dígitos');
      return;
    }
    setLookupBusy(true);
    try {
      const c = await lookupClient('RUC', rucValue);
      setClientDoc({ tipo: 'RUC', numero: c.numero, nombre: c.nombre });
      setDocType('factura');
      setDniModal(false);
    } catch {
      setClientDoc({ tipo: 'RUC', numero: rucValue, nombre: `CLIENTE RUC ${rucValue}` });
      setDocType('factura');
      setDniModal(false);
      setError('No se pudo autocompletar la razón social desde la API. Se asignó el RUC para la factura.');
    } finally {
      setLookupBusy(false);
    }
  }

  async function doDniSave(): Promise<void> {
    if (!dniValue.trim()) {
      setDniModal(false);
      setClientDoc({ tipo: '-', numero: '', nombre: '' });
      return;
    }
    if (!DNI_RE.test(dniValue)) {
      setError('El DNI debe tener 8 dígitos numéricos');
      return;
    }
    setLookupBusy(true);
    try {
      const c = await lookupClient('DNI', dniValue).catch(() => null);
      setClientDoc({
        tipo: 'DNI',
        numero: dniValue,
        nombre: c?.nombre ?? `CLIENTE DNI ${dniValue}`
      });
      if (docType === 'factura') setDocType('boleta');
      setDniModal(false);
    } finally {
      setLookupBusy(false);
    }
  }

  async function checkout(): Promise<void> {
    if (busyRef.current || !user || cart.length === 0) return;
    const minSinDni = company?.minBoletaSinDni ?? 700;
    const umbralConsol = company?.umbralConsolidacion ?? 5;

    if (total <= 0) {
      setError('Agrega al menos un producto al carrito para cobrar.');
      return;
    }
    if (payment === 'efectivo' && (Number(paid) || 0) < total - 0.001) {
      setError('El monto pagado en efectivo no puede ser menor al total.');
      return;
    }
    if (docType === 'factura' && clientDoc.tipo !== 'RUC') {
      setError('Para emitir Factura Electrónica se requiere RUC y Razón Social.');
      setDniModal(true);
      return;
    }
    if (docType === 'boleta' && total >= minSinDni && clientDoc.tipo !== 'DNI') {
      setError(`Ventas desde S/ ${minSinDni.toFixed(2)} exigen DNI en Boleta.`);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const sale = await createSale({
        company: company!,
        storeId,
        storeName,
        profile,
        uid: user.uid,
        clientDoc,
        items: cart.map(({ productId, name, qty, unitPrice, total, presentationUnit, factor, barcode }) => ({
          productId,
          name,
          qty,
          unitPrice,
          total,
          presentationUnit,
          factor: factor || 1,
          barcode
        })),
        paymentMethod: payment,
        bankName: payment === 'transferencia' ? bankName : null,
        operationNumber: null,
        paidAmount: payment === 'efectivo' ? Number(paid) || total : total,
        consolidated: docType === 'boleta' && total < umbralConsol,
        cashSessionId: sessionOpen?.id,
        type: docType
      });

      setReceiptDone({
        code: sale.code,
        total: sale.total,
        change: sale.changeAmount,
        html: ticketHtml(sale, company ?? undefined)
      });

      setCart([]);
      setPaid('');
      setClientDoc({ tipo: '-', numero: '', nombre: '' });
      setDocType('boleta');
      try {
        localStorage.removeItem(`denzoz_pos_cart_${storeId}`);
      } catch {
        // ignore
      }

      if (docType !== 'nota') {
        void sendToSunat(sale.code, sale);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar la venta.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col lg:flex-row overflow-hidden bg-slate-100/60">
      {/* ─── COLUMNA IZQUIERDA: CATÁLOGO Y BÚSQUEDA ───────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-b border-slate-200 lg:border-b-0 lg:border-r bg-white">
        {/* Banner de Estado de Caja */}
        {!sessionOpen && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs font-semibold text-amber-900">
            <div className="flex items-center gap-2">
              <Vault size={16} className="text-amber-700 shrink-0" />
              <span>Turno de caja cerrado. Abre tu caja para habilitar ventas.</span>
            </div>
            <a href="/pos/caja" className="underline font-bold text-amber-950 hover:text-amber-800">
              Abrir caja
            </a>
          </div>
        )}

        {/* Barra de Búsqueda y Escáner */}
        <div className="border-b border-slate-100 p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <WedgeInput
                onSubmit={scanCode}
                placeholder="Escanea con pistola o escribe código (Enter)…"
                className="field !pl-10 !h-12 !text-base font-medium shadow-xs"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 hidden sm:inline">
                Pistola USB
              </span>
            </div>

            <button
              className={`btn shrink-0 !h-12 !px-4 ${scanner.cameraOpen ? 'btn-brand' : 'btn-ghost'}`}
              title="Escanear con cámara"
              onClick={() => (scanner.cameraOpen ? scanner.stop() : scanner.startCamera())}
            >
              <Camera size={20} />
              <span className="hidden sm:inline text-xs font-bold">Cámara</span>
            </button>
          </div>

          {/* Visor de Cámara PWA con animación de escáner */}
          {scanner.cameraOpen && (
            <div className="relative overflow-hidden rounded-2xl border-2 border-primary bg-slate-950 shadow-xl">
              <div className="absolute inset-x-0 z-10 h-0.5 bg-primary shadow-lg shadow-primary animate-laser" />
              <video
                id={scanner.videoId}
                autoPlay
                playsInline
                muted
                className="w-full h-64 object-cover bg-black"
              />
              <div className="absolute bottom-3 inset-x-0 flex justify-center z-10">
                <span className="rounded-full bg-slate-900/80 backdrop-blur-md px-3 py-1 text-xs font-medium text-white flex items-center gap-1.5">
                  <ScanLine size={14} className="text-primary" /> Apunta al código de barras
                </span>
              </div>
            </div>
          )}

          {scanner.error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 p-2.5 text-xs font-semibold text-critical">
              <AlertCircle size={15} />
              <span>{scanner.error}</span>
            </div>
          )}

          {/* Buscador Rápido por Nombre o Código */}
          <div className="relative">
            <input
              className="field !h-10 text-sm bg-slate-50/70"
              placeholder="Buscar por nombre o código de barras (Enter)…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && term.trim()) {
                  e.preventDefault();
                  scanCode(term.trim());
                  setTerm('');
                }
              }}
              autoComplete="off"
            />
            {results.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in">
                {results.map((p) => (
                  <li key={p.searchKey}>
                    <button
                      onClick={() => {
                        addToCart(p);
                        setTerm('');
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-indigo-50/60 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="truncate font-medium text-slate-800 block">{p.productName}</span>
                        {p.barcode && (
                          <span className="text-[10px] font-mono text-slate-400 block">
                            Código: {p.barcode}
                          </span>
                        )}
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        <span className={`badge ${p.quantity <= 5 ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                          {p.quantity} en stock
                        </span>
                        <span className="price-tag text-base font-mono font-bold text-primary">
                          {money(p.salePrice)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Filtros por Categoría */}
          {categories.length > 0 && (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedCategory('todos')}
                className={`shrink-0 rounded-xl px-3 py-1 text-xs font-bold transition-all ${
                  selectedCategory === 'todos'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Todos los productos
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`shrink-0 rounded-xl px-3 py-1 text-xs font-bold transition-all ${
                    selectedCategory === cat
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mensaje de Error en POS */}
        {error && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-critical animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Grilla Visual de Productos */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filteredCatalog.map((p) => {
              const isOutOfStock = p.quantity < 1;
              const isLowStock = p.quantity > 0 && p.quantity <= 5;
              const prodDef = products.find((pr) => pr.id === p.productId);
              const extraPres = prodDef?.presentations?.filter((pr) => pr.salePrice > 0) || [];

              return (
                <div
                  key={p.productId}
                  className={`card flex flex-col justify-between p-3 text-left transition-all ${
                    isOutOfStock ? 'opacity-50 !border-dashed' : 'hover:border-primary/50 shadow-xs'
                  }`}
                >
                  <div className="space-y-1">
                    <span className="line-clamp-2 text-xs font-bold text-slate-800 leading-snug">
                      {p.productName}
                    </span>
                    {p.locationName && (
                      <span className="text-[10px] font-medium text-slate-400 block truncate">
                        {p.locationName}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-end justify-between gap-1">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block leading-none">
                          Precio base
                        </span>
                        <span className="price-tag font-mono text-base font-extrabold text-slate-900 leading-tight">
                          S/ {p.salePrice.toFixed(2)}
                        </span>
                      </div>

                      <span
                        className={`badge text-[10px] ${
                          isOutOfStock
                            ? 'bg-red-50 text-critical'
                            : isLowStock
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-success'
                        }`}
                      >
                        {isOutOfStock ? 'Agotado' : `${p.quantity} un.`}
                      </span>
                    </div>

                    {/* Botones de acción rápida por unidad */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      <button
                        type="button"
                        onClick={() => addToCart(p)}
                        disabled={isOutOfStock}
                        className="flex-1 min-w-[70px] rounded-lg bg-slate-100 hover:bg-primary hover:text-white px-1.5 py-1 text-[10px] font-bold text-slate-700 transition-colors disabled:opacity-40 truncate text-center"
                        title="Agregar unidad base"
                      >
                        + {prodDef?.unit || 'UN'} (S/ {p.salePrice.toFixed(2)})
                      </button>

                      {extraPres.map((pr, idx) => {
                        const label = pr.factor && pr.factor > 1 ? `${pr.unit} x${pr.factor}` : pr.unit;
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={isOutOfStock}
                            onClick={() =>
                              addToCart({
                                ...p,
                                productName: `${p.productName} (${label})`,
                                salePrice: pr.salePrice,
                                barcode: pr.barcode ?? undefined,
                                presentationUnit: pr.unit,
                                factor: pr.factor || 1
                              })
                            }
                            className="flex-1 min-w-[70px] rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-primary hover:text-white px-1.5 py-1 text-[10px] font-bold text-primary transition-colors disabled:opacity-40 truncate text-center"
                            title={`Agregar ${label}`}
                          >
                            + {label} (S/ {pr.salePrice.toFixed(2)})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredCatalog.length === 0 && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-slate-400">
              <ShoppingCart size={32} className="opacity-40" />
              <p className="text-sm font-semibold">No hay productos en esta categoría</p>
            </div>
          )}
        </div>
      </section>

      {/* ─── COLUMNA DERECHA: PANEL DEL TICKET / CARRITO ───────────────────────── */}
      <aside className="flex w-full shrink-0 flex-col bg-slate-50/90 lg:w-[420px] xl:w-[460px] border-l border-slate-200 shadow-sm">
        {/* Cabecera del Ticket */}
        <div className="border-b border-slate-200 bg-white p-4 space-y-3">
          {/* Segmented Control Boleta / Factura / Nota de Venta */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 text-xs font-bold gap-1">
              <button
                type="button"
                className={`flex-1 rounded-lg py-1.5 transition-all text-center ${
                  docType === 'boleta'
                    ? 'bg-slate-900 text-white shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => {
                  setDocType('boleta');
                  if (clientDoc.tipo === 'RUC') setClientDoc({ tipo: '-', numero: '', nombre: '' });
                }}
              >
                Boleta de Venta
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-1.5 transition-all text-center ${
                  docType === 'factura'
                    ? 'bg-primary text-white shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => {
                  setDocType('factura');
                  if (clientDoc.tipo !== 'RUC') setDniModal(true);
                }}
              >
                Factura (RUC)
              </button>
              <button
                type="button"
                className={`flex-1 rounded-lg py-1.5 transition-all text-center ${
                  docType === 'nota'
                    ? 'bg-amber-600 text-white shadow-xs font-extrabold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                onClick={() => {
                  setDocType('nota');
                }}
              >
                Nota de Venta
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void openQuoteModal()}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 px-2.5 text-xs font-bold text-primary hover:bg-indigo-100 transition-colors"
                title="Cargar cotización guardada"
              >
                <Calculator size={15} />
                <span className="hidden sm:inline">Cotizaciones</span>
              </button>

              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setClientDoc({ tipo: '-', numero: '', nombre: '' });
                    try {
                      localStorage.removeItem(`denzoz_pos_cart_${storeId}`);
                    } catch {
                      // ignore
                    }
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
                  title="Vaciar carrito"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Badge de Cliente */}
          <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-2.5">
            {docType === 'nota' ? (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={15} className="text-amber-600 shrink-0" />
                  <span className="font-semibold text-amber-900 truncate">
                    {clientDoc.tipo !== '-' ? `${clientDoc.nombre} (${clientDoc.numero})` : 'Nota de Venta (Comprobante Interno)'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDniModal(true)}
                  className="font-bold text-primary hover:underline text-[11px] shrink-0"
                >
                  {clientDoc.tipo !== '-' ? 'Cambiar' : '+ Asignar cliente'}
                </button>
              </div>
            ) : clientDoc.tipo === '-' ? (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <User size={15} className="text-slate-400" />
                  <span className="font-medium">Consumidor Final (Sin DNI)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDniModal(true)}
                  className="font-bold text-primary hover:underline text-[11px]"
                >
                  + Agregar DNI / RUC
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {clientDoc.tipo === 'RUC' ? (
                    <Building2 size={15} className="text-indigo-600 shrink-0" />
                  ) : (
                    <User size={15} className="text-emerald-600 shrink-0" />
                  )}
                  <div className="truncate">
                    <span className="font-mono font-bold text-slate-900">{clientDoc.tipo}: {clientDoc.numero}</span>
                    <span className="text-slate-500 block truncate text-[11px]">{clientDoc.nombre}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setClientDoc({ tipo: '-', numero: '', nombre: '' });
                    setDocType('boleta');
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-800"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Lista de Productos en el Carrito */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-400 py-12">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                <ShoppingCart size={28} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-600">Carrito de venta vacío</p>
                <p className="text-xs text-slate-400 max-w-[200px] mt-0.5">
                  Escanea con la pistola o selecciona productos del catálogo.
                </p>
              </div>
            </div>
          ) : (
            cart.map((l) => (
              <div
                key={l.lineId}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs animate-in fade-in"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800 leading-tight">
                    {l.name}
                  </p>
                  <span className="text-[11px] font-mono text-slate-400">
                    S/ {l.unitPrice.toFixed(2)} c/u
                  </span>
                </div>

                {/* Stepper +/- */}
                <div className="flex items-center gap-1.5">
                  <button
                    aria-label={`Restar ${l.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                    onClick={() =>
                      setCart((prev) =>
                        prev
                          .map((x) =>
                            x.lineId === l.lineId
                              ? { ...x, qty: x.qty - 1, total: round2((x.qty - 1) * x.unitPrice) }
                              : x
                          )
                          .filter((x) => x.qty > 0)
                      )
                    }
                  >
                    <Minus size={12} />
                  </button>

                  <span className="w-7 text-center font-mono text-xs font-extrabold text-slate-900">
                    {l.qty}
                  </span>

                  <button
                    aria-label={`Sumar ${l.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                    onClick={() => {
                      const allocated = cart
                        .filter((x) => x.productId === l.productId)
                        .reduce((sum, x) => sum + x.qty * (x.factor || 1), 0);
                      if (allocated + (l.factor || 1) > l.stock) {
                        setError(`Stock máximo alcanzado para ${l.name} (quedan ${l.stock} unidades base)`);
                        return;
                      }
                      setCart((prev) =>
                        prev.map((x) =>
                          x.lineId === l.lineId
                            ? { ...x, qty: x.qty + 1, total: round2((x.qty + 1) * x.unitPrice) }
                            : x
                        )
                      );
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="min-w-16 text-right font-mono text-sm font-extrabold text-slate-900">
                    S/ {l.total.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    title={`Quitar ${l.name} del carrito`}
                    aria-label={`Eliminar ${l.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
                    onClick={() => setCart((prev) => prev.filter((x) => x.lineId !== l.lineId))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer / Panel de Cobro */}
        <div className="border-t border-slate-200 bg-white p-4 space-y-3.5 shadow-lg">
          {/* Selector de Método de Pago */}
          <div className="grid grid-cols-5 gap-1.5">
            {PAYMENTS.map(({ id, label, icon: Icon, colorClass }) => {
              const active = payment === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPayment(id)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl p-2 text-xs font-bold border transition-all active:scale-95 ${
                    active
                      ? `${colorClass} shadow-xs font-extrabold border-2`
                      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={16} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Selector de Banco para Transferencia */}
          {payment === 'transferencia' && (
            <div className="rounded-xl bg-blue-50/60 border border-blue-200/80 p-3 space-y-2 min-h-[68px] animate-in fade-in">
              <label className="text-[10px] font-bold uppercase tracking-wider text-blue-900 block">
                Selecciona la Entidad Bancaria
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {BANKS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBankName(b)}
                    className={`h-9 flex items-center justify-center rounded-xl px-2 text-xs font-bold transition-all truncate text-center ${
                      bankName === b
                        ? 'bg-blue-600 text-white shadow-xs font-extrabold ring-2 ring-blue-400/30'
                        : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Calculadora de Vuelto para Efectivo */}
          {payment === 'efectivo' && (
            <div className="grid grid-cols-2 gap-2.5 rounded-xl bg-slate-50 border border-slate-200/80 p-3 min-h-[68px] animate-in fade-in">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Paga con (S/)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.10"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  placeholder={(total || 0).toFixed(2)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-mono font-bold text-slate-900 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>

              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Vuelto
                </span>
                <div className="flex h-10 items-center justify-between rounded-xl bg-emerald-50 border border-emerald-200 px-3 font-mono font-extrabold text-emerald-800 text-sm">
                  <span>S/</span>
                  <span>{change.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Tarjeta Informativa Yape */}
          {payment === 'yape' && (
            <div className="flex items-center justify-between rounded-xl bg-purple-50/70 border border-purple-200/80 p-3 min-h-[68px] animate-in fade-in">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-xs shrink-0">
                  <QrCode size={20} />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-purple-950 block leading-tight">
                    Cobro con Yape
                  </span>
                  <span className="text-[11px] text-purple-700/90 font-medium block mt-0.5">
                    Verifica la notificación en el celular de caja
                  </span>
                </div>
              </div>
              <div className="text-right font-mono shrink-0 pl-2">
                <span className="text-[10px] uppercase font-bold text-purple-700 block">Monto Yape</span>
                <span className="text-base font-extrabold text-purple-950">S/ {total.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Tarjeta Informativa Plin */}
          {payment === 'plin' && (
            <div className="flex items-center justify-between rounded-xl bg-cyan-50/70 border border-cyan-200/80 p-3 min-h-[68px] animate-in fade-in">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-xs shrink-0">
                  <QrCode size={20} />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-cyan-950 block leading-tight">
                    Cobro con Plin
                  </span>
                  <span className="text-[11px] text-cyan-700/90 font-medium block mt-0.5">
                    Verifica la notificación en el celular de caja
                  </span>
                </div>
              </div>
              <div className="text-right font-mono shrink-0 pl-2">
                <span className="text-[10px] uppercase font-bold text-cyan-700 block">Monto Plin</span>
                <span className="text-base font-extrabold text-cyan-950">S/ {total.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Tarjeta Informativa Sip */}
          {payment === 'sip' && (
            <div className="flex items-center justify-between rounded-xl bg-amber-50/70 border border-amber-200/80 p-3 min-h-[68px] animate-in fade-in">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white shadow-xs shrink-0">
                  <WalletCards size={20} />
                </div>
                <div>
                  <span className="text-xs font-extrabold text-amber-950 block leading-tight">
                    Cobro con Sip
                  </span>
                  <span className="text-[11px] text-amber-700/90 font-medium block mt-0.5">
                    Pago registrado vía billetera/terminal Sip
                  </span>
                </div>
              </div>
              <div className="text-right font-mono shrink-0 pl-2">
                <span className="text-[10px] uppercase font-bold text-amber-700 block">Monto Sip</span>
                <span className="text-base font-extrabold text-amber-950">S/ {total.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Total Grande */}
          <div className="flex items-center justify-between rounded-2xl bg-slate-950 p-4 text-white shadow-md">
            <div>
              <span className="text-xs uppercase font-bold text-slate-400 block tracking-wider">
                Total a Pagar ({cart.length} {cart.length === 1 ? 'ítem' : 'ítems'})
              </span>
              <span className="text-[10px] text-slate-500 font-medium">IGV 18% incluido</span>
            </div>
            <span className="price-tag font-mono text-3xl font-extrabold text-emerald-400">
              S/ {total.toFixed(2)}
            </span>
          </div>

          {/* Botón Principal de Cobro */}
          <button
            disabled={cart.length === 0 || busy}
            onClick={() => void checkout()}
            className="group relative flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-primary via-indigo-600 to-indigo-500 py-4 text-base font-display font-extrabold text-white shadow-lg shadow-primary/30 transition-all duration-200 hover:shadow-primary/50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <CheckCircle2 size={22} className="transition-transform group-hover:scale-110" />
            <span>{busy ? 'Procesando venta…' : `Cobrar S/ ${total.toFixed(2)}`}</span>
          </button>
        </div>
      </aside>

      {/* ─── MODAL CONSULTA DNI / RUC ────────────────────────────────────────── */}
      <Modal open={dniModal} title="Identificación del Cliente" onClose={() => setDniModal(false)}>
        <div className="space-y-5">
          {/* Factura con RUC */}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-indigo-900 flex items-center gap-1.5">
              <Building2 size={15} className="text-indigo-600" /> Factura Electrónica — RUC
            </label>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                maxLength={11}
                value={rucValue}
                onChange={(e) => setRucValue(e.target.value.replace(/\D/g, ''))}
                placeholder="11 dígitos (Ej. 2060...)"
                className="field font-mono text-base font-bold"
              />
              <button
                className="btn-primary shrink-0 !px-5"
                disabled={lookupBusy}
                onClick={() => void doRucLookup()}
              >
                {lookupBusy ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Consulta automática de Razón Social en SUNAT / APIS.net.pe.
            </p>
          </div>

          {/* Boleta con DNI */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <User size={15} className="text-slate-500" /> Boleta con DNI (Opcional)
            </label>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                maxLength={8}
                value={dniValue}
                onChange={(e) => setDniValue(e.target.value.replace(/\D/g, ''))}
                placeholder="8 dígitos (DNI)"
                className="field font-mono text-base font-bold"
              />
              <button
                className="btn-ghost shrink-0 !px-5"
                disabled={lookupBusy}
                onClick={() => void doDniSave()}
              >
                {lookupBusy ? 'Validando…' : 'Aplicar'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Obligatorio para montos iguales o mayores a S/ {company?.minBoletaSinDni ?? 700}.
            </p>
          </div>
        </div>
      </Modal>

      {/* ─── MODAL VENTA REGISTRADA EXITOSAMENTE ──────────────────────────────── */}
      <Modal open={receiptDone !== null} title="Venta Emitida con Éxito" onClose={() => setReceiptDone(null)}>
        {receiptDone && (
          <div className="space-y-6 text-center py-2">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-500/20">
              <CheckCircle2 size={36} />
            </div>

            <div className="space-y-1">
              <p className="font-mono text-sm font-bold text-slate-500 tracking-wider">
                COMPROBANTE {receiptDone.code}
              </p>
              <p className="price-tag font-display text-4xl font-extrabold text-slate-900">
                S/ {receiptDone.total.toFixed(2)}
              </p>
            </div>

            {payment === 'efectivo' && receiptDone.change > 0 && (
              <div className="mx-auto inline-flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm font-bold text-emerald-800">
                <span>Vuelto a entregar:</span>
                <span className="font-mono text-base font-extrabold">S/ {receiptDone.change.toFixed(2)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                className="btn-ghost !py-3 text-xs font-bold"
                onClick={() => printTicket(receiptDone.html)}
              >
                <Printer size={16} /> Imprimir Ticket
              </button>
              <button
                className="btn-primary !py-3 text-xs font-bold"
                onClick={() => setReceiptDone(null)}
              >
                <Sparkles size={16} /> Nueva Venta
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── MODAL CARGAR COTIZACIÓN ────────────────────────────────────────── */}
      <Modal open={quoteModal} title="Cargar Cotización de Útiles / Pedido" onClose={() => setQuoteModal(false)}>
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Selecciona una cotización generada por los trabajadores para importar los productos al carrito:
          </p>

          {loadingQuotes ? (
            <div className="p-8 text-center text-sm text-slate-500">Cargando cotizaciones…</div>
          ) : quotesList.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-400">
              <Calculator size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-bold text-slate-600">No hay cotizaciones registradas</p>
              <p className="text-xs text-slate-400 mt-0.5">Los trabajadores pueden crearlas desde su panel.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {quotesList.map((q) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between p-3.5 rounded-2xl border border-slate-200 bg-white hover:border-primary/50 hover:bg-indigo-50/20 transition-all shadow-xs"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-extrabold text-sm text-slate-900">{q.code}</span>
                      <span className="text-[11px] text-slate-400">· {q.items.length} productos</span>
                    </div>
                    <p className="text-xs font-semibold text-slate-700 truncate mt-0.5">
                      👤 {q.clientName || 'Cliente anónimo'}
                    </p>
                    <span className="text-[10px] text-slate-400">Creado por {q.createdByName}</span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="font-mono font-extrabold text-sm text-emerald-600 block">
                      S/ {q.totalAll.toFixed(2)}
                    </span>
                    <button
                      onClick={() => loadQuoteIntoCart(q)}
                      className="btn-primary !min-h-8 !px-3 !py-1 text-xs font-bold mt-1"
                    >
                      Cargar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setQuoteModal(false)}
            className="btn-ghost w-full !min-h-10 text-xs font-bold"
          >
            Cerrar
          </button>
        </div>
      </Modal>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
