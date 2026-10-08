import { durableCommand } from '../../lib/durable-command';
import { EditableNumberInput } from '../../components/ui/EditableNumberInput';
import { createQuotationPdf } from '../../lib/quotation-pdf';
import { canShareQuotation, downloadQuotation, isMobileShareDevice, openQuotationWhatsApp, quotationPhone } from '../../lib/share-quotation';
import { availableBase, remainingPresentation, initialSaleQuantity, saleQuantityError } from '../../lib/stock-availability';
import { escapeHtml } from '../../lib/html';
import { useState, useMemo, useEffect } from 'react';
import {
  getDocs,
  limit,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { usePagedQuery } from '../../hooks/usePagedQuery';
import { Pagination } from '../../components/ui/Pagination';
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
import { useStoreCatalog, useCatalogSearch, findInCatalog, type SearchableCatalogItem } from '../../hooks/useStoreCatalog';
import { useScanner } from '../../hooks/useScanner';
import { useCompany } from '../../hooks/useCompany';
import { fmtDateTime } from '../../lib/utils';
import { FlashBar, useFlash } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';
import type { ProductStock, Quotation, QuotationItem } from '../../types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function quotationLineKey(item: Pick<QuotationItem, 'productId' | 'presentationId'>): string {
  return `${item.productId}:${item.presentationId ?? 'base'}`;
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

  const { items: catalog, products, error: catalogError } = useStoreCatalog(storeId);
  const searchIn = useCatalogSearch(catalog);
  const { msg, flash } = useFlash();

  // Tab: 'crear' | 'historial'
  const [tab, setTab] = useState<'crear' | 'historial'>('crear');

  // Estado de la cotización actual
  const [draftItems, setItems] = useState<QuotationItem[]>([]);
  const items = useMemo(() => {
    const allocated: QuotationItem[] = [];
    return draftItems.map((item) => {
      const product = products.find((value) => value.id === item.productId);
      const presentation = (product?.presentations ?? []).find((value, index) => (value.id || `legacy-${index + 1}`) === item.presentationId);
      const factor = presentation?.factor ?? 1;
      const availableQty = remainingPresentation(catalog.find((stock) => stock.productId === item.productId), product, allocated, item.productId, item.presentationId);
      const isAvailable = Boolean(product) && (!item.presentationId || Boolean(presentation))
        && !saleQuantityError(item.qty, presentation, product?.unit) && item.qty <= availableQty;
      if (isAvailable) allocated.push(item);
      const unitPrice = presentation?.salePrice ?? product?.salePrice ?? item.unitPrice;
      return { ...item, factor, availableQty, isAvailable, unitPrice, total: round2(item.qty * unitPrice) };
    });
  }, [draftItems, catalog, products]);
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
  const [quotationPdf, setQuotationPdf] = useState<{ file: File; url: string } | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [sharingPdf, setSharingPdf] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!whatsappModal || !company) { setQuotationPdf(null); return; }
    let active = true;
    let url: string | null = null;
    setQuotationPdf(null); setPdfError(null); setShareNotice(null);
    void createQuotationPdf({ items, clientName, storeName: catalog[0]?.locationName ?? 'Principal', note, createdAt: Date.now() }, company)
      .then((file) => {
        if (!active) return;
        url = URL.createObjectURL(file);
        setQuotationPdf({ file, url });
      })
      .catch((error: unknown) => { if (active) setPdfError(error instanceof Error ? error.message : 'No se pudo crear el PDF.'); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [whatsappModal, company, items, clientName, catalog, note]);

  // Historial de cotizaciones
  const quoteSource = useMemo(() => tab === 'historial' ? query(tenantCollection('quotations'), where('storeId', '==', storeId), orderBy('createdAt', 'desc')) : null, [storeId, tab]);
  const quotePagination = usePagedQuery<Quotation>(quoteSource);
  const savedQuotes = quotePagination.rows;
  const loadingQuotes = quotePagination.loading;

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

  // Búsqueda de productos
  const searchResults = term.trim().length >= 1 ? searchIn(term) : [];

  // Agregar producto a la lista
  const addItem = (p: Omit<SearchableCatalogItem, 'searchKey'> & { searchKey?: string }) => {
    setTerm('');
    const quantity = initialSaleQuantity(p.quantity, p.presentationId ? { factor: p.factor ?? 1, autoUnpackEnabled: p.autoUnpackEnabled, allowFractionalSale: p.allowFractionalSale, fractionStep: p.fractionStep } : null, products.find((product) => product.id === p.productId)?.unit) || 1;
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.productId && i.presentationId === p.presentationId);
      if (existing) {
        const nextQty = Math.round((existing.qty + quantity) * 1000) / 1000;
        return prev.map((i) =>
          i.productId === p.productId && i.presentationId === p.presentationId
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
          presentationId: p.presentationId,
          presentationLabel: p.presentationLabel,
          factor: p.factor ?? 1,
          name: p.productName,
          barcode: p.barcode || '',
          unit: p.presentationUnit || p.unit || 'UN',
          unitPrice: p.salePrice,
          qty: quantity,
          total: round2(quantity * p.salePrice),
          availableQty: p.quantity,
          isAvailable: p.quantity >= 1
        }
      ];
    });
  };

  // Modificar cantidad
  const updateQty = (lineKey: string, newQty: number) => {
    if (!Number.isFinite(newQty) || newQty < 0) return;
    setItems((prev) =>
      prev.map((i) =>
        quotationLineKey(i) === lineKey
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
  const removeItem = (lineKey: string) => {
    setItems((prev) => prev.filter((i) => quotationLineKey(i) !== lineKey));
  };

  // Cálculos de Totales Duales
  const { totalAll, totalAvailable, itemsCount, availableCount } = useMemo(() => {
    let all = 0;
    let avail = 0;
    let avCount = 0;

    for (const item of items) {
      all += item.total;
      if (item.isAvailable) avail += item.total;
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
        where('productId', '==', productId), limit(101)
      );
      const snap = await getDocs(q);
      if (snap.size > 100) flash('Se muestran las primeras 100 ubicaciones.');
      const list: OtherStockInfo[] = snap.docs.slice(0, 100).map((d) => {
        const data = d.data();
        return {
          locationId: data.locationId as string,
          locationName: data.locationName as string,
          locationType: data.locationType as 'store' | 'warehouse',
          quantity: availableBase(data as ProductStock, products.find((product) => product.id === productId)?.presentations)
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
    for (const item of items) {
      const product = products.find((value) => value.id === item.productId);
      const presentation = (product?.presentations ?? []).find((value, index) => (value.id || `legacy-${index + 1}`) === item.presentationId);
      const validation = saleQuantityError(item.qty, presentation, product?.unit);
      if (validation || (item.presentationId && !presentation)) { flash(validation ?? 'Presentación inválida.'); return null; }
    }
    setBusy(true);
    try {
      const saved = await durableCommand<Quotation>('createQuotationRecord', {
        storeId, items: items.map((i) => ({ productId: i.productId, presentationId: i.presentationId ?? null, qty: i.qty })),
        clientName: clientName.trim(), clientPhone: clientPhone.trim(), note: note.trim()
      });
      setItems(saved.items);
      const quoteCode = saved.code;
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

  const sharePdf = async () => {
    if (!quotationPdf) return;
    if (!canShareQuotation(quotationPdf.file)) { openPdfWhatsApp(); return; }
    setSharingPdf(true);
    try {
      await navigator.share({ files: [quotationPdf.file], title: 'Cotización en PDF' });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setShareNotice('No se pudo compartir el archivo. Puedes descargarlo y adjuntarlo en WhatsApp.');
    } finally { setSharingPdf(false); }
  };
  const openPdfWhatsApp = (desktopApp = false) => {
    if (!quotationPdf) return;
    try {
      quotationPhone(clientPhone);
      downloadQuotation(quotationPdf.file);
      const opened = openQuotationWhatsApp(clientPhone, desktopApp);
      setShareNotice(opened ? 'PDF descargado. Adjunta ese archivo como documento en el chat de WhatsApp.' : 'PDF descargado. El navegador bloqueó la ventana; abre WhatsApp y adjunta el archivo.');
    } catch (error) { setShareNotice(error instanceof Error ? error.message : 'No se pudo abrir WhatsApp.'); }
  };

  // Imprimir cotización térmica / papel
  const printQuotation = () => {
    const companyName = escapeHtml(company?.razonSocial || "D'ENZOZ");
    const ruc = company?.ruc ? `RUC: ${escapeHtml(company.ruc)}` : '';
    const phone = company?.phone ? `Tel: ${escapeHtml(company.phone)}` : '';
    const dateStr = fmtDateTime(Date.now());

    const itemRows = items
      .map(
        (i) => `
      <tr style="border-bottom: 1px dashed #ddd;">
        <td style="padding: 4px 0;">
          <strong>${escapeHtml(i.name)}</strong><br/>
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
            ${clientName ? `<div style="font-size: 11px; margin-top: 2px;">Cliente: ${escapeHtml(clientName)}</div>` : ''}
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
      <div className="quotation-workspace space-y-5">
        {catalogError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{catalogError}</p>}
      <h1 className="font-display text-2xl font-semibold">Cotizaciones</h1>
      <FlashBar msg={msg} />

      {/* ─── PESTAÑAS: CREAR VS HISTORIAL ──────────────────────────────────── */}
      <div className="flex rounded-2xl bg-slate-200/80 p-1">
        <button
          onClick={() => setTab('crear')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-extrabold transition-colors ${
            tab === 'crear'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Calculator size={16} className="text-primary" />
          <span>Nueva Cotización</span>
          {items.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-white">
              {items.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('historial')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-extrabold transition-colors ${
            tab === 'historial'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <History size={16} className="text-brand-600" />
          <span>Historial ({savedQuotes.length})</span>
        </button>
      </div>

      {tab === 'historial' ? (
        /* ─── VISTA: HISTORIAL DE COTIZACIONES ──────────────────────────────── */
        <div className="space-y-3">
          <Pagination {...quotePagination} />
          {quotePagination.error && <p role="alert">{quotePagination.error}</p>}
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
                     <strong>{q.clientName || 'Cliente anónimo'}</strong> ({q.items.length} productos)
                  </span>
                  <span className="text-xs text-slate-400">Por {q.createdByName}</span>
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
        <div className="quotation-editor">
          {/* Datos del Cliente */}
          <div className="quote-customer card p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  aria-label="Nombre del cliente o empresa" placeholder="Nombre del cliente o empresa"
                  className="field !pl-9"
                />
              </div>
              <div className="relative">
                <Phone size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  aria-label="WhatsApp del cliente (opcional)" placeholder="WhatsApp del cliente (opcional)"
                  className="field !pl-9 !text-xs !min-h-9 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Buscador y Escáner de Productos */}
          <div className="quote-search space-y-2">
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
                  <p className="text-amber-800 text-xs">
                    Puedes agregar el producto escribiendo su nombre en el buscador de arriba.
                  </p>
                </div>
              </div>
            )}

            {/* Resultados de Búsqueda */}
            {term.trim().length >= 1 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                <div className="px-3 py-1.5 text-xs font-bold text-slate-400 flex items-center justify-between">
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
                      key={p.searchKey}
                      onClick={() => addItem(p)}
                      className="w-full flex items-center justify-between p-2.5 text-left hover:bg-brand-50/50 rounded-xl transition-colors group"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="font-bold text-xs text-slate-900 group-hover:text-primary truncate">
                          {p.productName}
                        </p>
                        <span className="text-xs text-slate-400 font-mono block mt-0.5">
                          Stock en tienda: {p.quantity} {p.quantity <= 0 ? '(Agotado)' : ''}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-mono font-extrabold text-sm text-slate-900 block">
                          S/ {p.salePrice.toFixed(2)}
                        </span>
                        <span className="text-xs text-primary font-bold block mt-0.5">+ Agregar</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* ─── BANNER DE TOTALES DUALES ELEGANTE Y CLARO ─────────────────────── */}
          <div className="quote-totals rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <span className="text-xs uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1.5">
                <Calculator size={15} className="text-primary" /> Resumen de Cotización
              </span>
              <span className="badge bg-slate-100 text-slate-700 text-xs font-bold">
                {itemsCount} {itemsCount === 1 ? 'ítem' : 'ítems'} ({availableCount} disponibles)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Total Disponible */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 block">
                   Para llevar hoy
                </span>
                <span className="font-mono text-2xl font-extrabold text-emerald-700 block my-0.5">
                  S/ {totalAvailable.toFixed(2)}
                </span>
                <span className="block text-xs text-emerald-600 font-medium">Stock en tu tienda</span>
              </div>

              {/* Total Completo */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
                   Total Pedido Completo
                </span>
                <span className="font-mono text-2xl font-extrabold text-slate-900 block my-0.5">
                  S/ {totalAll.toFixed(2)}
                </span>
                <span className="block text-xs text-slate-500 font-medium">Haya o no stock</span>
              </div>
            </div>
          </div>

          {/* ─── LISTA DE PRODUCTOS COTIZADOS ─────────────────────────────────── */}
          <div className="quote-items space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Productos ({items.length})
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
                    key={quotationLineKey(item)}
                    className={`rounded-2xl border bg-white p-3.5 space-y-2.5 shadow-xs transition-colors ${
                      item.isAvailable
                        ? 'border-slate-200'
                        : item.availableQty > 0
                        ? 'border-amber-300 bg-amber-50/20'
                        : 'border-red-200 bg-red-50/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-slate-900 leading-snug">{item.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs font-bold text-slate-700">
                            S/ {item.unitPrice.toFixed(2)} c/u
                          </span>
                          {/* Badge de Estado de Stock */}
                          {item.isAvailable ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">
                              <CheckCircle2 size={12} /> Hay {item.availableQty} en tienda
                            </span>
                          ) : item.availableQty > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">
                              <AlertTriangle size={12} /> Solo hay {item.availableQty} (faltan {item.qty - item.availableQty})
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-bold text-critical">
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
                          onClick={() => removeItem(quotationLineKey(item))}
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
                          className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-primary hover:bg-brand-100 transition-colors"
                        >
                          <Building2 size={13} /> ¿Dónde hay stock?
                        </button>
                      )}

                      <div className="flex items-center gap-2 ml-auto">
                        <button
                          onClick={() => updateQty(quotationLineKey(item), item.qty - 1)}
                          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                        >
                          <Minus size={13} />
                        </button>
                        <EditableNumberInput
                          type="number"
                          min={0.001}
                          step={0.001}
                          value={item.qty}
                          onChange={(e) =>
                            updateQty(quotationLineKey(item), Number(e.target.value))
                          }
                          className="field !h-10 w-16 !p-0 text-center font-mono text-xs font-bold"
                        />
                        <button
                          onClick={() => updateQty(quotationLineKey(item), item.qty + 1)}
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
            <div className="quote-actions space-y-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setWhatsappModal(true)}
                  className="btn-primary !min-h-12 bg-emerald-600 hover:bg-emerald-700 border-none flex items-center justify-center gap-2 text-xs font-extrabold shadow-md shadow-emerald-600/20"
                >
                  <Share2 size={16} />
                  <span>Compartir PDF</span>
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
                <span>{busy ? 'Guardando…' : 'Guardar cotización'}</span>
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
                      <WarehouseIcon size={18} className="text-brand-600 shrink-0" />
                    ) : (
                      <Store size={18} className="text-emerald-600 shrink-0" />
                    )}
                    <div>
                      <p className="font-bold text-xs text-slate-900">{loc.locationName}</p>
                      <span className="text-xs text-slate-400 uppercase font-semibold">
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
                    <span className="block text-xs font-semibold text-slate-500">
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
        title="Compartir cotización en PDF"
        onClose={() => setWhatsappModal(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">La cotización se comparte como un PDF con el logo y los datos de la empresa. En el selector de aplicaciones, elige WhatsApp y el contacto.</p>
          <label className="label">Número de WhatsApp (opcional)
            <input type="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="987654321 o número con código de país" className="field mt-1 font-mono" />
          </label>
          {pdfError ? <p role="alert" className="text-sm text-critical">{pdfError}</p> : quotationPdf ? (
            <div className="space-y-2">
              <p className="break-all text-sm font-semibold">{quotationPdf.file.name}</p>
              <iframe title="Vista previa de la cotización PDF" src={quotationPdf.url} className="h-72 w-full rounded-xl border border-slate-200" />
              <a href={quotationPdf.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary">Ver PDF completo</a>
            </div>
          ) : <p role="status" className="text-sm text-slate-500">Preparando PDF…</p>}
          {shareNotice && <p role="status" className="text-sm text-slate-700">{shareNotice}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button disabled={!quotationPdf || sharingPdf} onClick={() => void sharePdf()} className="btn-primary"><Share2 size={15} />{sharingPdf ? 'Compartiendo…' : 'Compartir PDF'}</button>
            <button disabled={!quotationPdf} onClick={() => { if (quotationPdf) downloadQuotation(quotationPdf.file); }} className="btn-ghost">Descargar PDF</button>
            {!isMobileShareDevice() && <>
              <button disabled={!quotationPdf || sharingPdf} onClick={() => openPdfWhatsApp()} className="btn-ghost">WhatsApp Web</button>
              <button disabled={!quotationPdf || sharingPdf} onClick={() => openPdfWhatsApp(true)} className="btn-ghost">WhatsApp para PC</button>
            </>}
          </div>
          {!isMobileShareDevice() && <p className="text-xs text-slate-500">En WhatsApp Web o para PC, adjunta el PDF descargado. Se reutiliza la ventana abierta desde este sistema cuando el navegador lo permite. Usa la opción para PC si tienes WhatsApp instalado.</p>}
          <button onClick={() => setWhatsappModal(false)} className="btn-ghost w-full">Cerrar</button>
        </div>
      </Modal>
    </div>
  );
}
