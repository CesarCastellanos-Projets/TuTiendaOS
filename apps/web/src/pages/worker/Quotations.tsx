import { useState, useMemo, useEffect } from 'react';
import {
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import {
  Calculator,
  Camera,
  Search,
  Plus,
  Minus,
  Trash2,
  Share2,
  Printer,
  Save,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Building2,
  Store,
  Warehouse as WarehouseIcon,
  Phone,
  User,
  History,
  ScanLine,
  X,
  AlertCircle
} from 'lucide-react';
import { tenantCollection } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { useStoreCatalog, useCatalogSearch, findInCatalog } from '../../hooks/useStoreCatalog';
import { useScanner } from '../../hooks/useScanner';
import { useCompany } from '../../hooks/useCompany';
import { fmtDateTime } from '../../lib/utils';
import { FlashBar, useFlash } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import type { ProductStock, Quotation, QuotationItem } from '../../types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface OtherStockInfo {
  locationId: string;
  locationName: string;
  locationType: 'store' | 'warehouse';
  quantity: number;
}

export function WorkerQuotations() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const company = useCompany();
  const storeId = profile.storeId || 'tienda-principal';

  const { items: catalog } = useStoreCatalog(storeId);
  const searchIn = useCatalogSearch(catalog);
  const { msg, flash } = useFlash();

  // Tab: 'crear' | 'historial'
  const [tab, setTab] = useState<'crear' | 'historial'>('crear');

  // Estado de la cotización actual
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [note, setNote] = useState('');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);

  // Modal "¿Dónde hay stock?"
  const [stockCheckProduct, setStockCheckProduct] = useState<{ id: string; name: string } | null>(null);
  const [otherStocks, setOtherStocks] = useState<OtherStockInfo[]>([]);
  const [loadingOtherStocks, setLoadingOtherStocks] = useState(false);

  // Modal WhatsApp
  const [whatsappModal, setWhatsappModal] = useState(false);

  // Historial de cotizaciones
  const [savedQuotes, setSavedQuotes] = useState<Quotation[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(true);

  // Escáner de cámara
  const onScan = (code: string) => {
    void findInCatalog(storeId, code, catalog).then((p) => {
      if (p) {
        addItem(p);
        if (navigator.vibrate) navigator.vibrate(80);
      } else {
        flash(`Producto no encontrado: ${code}`);
      }
    });
  };
  const scanner = useScanner(onScan);

  // Suscripción a cotizaciones recientes
  useEffect(() => {
    const q = query(
      tenantCollection('quotations'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    return onSnapshot(
      q,
      (snap) => {
        setSavedQuotes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Quotation)));
        setLoadingQuotes(false);
      },
      () => setLoadingQuotes(false)
    );
  }, [storeId]);

  // Búsqueda de productos
  const searchResults = term.trim().length >= 1 ? searchIn(term) : [];

  // Agregar producto a la lista
  const addItem = (p: ProductStock) => {
    setTerm('');
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.productId);
      if (existing) {
        const nextQty = existing.qty + 1;
        return prev.map((i) =>
          i.productId === p.productId
            ? {
                ...i,
                qty: nextQty,
                total: round2(nextQty * i.unitPrice),
                isAvailable: nextQty <= i.availableQty
              }
            : i
        );
      }
      return [
        ...prev,
        {
          productId: p.productId,
          name: p.productName,
          barcode: p.barcode || '',
          unit: p.unit || 'UN',
          unitPrice: p.salePrice,
          qty: 1,
          total: round2(p.salePrice),
          availableQty: p.quantity,
          isAvailable: p.quantity >= 1
        }
      ];
    });
  };

  // Modificar cantidad
  const updateQty = (productId: string, newQty: number) => {
    if (newQty <= 0) {
      removeItem(productId);
      return;
    }
    setItems((prev) =>
      prev.map((i) =>
        i.productId === productId
          ? {
              ...i,
              qty: newQty,
              total: round2(newQty * i.unitPrice),
              isAvailable: newQty <= i.availableQty
            }
          : i
      )
    );
  };

  // Eliminar ítem
  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  // Cálculos de Totales Duales
  const { totalAll, totalAvailable, itemsCount, availableCount } = useMemo(() => {
    let all = 0;
    let avail = 0;
    let avCount = 0;

    for (const item of items) {
      all += item.total;
      if (item.availableQty > 0) {
        const coveredQty = Math.min(item.qty, item.availableQty);
        avail += coveredQty * item.unitPrice;
      }
      if (item.isAvailable) {
        avCount += 1;
      }
    }

    return {
      totalAll: round2(all),
      totalAvailable: round2(avail),
      itemsCount: items.length,
      availableCount: avCount
    };
  }, [items]);

  // Consultar existencias en todas las tiendas y almacenes
  const checkStockInOtherLocations = async (productId: string, productName: string) => {
    setStockCheckProduct({ id: productId, name: productName });
    setLoadingOtherStocks(true);
    setOtherStocks([]);
    try {
      const q = query(
        tenantCollection('product_stocks'),
        where('productId', '==', productId)
      );
      const snap = await getDocs(q);
      const list: OtherStockInfo[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          locationId: data.locationId as string,
          locationName: data.locationName as string,
          locationType: data.locationType as 'store' | 'warehouse',
          quantity: Number(data.quantity) || 0
        };
      });
      // Ordenar: primero los que tienen mayor stock
      list.sort((a, b) => b.quantity - a.quantity);
      setOtherStocks(list);
    } catch {
      flash('No se pudieron cargar las existencias de otras ubicaciones.');
    } finally {
      setLoadingOtherStocks(false);
    }
  };

  // Guardar cotización en Firestore
  const saveQuotation = async (): Promise<string | null> => {
    if (!user) {
      flash('Error: Sesión no válida');
      return null;
    }
    if (items.length === 0) {
      flash('Error: Agrega al menos un producto');
      return null;
    }
    setBusy(true);
    try {
      const quoteCode = `COT-${Date.now().toString().slice(-6)}`;
      const storeName = catalog[0]?.locationName ?? 'Tienda Principal';
      const quoteRef = doc(tenantCollection('quotations'));

      const cleanItems: QuotationItem[] = items.map((i) => ({
        productId: i.productId,
        name: i.name,
        barcode: i.barcode || '',
        unit: i.unit || 'UN',
        unitPrice: Number(i.unitPrice.toFixed(2)),
        qty: Math.max(1, Math.trunc(i.qty)),
        total: Number(i.total.toFixed(2)),
        availableQty: i.availableQty,
        isAvailable: Boolean(i.isAvailable)
      }));

      const quoteData: Quotation = {
        tenantId: profile.tenantId,
        id: quoteRef.id,
        code: quoteCode,
        clientName: clientName.trim() || 'Cliente Cotización',
        clientPhone: clientPhone.trim() || '',
        storeId,
        storeName,
        items: cleanItems,
        totalAll: Number(totalAll.toFixed(2)),
        totalAvailable: Number(totalAvailable.toFixed(2)),
        note: note.trim() || '',
        createdBy: user.uid,
        createdByName: profile?.displayName || user.displayName || user.email || 'Trabajador',
        status: 'pendiente',
        createdAt: Date.now()
      };

      await setDoc(quoteRef, quoteData);
      flash(`Cotización ${quoteCode} guardada exitosamente`);
      return quoteCode;
    } catch (err) {
      console.error('Error al guardar la cotización:', err);
      const errMsg = err instanceof Error ? err.message : 'Error desconocido';
      flash(`Error al guardar la cotización: ${errMsg}`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Generar texto para WhatsApp
  const generateWhatsAppMessage = () => {
    const lines = items.map((i) => {
      const statusTag = i.isAvailable
        ? '✓ Disponible'
        : i.availableQty > 0
        ? `(Solo hay ${i.availableQty} en tienda)`
        : '✕ Sin stock hoy';
      return `• *${i.qty}x* ${i.name} — S/ ${i.total.toFixed(2)} _[${statusTag}]_`;
    });

    const companyName = company?.razonSocial || "D'ENZOZ";

    return (
      `*COTIZACIÓN — ${companyName}*\n` +
      `📅 *Fecha:* ${new Date().toLocaleDateString('es-PE')}\n` +
      (clientName ? `👤 *Cliente:* ${clientName}\n` : '') +
      `🏢 *Tienda:* ${catalog[0]?.locationName ?? 'Principal'}\n\n` +
      `*DETALLE DE PRODUCTOS:* \n` +
      lines.join('\n') +
      `\n\n───────────────────\n` +
      `💰 *TOTAL ESTIMADO (Lista completa):* S/ ${totalAll.toFixed(2)}\n` +
      `🟢 *TOTAL DISPONIBLE HOY EN TIENDA:* S/ ${totalAvailable.toFixed(2)}\n\n` +
      `¡Los precios están sujetos a disponibilidad! Gracias por su preferencia.`
    );
  };

  // Abrir WhatsApp con el mensaje
  const sendWhatsApp = () => {
    const text = encodeURIComponent(generateWhatsAppMessage());
    const cleanPhone = clientPhone.replace(/\D/g, '');
    const url = cleanPhone.length >= 9
      ? `https://wa.me/51${cleanPhone.slice(-9)}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
    setWhatsappModal(false);
  };

  // Imprimir cotización térmica / papel
  const printQuotation = () => {
    const companyName = company?.razonSocial || "D'ENZOZ";
    const ruc = company?.ruc ? `RUC: ${company.ruc}` : '';
    const phone = company?.phone ? `Tel: ${company.phone}` : '';
    const dateStr = fmtDateTime(Date.now());

    const itemRows = items
      .map(
        (i) => `
      <tr style="border-bottom: 1px dashed #ddd;">
        <td style="padding: 4px 0;">
          <strong>${i.name}</strong><br/>
          <span style="font-size: 10px; color: #555;">${i.qty} x S/ ${i.unitPrice.toFixed(2)} ${
            i.isAvailable ? '' : `<em style="color:#d97706;">(Disp: ${i.availableQty})</em>`
          }</span>
        </td>
        <td style="text-align: right; vertical-align: top; padding: 4px 0;">
          <strong>S/ ${i.total.toFixed(2)}</strong>
        </td>
      </tr>
    `
      )
      .join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cotización - ${companyName}</title>
          <style>
            body { font-family: monospace, sans-serif; font-size: 12px; margin: 0; padding: 12px; color: #000; width: 300px; }
            .center { text-align: center; }
            .divider { border-top: 1px dashed #000; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            .total-row { display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 4px; }
          </style>
        </head>
        <body>
          <div class="center">
            <h2 style="margin: 0; font-size: 16px;">${companyName}</h2>
            <div>${ruc}</div>
            <div>${phone}</div>
            <div style="font-weight: bold; margin-top: 6px; font-size: 14px;">COTIZACIÓN ESTIMADA</div>
            <div style="font-size: 10px; color: #444;">${dateStr}</div>
            ${clientName ? `<div style="font-size: 11px; margin-top: 2px;">Cliente: ${clientName}</div>` : ''}
          </div>
          <div class="divider"></div>
          <table>
            <thead>
              <tr style="border-bottom: 1px solid #000; font-size: 11px;">
                <th style="text-align: left; padding-bottom: 3px;">DESCRIPCIÓN</th>
                <th style="text-align: right; padding-bottom: 3px;">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows}
            </tbody>
          </table>
          <div class="divider"></div>
          <div class="total-row">
            <span>TOTAL DISPONIBLE HOY:</span>
            <span>S/ ${totalAvailable.toFixed(2)}</span>
          </div>
          <div class="total-row" style="font-size: 14px; margin-top: 6px;">
            <span>TOTAL LISTA COMPLETA:</span>
            <span>S/ ${totalAll.toFixed(2)}</span>
          </div>
          <div class="divider"></div>
          <div class="center" style="font-size: 10px; color: #444; margin-top: 8px;">
            * Precios referenciales sujetos a stock al momento de compra.<br/>
            ¡Gracias por cotizar con nosotros!
          </div>
        </body>
      </html>
    `;

    const w = window.open('', '_blank', 'width=350,height=550');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => {
        w.print();
        w.close();
      }, 300);
    }
  };

  // Cargar cotización existente para editar
  const loadSavedQuote = (q: Quotation) => {
    setItems(q.items);
    setClientName(q.clientName || '');
    setClientPhone(q.clientPhone || '');
    setNote(q.note || '');
    setTab('crear');
    flash(`Cotización ${q.code} cargada en pantalla`);
  };

  return (
    <div className="space-y-4">
      <FlashBar msg={msg} />

      {/* ─── PESTAÑAS: CREAR VS HISTORIAL ──────────────────────────────────── */}
      <div className="flex rounded-2xl bg-slate-200/80 p-1">
        <button
          onClick={() => setTab('crear')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-extrabold transition-all ${
            tab === 'crear'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calculator size={16} className="text-primary" />
          <span>Nueva Cotización</span>
          {items.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] text-white">
              {items.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('historial')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-extrabold transition-all ${
            tab === 'historial'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History size={16} className="text-indigo-600" />
          <span>Historial ({savedQuotes.length})</span>
        </button>
      </div>

      {tab === 'historial' ? (
        /* ─── VISTA: HISTORIAL DE COTIZACIONES ──────────────────────────────── */
        <div className="space-y-3">
          {loadingQuotes ? (
            <div className="p-8 text-center text-sm text-slate-500">Cargando cotizaciones…</div>
          ) : savedQuotes.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">
              <Calculator size={36} className="mx-auto text-slate-300 mb-2" />
              <p className="font-bold text-slate-600 text-sm">No hay cotizaciones registradas</p>
              <p className="text-xs mt-1">Crea tu primera cotización de lista escolar o pedido.</p>
            </div>
          ) : (
            savedQuotes.map((q) => (
              <div
                key={q.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5 shadow-xs hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-extrabold text-sm text-slate-900">{q.code}</span>
                    <span className="text-xs text-slate-400">· {fmtDateTime(q.createdAt)}</span>
                  </div>
                  <span className="badge bg-emerald-50 text-emerald-700 font-bold text-xs">
                    S/ {q.totalAll.toFixed(2)}
                  </span>
                </div>

                <div className="text-xs text-slate-600 flex items-center justify-between">
                  <span>
                    👤 <strong>{q.clientName || 'Cliente anónimo'}</strong> ({q.items.length} productos)
                  </span>
                  <span className="text-[11px] text-slate-400">Por {q.createdByName}</span>
                </div>

                <div className="flex gap-2 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => loadSavedQuote(q)}
                    className="btn-ghost flex-1 !min-h-9 !py-1.5 text-xs font-bold"
                  >
                    Ver / Editar
                  </button>
                  <button
                    onClick={() => {
                      loadSavedQuote(q);
                      setWhatsappModal(true);
                    }}
                    className="btn-primary flex-1 !min-h-9 !py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 border-none"
                  >
                    <Share2 size={14} /> Compartir
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* ─── VISTA: CREAR COTIZACIÓN ───────────────────────────────────────── */
        <div className="space-y-4">
          {/* Datos del Cliente */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2.5 shadow-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nombre del cliente o empresa"
                  className="field !pl-9 !text-xs !min-h-9"
                />
              </div>
              <div className="relative">
                <Phone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  placeholder="WhatsApp del cliente (opcional)"
                  className="field !pl-9 !text-xs !min-h-9 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Buscador y Escáner de Productos */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const q = term.trim();
                  if (!q) return;
                  void findInCatalog(storeId, q, catalog).then((found) => {
                    if (found) {
                      addItem(found);
                      setTerm('');
                    } else if (searchResults.length === 1) {
                      addItem(searchResults[0]);
                      setTerm('');
                    } else if (searchResults.length === 0) {
                      flash(`Producto no encontrado: ${q}`);
                    }
                  });
                }}
                className="relative flex-1"
              >
                <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Escribe el nombre o escanea código…"
                  className="field !pl-10 !pr-10 !h-12 !text-sm shadow-xs"
                  autoComplete="off"
                />
                {term && (
                  <button
                    type="button"
                    onClick={() => setTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    title="Borrar búsqueda"
                  >
                    <X size={16} />
                  </button>
                )}
              </form>
              <button
                className={`btn shrink-0 !h-12 !px-4 ${scanner.cameraOpen ? 'btn-brand' : 'btn-ghost'}`}
                title="Escanear con cámara del celular"
                onClick={() => (scanner.cameraOpen ? scanner.stop() : scanner.startCamera())}
              >
                <Camera size={20} />
                <span className="hidden sm:inline text-xs font-bold">Cámara</span>
              </button>
            </div>

            {/* Visor de Cámara PWA */}
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
              <div className="flex items-start gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-950 shadow-xs">
                <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">{scanner.error}</p>
                  <p className="text-amber-800 text-[11px]">
                    Puedes agregar el producto escribiendo su nombre en el buscador de arriba.
                  </p>
                </div>
              </div>
            )}

            {/* Resultados de Búsqueda */}
            {term.trim().length >= 1 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                <div className="px-3 py-1.5 text-[11px] font-bold text-slate-400 flex items-center justify-between">
                  <span>Coincidencias encontradas ({searchResults.length})</span>
                  <span>Toca para agregar a la cotización</span>
                </div>
                {searchResults.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No hay productos coincidentes con “{term}”.
                  </div>
                ) : (
                  searchResults.map((p) => (
                    <button
                      key={p.productId}
                      onClick={() => addItem(p)}
                      className="w-full flex items-center justify-between p-2.5 text-left hover:bg-indigo-50/50 rounded-xl transition-colors group"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="font-bold text-xs text-slate-900 group-hover:text-primary truncate">
                          {p.productName}
                        </p>
                        <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
                          Stock en tienda: {p.quantity} {p.quantity <= 0 ? '(Agotado)' : ''}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono font-extrabold text-sm text-slate-900 block">
                          S/ {p.salePrice.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-primary font-bold block mt-0.5">+ Agregar</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ─── BANNER DE TOTALES DUALES ELEGANTE Y CLARO ─────────────────────── */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="text-xs uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
                <Calculator size={15} className="text-primary" /> Resumen de Cotización
              </span>
              <span className="badge bg-slate-100 text-slate-700 text-[11px] font-bold">
                {itemsCount} {itemsCount === 1 ? 'ítem' : 'ítems'} ({availableCount} disponibles)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Total Disponible */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                  🟢 Para llevar hoy
                </span>
                <span className="font-mono text-2xl font-extrabold text-emerald-700 block my-0.5">
                  S/ {totalAvailable.toFixed(2)}
                </span>
                <span className="block text-[10px] text-emerald-600 font-medium">Stock en tu tienda</span>
              </div>

              {/* Total Completo */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                  📋 Total Pedido Completo
                </span>
                <span className="font-mono text-2xl font-extrabold text-slate-900 block my-0.5">
                  S/ {totalAll.toFixed(2)}
                </span>
                <span className="block text-[10px] text-slate-500 font-medium">Haya o no stock</span>
              </div>
            </div>
          </div>

          {/* ─── LISTA DE PRODUCTOS COTIZADOS ─────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Lista de Ítems ({items.length})
              </h2>
              {items.length > 0 && (
                <button
                  onClick={() => setItems([])}
                  className="text-xs text-critical font-semibold hover:underline flex items-center gap-1"
                >
                  <Trash2 size={13} /> Vaciar
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-slate-400">
                <Calculator size={32} className="mx-auto text-slate-300 mb-2" />
                <p className="font-bold text-slate-700 text-sm">Lista de cotización vacía</p>
                <p className="text-xs text-slate-400 max-w-xs mx-auto mt-1">
                  Escanea con la cámara o busca productos para cotizar.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.productId}
                    className={`rounded-2xl border bg-white p-3.5 space-y-2.5 shadow-xs transition-all ${
                      item.isAvailable
                        ? 'border-slate-200'
                        : item.availableQty > 0
                        ? 'border-amber-300 bg-amber-50/20'
                        : 'border-red-200 bg-red-50/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-xs text-slate-900 leading-tight">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs font-bold text-slate-700">
                            S/ {item.unitPrice.toFixed(2)} c/u
                          </span>
                          {/* Badge de Estado de Stock */}
                          {item.isAvailable ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                              <CheckCircle2 size={12} /> Hay {item.availableQty} en tienda
                            </span>
                          ) : item.availableQty > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                              <AlertTriangle size={12} /> Solo hay {item.availableQty} (faltan {item.qty - item.availableQty})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-[10px] font-bold text-critical">
                              <XCircle size={12} /> Agotado en tu tienda
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono font-extrabold text-sm text-slate-900 block">
                          S/ {item.total.toFixed(2)}
                        </span>
                        <button
                          onClick={() => removeItem(item.productId)}
                          className="text-slate-300 hover:text-critical p-1 transition-colors"
                          title="Quitar ítem"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    {/* Controles de Cantidad y Botón Multitienda */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      {/* Botón ¿Dónde hay stock? */}
                      {!item.isAvailable && (
                        <button
                          onClick={() => void checkStockInOtherLocations(item.productId, item.name)}
                          className="flex items-center gap-1 rounded-lg bg-indigo-50 px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-indigo-100 transition-colors"
                        >
                          <Building2 size={13} /> ¿Dónde hay stock?
                        </button>
                      )}

                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={() => updateQty(item.productId, item.qty - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          type="number"
                          min={1}
                          value={item.qty}
                          onChange={(e) =>
                            updateQty(item.productId, Math.max(1, Math.trunc(Number(e.target.value) || 1)))
                          }
                          className="field !h-7 w-12 !p-0 text-center font-mono text-xs font-bold"
                        />
                        <button
                          onClick={() => updateQty(item.productId, item.qty + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── BOTONES DE ACCIÓN FLOTANTES / PRINCIPALES ─────────────────────── */}
          {items.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setWhatsappModal(true)}
                  className="btn-primary !min-h-12 bg-emerald-600 hover:bg-emerald-700 border-none flex items-center justify-center gap-2 text-xs font-extrabold shadow-md shadow-emerald-600/20"
                >
                  <Share2 size={16} />
                  <span>Enviar WhatsApp</span>
                </button>
                <button
                  onClick={printQuotation}
                  className="btn-ghost !min-h-12 flex items-center justify-center gap-2 text-xs font-extrabold"
                >
                  <Printer size={16} />
                  <span>Imprimir Ticket</span>
                </button>
              </div>

              <button
                disabled={busy}
                onClick={() => void saveQuotation()}
                className="btn-brand w-full !min-h-12 flex items-center justify-center gap-2 text-xs font-extrabold shadow-md shadow-primary/20"
              >
                <Save size={16} />
                <span>{busy ? 'Guardando…' : 'Guardar Cotización en el Sistema'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL: ¿DÓNDE HAY STOCK? (MULTITIENDA) ─────────────────────────── */}
      <Modal
        open={stockCheckProduct !== null}
        title={`Stock en Otras Ubicaciones: ${stockCheckProduct?.name}`}
        onClose={() => setStockCheckProduct(null)}
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Existencia en tiempo real en todos los almacenes y tiendas de la empresa:
          </p>

          {loadingOtherStocks ? (
            <div className="p-8 text-center text-xs text-slate-500">Consultando stock general…</div>
          ) : otherStocks.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center text-xs font-bold text-amber-900">
              No hay stock registrado en ninguna otra ubicación.
            </div>
          ) : (
            <div className="space-y-2">
              {otherStocks.map((loc) => (
                <div
                  key={loc.locationId}
                  className={`flex items-center justify-between p-3 rounded-xl border ${
                    loc.quantity > 0
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-slate-200 bg-slate-50 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {loc.locationType === 'warehouse' ? (
                      <WarehouseIcon size={18} className="text-indigo-600 shrink-0" />
                    ) : (
                      <Store size={18} className="text-emerald-600 shrink-0" />
                    )}
                    <div>
                      <p className="font-bold text-xs text-slate-900">{loc.locationName}</p>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold">
                        {loc.locationType === 'warehouse' ? 'Almacén' : 'Tienda'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`font-mono text-base font-extrabold ${
                        loc.quantity > 0 ? 'text-emerald-700' : 'text-slate-400'
                      }`}
                    >
                      {loc.quantity} uds
                    </span>
                    <span className="block text-[10px] font-semibold text-slate-500">
                      {loc.quantity > 0 ? 'Disponible' : 'Sin stock'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setStockCheckProduct(null)}
            className="btn-ghost w-full !min-h-10 text-xs font-bold"
          >
            Cerrar
          </button>
        </div>
      </Modal>

      {/* ─── MODAL: ENVIAR POR WHATSAPP ─────────────────────────────────────── */}
      <Modal
        open={whatsappModal}
        title="Enviar Cotización por WhatsApp"
        onClose={() => setWhatsappModal(false)}
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Ingresa el número de WhatsApp del cliente o ábrelo directamente para elegir el contacto:
          </p>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700">Número de WhatsApp</label>
            <input
              type="tel"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="Ej: 987654321"
              className="field font-mono font-bold text-base"
            />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
            {generateWhatsAppMessage()}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setWhatsappModal(false)}
              className="btn-ghost flex-1 text-xs font-bold"
            >
              Cancelar
            </button>
            <button
              onClick={sendWhatsApp}
              className="btn-primary flex-1 bg-emerald-600 hover:bg-emerald-700 border-none text-xs font-extrabold flex items-center justify-center gap-1.5"
            >
              <Share2 size={15} />
              <span>Abrir WhatsApp</span>
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
