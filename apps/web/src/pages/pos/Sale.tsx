import { useEffect, useMemo, useRef, useState } from 'react';
import { getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
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
import type { LucideIcon } from 'lucide-react';
import { tenantCollection, tenantDoc } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';
import { findInCatalog, useCatalogSearch, useStoreCatalog, type SearchableCatalogItem } from '../../hooks/useStoreCatalog';
import { useScanner } from '../../hooks/useScanner';
import { usePosKeyboard } from '../../hooks/usePosKeyboard';
import { salePresentations } from '../../lib/sale-presentations';
import { createSale, hasPendingSale, pendingSaleKey, resumePendingSale } from '../../lib/sales';
import { availableBase, availablePresentation, remainingPresentation, baseQuantityStep, initialSaleQuantity, saleQuantityError } from '../../lib/stock-availability';
import { lookupClient } from '../../services/ruc';
import { ticketHtml, printTicket } from '../../lib/print';
import type { CashSession, ClientDoc, PaymentMethod, Sale, SaleItem, Quotation } from '../../types';
import { DNI_RE, money, RUC_RE } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { PresentationSelector } from '../../components/pos/PresentationSelector';

interface CartLine extends SaleItem {
  lineId: string;
  stock: number;
  promo?: boolean;
  autoUnpackEnabled?: boolean;
  allowFractionalSale?: boolean;
  fractionStep?: number;
  priceOverridden?: boolean;
}

const BANKS = ['BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Caja Huancayo', 'Caja Arequipa', 'Banco de la Nación', 'Otro'];

const PAYMENTS: { id: PaymentMethod; label: string; icon: LucideIcon; colorClass: string }[] = [
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
  const cartStorageKey = `denzoz_pos_cart_v2_${profile.tenantId}_${user?.uid}_${storeId}`;
  const { items: catalog, products } = useStoreCatalog(storeId);
  const searchIn = useCatalogSearch(catalog);

  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem(cartStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.version === 2 && Date.now() - Number(parsed.savedAt) < 86400000 && Array.isArray(parsed.cart)
          && parsed.cart.length <= 100 && parsed.cart.every((line: unknown) => {
            if (!line || typeof line !== 'object') return false;
            const item = line as Record<string, unknown>;
            return typeof item.productId === 'string' && typeof item.lineId === 'string'
              && typeof item.name === 'string' && typeof item.qty === 'number' && Number.isFinite(item.qty) && item.qty > 0
              && typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice) && item.unitPrice > 0;
          })) return parsed.cart;
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [draftId, setDraftId] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(cartStorageKey) ?? '{}');
      if (saved.version === 2 && Date.now() - Number(saved.savedAt) < 86400000 && typeof saved.draftId === 'string' && /^[\w-]{20,80}$/.test(saved.draftId)) return saved.draftId as string;
    } catch { /* el cobro exige guardar el identificador antes de enviar */ }
    return crypto.randomUUID();
  });
  const [term, setTerm] = useState('');
  const [presentationProductId, setPresentationProductId] = useState<string | null>(null);
  const [highlightedResult, setHighlightedResult] = useState(0);
  const scanQueue = useRef(Promise.resolve());
  const [clientDoc, setClientDoc] = useState<ClientDoc>({ tipo: '-', numero: '', nombre: '' });
  const [payment, setPayment] = useState<PaymentMethod>('efectivo');
  const [paid, setPaid] = useState('');
  const [bankName, setBankName] = useState('BCP');
  const [docType, setDocType] = useState<'boleta' | 'factura' | 'nota'>(() => {
    try {
      const saved = localStorage.getItem(cartStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.version === 2 && Date.now() - Number(parsed.savedAt) < 86400000 && ['boleta', 'factura', 'nota'].includes(parsed.docType)) return parsed.docType;
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
  const [visibleCount, setVisibleCount] = useState(60);
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const [editingPriceLineId, setEditingPriceLineId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const canOverridePrices = profile.role === 'admin' || profile.canOverridePrices === true;
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Cotizaciones
  const [quoteModal, setQuoteModal] = useState(false);
  const [quotesList, setQuotesList] = useState<Quotation[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(false);

  const openQuoteModal = async () => {
    setQuoteModal(true);
    setLoadingQuotes(true);
    try {
      const snap = await getDocs(
        query(
          tenantCollection('quotations'),
          where('storeId', '==', storeId),
          orderBy('createdAt', 'desc'),
          limit(20)
        )
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
      const effectiveQty = item.qty > 0 ? round3(item.qty) : 1;
      const prodDef = products.find((pr) => pr.id === item.productId);
      const pres = item.presentationId
        ? (prodDef?.presentations ?? []).find(
            (p, index) => (p.id || `legacy-${index + 1}`) === item.presentationId
          )
        : null;
      const stock = availablePresentation(inCat, prodDef?.presentations, pres);
      const lineId = `${item.productId}_${item.presentationId || 'base'}`;
      newCart.push({
        lineId,
        productId: item.productId,
        name: item.name,
        qty: effectiveQty,
        unitPrice: item.unitPrice,
        total: round2(effectiveQty * item.unitPrice),
        stock: stock,
        presentationUnit: item.unit,
        presentationId: item.presentationId,
        presentationLabel: item.presentationLabel,
        factor: item.factor ?? 1,
        barcode: item.barcode,
        autoUnpackEnabled: pres?.autoUnpackEnabled,
        allowFractionalSale: pres?.allowFractionalSale === true,
        fractionStep: pres?.fractionStep ?? 0.5
      });
    }
    setCart(newCart);
    if (q.clientName && q.clientName !== 'Cliente Cotización') {
      setClientDoc({ tipo: '-', numero: '', nombre: q.clientName });
    }
    setQuoteModal(false);
  };

  useEffect(() => {
    void getDoc(tenantDoc('stores', storeId)).then((s) => {
      if (s.exists()) setStoreName((s.data() as { name: string }).name);
    });
  }, [storeId]);
  const busyRef = useRef(false);
  const [pendingCheckout, setPendingCheckout] = useState(() => user ? hasPendingSale(profile.tenantId, user.uid, storeId) : false);
  useEffect(() => {
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('denzoz_pos_cart_') && !key.startsWith('denzoz_pos_cart_v2_')) localStorage.removeItem(key);
    } catch { /* el carrito funciona en memoria si no hay almacenamiento */ }
  }, [profile.tenantId, storeId]);

  useEffect(() => {
    if (!user) return;
    const key = pendingSaleKey(profile.tenantId, user.uid, storeId);
    const synchronize = (event: StorageEvent) => {
      if (event.key === key) setPendingCheckout(Boolean(event.newValue));
      if (event.key === cartStorageKey && event.newValue === null && !busyRef.current) {
        setCart([]); setDraftId(crypto.randomUUID());
      }
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [cartStorageKey, profile.tenantId, storeId, user]);

  const finishCheckout = (sale: Sale & { id: string }) => {
    setReceiptDone({ code: sale.code, total: sale.total, change: sale.changeAmount, html: ticketHtml(sale, company ?? undefined) });
    setCart([]); setPaid(''); setClientDoc({ tipo: '-', numero: '', nombre: '' }); setDocType('boleta');
    localStorage.removeItem(cartStorageKey);
    setPendingCheckout(false);
    setDraftId(crypto.randomUUID());
  };
  const recoverCheckout = async () => {
    if (!user || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const sale = await resumePendingSale(profile.tenantId, user.uid, storeId);
      if (sale) finishCheckout(sale);
      else { setPendingCheckout(false); setDraftId(crypto.randomUUID()); setError('La operación no llegó a cobrarse. Puedes revisar el carrito y cobrar.'); }
    } catch (err) {
      const pending = hasPendingSale(profile.tenantId, user.uid, storeId);
      setPendingCheckout(pending);
      if (!pending) setDraftId(crypto.randomUUID());
      setError(err instanceof Error ? err.message : 'No se pudo recuperar el cobro.');
    } finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    return onSnapshot(
      query(
        tenantCollection('cash_sessions'),
        where('userId', '==', user?.uid ?? ''),
        where('storeId', '==', storeId),
        where('status', '==', 'abierta'),
        limit(1)
      ),
      (s) => setSessionOpen(s.empty ? null : ({ ...(s.docs[0].data() as CashSession), id: s.docs[0].id }))
    );
  }, [storeId, user?.uid]);

  // Guardar automáticamente el carrito y datos de venta en localStorage para protección ante apagones o cierres
  useEffect(() => {
    if (!storeId) return;
    try {
      if (cart.length > 0 || clientDoc.tipo !== '-' || docType !== 'boleta') {
        localStorage.setItem(
          cartStorageKey,
          JSON.stringify({ version: 2, draftId, cart, docType, savedAt: Date.now() })
        );
      } else {
        localStorage.removeItem(cartStorageKey);
      }
    } catch {
      // ignore
    }
  }, [cart, cartStorageKey, clientDoc, docType, draftId, storeId]);

  // Sincronizar y sanear ítems del carrito recuperados del almacenamiento local
  useEffect(() => {
    if (cart.length === 0 || catalog.length === 0) return;
    setCart((prev) =>
      prev.map((line) => {
        const found = catalog.find((c) => c.productId === line.productId);
        if (!found) return line;
        const prodDef = products.find((pr) => pr.id === line.productId);

        const pres = line.presentationId
          ? (prodDef?.presentations ?? []).find(
              (p, index) => (p.id || `legacy-${index + 1}`) === line.presentationId
            )
          : null;

        const stock = availablePresentation(found, prodDef?.presentations, pres);
        const allowFractionalSale = pres ? pres.allowFractionalSale === true : true;
        const fractionStep = pres?.fractionStep ?? 0.5;
        const officialPrice = pres ? pres.salePrice : (prodDef?.salePrice ?? found.salePrice ?? line.unitPrice);

        const validQty = line.qty;

        const unitPrice = line.priceOverridden ? line.unitPrice : officialPrice;
        const total = round2(validQty * unitPrice);

        const hasChanged =
          line.stock !== stock ||
          line.qty !== validQty ||
          line.unitPrice !== unitPrice ||
          line.total !== total ||
          line.allowFractionalSale !== allowFractionalSale ||
          line.fractionStep !== fractionStep ||
          line.autoUnpackEnabled !== pres?.autoUnpackEnabled;

        if (!hasChanged) return line;

        return {
          ...line,
          stock,
          qty: validQty,
          unitPrice,
          total,
          allowFractionalSale,
          fractionStep,
          autoUnpackEnabled: pres?.autoUnpackEnabled
        };
      })
    );
  }, [cart.length, catalog, products]);

  const total = useMemo(() => round2(cart.reduce((s, l) => s + l.total, 0)), [cart]);
  const change = Math.max(0, (Number(paid) || 0) - total);

  // Extract categories for fast filter chips
  const categories = useMemo(() => [...new Set(catalog.map((stock) => productsById.get(stock.productId)?.category).filter((category): category is string => Boolean(category)))], [catalog, productsById]);
  const filteredCatalog = useMemo(() => selectedCategory === 'todos' ? catalog : catalog.filter((stock) => productsById.get(stock.productId)?.category === selectedCategory), [catalog, productsById, selectedCategory]);
  useEffect(() => setVisibleCount(60), [selectedCategory]);

  function addToCart(p: Omit<SearchableCatalogItem, 'searchKey'> & { searchKey?: string }): void {
    setError(null);
    if (p.salePrice <= 0) { setError('Esta presentación no tiene un precio de venta válido.'); return; }
    const factor = p.factor || 1;
    const lineId = `${p.productId}_${p.presentationId || 'base'}`;

    setCart((prev) => {
      const product = productsById.get(p.productId);
      const presentation = product?.presentations?.find((entry, index) => (entry.id || `legacy-${index + 1}`) === p.presentationId);
      const remaining = remainingPresentation(catalog.find((item) => item.productId === p.productId), product, prev, p.productId, p.presentationId);
      const quantityToAdd = initialSaleQuantity(remaining, presentation, product?.unit);
      if (quantityToAdd <= 0) {
        setError(`Stock insuficiente de ${p.presentationLabel ?? p.productName}. Revisa las otras presentaciones del carrito.`);
        return prev;
      }

      const existing = prev.find((l) => l.lineId === lineId);
      if (existing) {
        const nextQty = round3(existing.qty + quantityToAdd);
        if (saleQuantityError(nextQty, presentation, product?.unit) || quantityToAdd > remaining) {
          setError(`Stock máximo alcanzado para ${p.presentationLabel ?? p.productName}.`);
          return prev;
        }
        const updated = { ...existing, qty: nextQty, total: round2(nextQty * existing.unitPrice) };
        return [updated, ...prev.filter((line) => line.lineId !== lineId)];
      }

      return [
        {
          lineId,
          productId: p.productId,
          name: p.productName,
          qty: quantityToAdd,
          unitPrice: p.salePrice,
          total: round2(quantityToAdd * p.salePrice),
          stock: p.quantity,
          presentationUnit: p.presentationUnit,
          presentationId: p.presentationId,
          presentationLabel: p.presentationLabel,
          factor,
          barcode: p.barcode ?? undefined,
          autoUnpackEnabled: p.autoUnpackEnabled,
          allowFractionalSale: p.allowFractionalSale,
          fractionStep: p.fractionStep
        },
        ...prev
      ];
    });
  }

  function updateCartQuantity(lineId: string, requestedQty: number): boolean {
    if (!Number.isFinite(requestedQty) || requestedQty <= 0 || requestedQty > 1_000_000) {
      setError('La cantidad debe ser mayor a cero.');
      return false;
    }
    const line = cart.find((item) => item.lineId === lineId);
    if (!line) return false;

    const quantity = round3(requestedQty);
    const product = productsById.get(line.productId);
    const presentation = product?.presentations?.find((entry, index) => (entry.id || `legacy-${index + 1}`) === line.presentationId);
    const validation = saleQuantityError(quantity, presentation, product?.unit);
    if (validation) { setError(validation); return false; }
    if (quantity > remainingPresentation(catalog.find((item) => item.productId === line.productId), product, cart.filter((item) => item.lineId !== lineId), line.productId, line.presentationId)) {
      setError(`Stock total insuficiente de ${line.name}. Revisa las unidades disponibles y las cajas cerradas.`);
      return false;
    }

    setError(null);
    setCart((prev) =>
      prev.map((item) =>
        item.lineId === lineId
          ? { ...item, qty: quantity, total: round2(quantity * item.unitPrice) }
          : item
      )
    );
    return true;
  }

  function commitPrice(lineId: string): void {
    const clean = priceDraft.replace(',', '.').trim();
    const price = round2(Number(clean));
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000) {
      setError('El precio debe ser mayor que cero y tener un importe válido.');
      return;
    }
    setCart((prev) =>
      prev.map((line) =>
        line.lineId === lineId
          ? { ...line, unitPrice: price, total: round2(line.qty * price), priceOverridden: true }
          : line
      )
    );
    setEditingPriceLineId(null);
    setPriceDraft('');
    setError(null);
  }

  const closePresentations = () => {
    setPresentationProductId(null);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };
  const chooseProduct = (productId: string) => {
    const stock = catalog.find((item) => item.productId === productId);
    if (!stock) return;
    const choices = salePresentations(stock, productsById.get(productId));
    setTerm('');
    if (choices.length === 1) { addToCart(choices[0]); searchInputRef.current?.focus(); }
    else setPresentationProductId(productId);
  };
  const scanCode = (code: string) => {
    if (busyRef.current || pendingCheckout || receiptDone || document.querySelector('[role="dialog"]')) return;
    setTerm('');
    scanQueue.current = scanQueue.current.then(async () => {
      const item = await findInCatalog(storeId, code.trim(), catalog);
      if (item) { addToCart(item); navigator.vibrate?.(80); }
      else setError(`Código no encontrado: ${code}`);
    }).catch(() => setError('No se pudo consultar el código. Revisa tu conexión.'));
  };
  const scanner = useScanner(scanCode, false);
  const results = term.trim().length >= 2 ? searchIn(term).filter((item, index, all) => all.findIndex((other) => other.productId === item.productId) === index).slice(0, 10) : [];
  const submitSearch = (value: string) => {
    const exact = searchIn(value).find((item) => [item.barcode, item.internalCode, item.productId].some((code) => code?.toLowerCase() === value.trim().toLowerCase()));
    if (exact) { scanCode(value); return; }
    const result = results[Math.min(highlightedResult, results.length - 1)];
    if (result) chooseProduct(result.productId);
    else setError('No se encontraron productos. Prueba con otra palabra o código.');
  };
  usePosKeyboard(searchInputRef, {
    blocked: busy || Boolean(receiptDone) || Boolean(presentationProductId),
    onChange: (value) => { setTerm(value); setHighlightedResult(0); },
    onScan: scanCode, onSubmit: submitSearch,
    isCode: (value) => /^\d{3,}$/.test(value) || searchIn(value).some((item) => [item.barcode, item.internalCode, item.productId].some((code) => code?.toLowerCase() === value.toLowerCase())),
    onNavigate: (direction) => setHighlightedResult((current) => Math.max(0, Math.min(results.length - 1, current + direction)))
  });
  const selectedStock = catalog.find((item) => item.productId === presentationProductId);
  const presentationChoices = selectedStock ? salePresentations(selectedStock, productsById.get(selectedStock.productId)) : [];

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
    if (pendingCheckout) { setError('Resuelve primero el cobro pendiente.'); return; }
    if (!sessionOpen) { setError('Abre tu caja antes de cobrar.'); return; }
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

    for (const line of cart) {
      const product = productsById.get(line.productId);
      const stock = catalog.find((item) => item.productId === line.productId);
      const presentation = (product?.presentations ?? []).find((item, index) => (item.id || `legacy-${index + 1}`) === line.presentationId);
      const validation = saleQuantityError(line.qty, presentation, product?.unit);
      if (!product || !stock || (line.presentationId && !presentation) || validation
        || remainingPresentation(stock, product, cart, line.productId, line.presentationId) < 0) {
        setError(validation ?? `Stock total insuficiente o presentación inválida de ${line.name}. Revisa el carrito.`);
        return;
      }
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
        requestId: draftId,
        clientDoc,
        items: cart.map(({ productId, name, qty, unitPrice, total, presentationId, presentationUnit, factor, barcode }) => ({
          productId,
          name,
          qty,
          unitPrice,
          total,
          presentationId,
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

      finishCheckout(sale);

    } catch (err) {
      const pending = hasPendingSale(profile.tenantId, user.uid, storeId);
      setPendingCheckout(pending);
      if (!pending) setDraftId(crypto.randomUUID());
      setError(err instanceof Error ? err.message : 'Error al registrar la venta.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-100/60 lg:h-full lg:overflow-hidden lg:flex-row">
      {pendingCheckout && (
        <div data-pos-block-input className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="card max-w-md space-y-3 p-5">
            <h2 className="font-bold">Cobro pendiente de confirmar</h2>
            <p className="text-sm">Recupera la operación antes de continuar. El servidor reutilizará la misma venta si ya se registró.</p>
            {error && <p className="text-sm text-critical">{error}</p>}
            <button className="btn-primary" disabled={busy} onClick={() => void recoverCheckout()}>Verificar y recuperar cobro</button>
          </div>
        </div>
      )}
      {/* ─── COLUMNA IZQUIERDA: CATÁLOGO Y BÚSQUEDA ───────────────────────────── */}
      <section className="flex min-w-0 flex-1 flex-col border-b border-slate-200 bg-white lg:overflow-hidden lg:border-b-0 lg:border-r">
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
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = term.trim();
                  if (!value) return;
                  submitSearch(value);
                }}
              >
                <input
                  ref={searchInputRef}
                  value={term}
                  onChange={(event) => { setTerm(event.target.value); setHighlightedResult(0); }}
                  placeholder="Busca por nombre o escanea cualquier presentación…"
                  className="field !pl-10 !h-12 !text-base font-medium shadow-xs"
                  aria-label="Buscar productos"
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls="pos-search-results"
                  aria-autocomplete="list"
                  aria-activedescendant={results.length ? `pos-result-${Math.min(highlightedResult, results.length - 1)}` : undefined}
                  autoComplete="off"
                  inputMode="search"
                  autoFocus
                />
              </form>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500 hidden sm:inline">
                Pistola USB
              </span>
              {results.length > 0 && (
                <ul id="pos-search-results" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in">
                  {results.map((p, index) => (
                    <li key={p.productId} id={`pos-result-${index}`} role="option" aria-selected={index === highlightedResult}>
                      <button
                        type="button"
                        onClick={() => {
                          chooseProduct(p.productId);
                        }}
                        className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-indigo-50/60 transition-colors ${index === highlightedResult ? 'bg-indigo-50' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="truncate font-medium text-slate-800 block">{p.productName}</span>
                          {p.barcode && <span className="text-[10px] font-mono text-slate-400 block">Código: {p.barcode}</span>}
                        </div>
                        <div className="ml-3 flex shrink-0 items-center gap-2">
                          <span className={`badge ${p.quantity <= 5 ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                            {p.quantity} en stock
                          </span>
                          <span className="price-tag text-base font-mono font-bold text-primary">{money(p.salePrice)}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
        <div className="flex-1 p-4 lg:min-h-0 lg:overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {filteredCatalog.slice(0, visibleCount).map((p) => {
              const prodDef = productsById.get(p.productId);
              const choices = salePresentations(p, prodDef);
              const baseAvailable = availableBase(p, prodDef?.presentations);
              const isOutOfStock = p.quantity <= 0;
              const isLowStock = baseAvailable > 0 && baseAvailable <= 5;

              return (
                <button
                  type="button"
                  key={p.productId}
                  onClick={() => chooseProduct(p.productId)}
                  disabled={isOutOfStock}
                  aria-label={`Seleccionar ${p.productName}`}
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
                        {isOutOfStock ? 'Agotado' : `${p.quantity} ${prodDef?.unit ?? 'UN'} total`}
                      </span>
                    </div>

                    <span className="mt-2 block text-xs font-semibold text-primary">{choices.length > 1 ? `Elegir presentación (${choices.length})` : 'Agregar al carrito'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredCatalog.length > visibleCount && <button className="btn-ghost mt-4 w-full" onClick={() => setVisibleCount((count) => count + 60)}>Mostrar más productos ({Math.min(visibleCount, filteredCatalog.length)} de {filteredCatalog.length})</button>}
          {filteredCatalog.length === 0 && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-slate-400">
              <ShoppingCart size={32} className="opacity-40" />
              <p className="text-sm font-semibold">No hay productos en esta categoría</p>
            </div>
          )}
        </div>
      </section>

      {/* ─── COLUMNA DERECHA: PANEL DEL TICKET / CARRITO ───────────────────────── */}
      <aside className="flex w-full shrink-0 flex-col bg-slate-50/90 lg:h-full lg:min-h-0 lg:w-[420px] xl:w-[460px] border-l border-slate-200 shadow-sm">
        {/* Cabecera del Ticket */}
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-4 space-y-3 lg:static">
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

                <button
                  type="button"
                  onClick={() => {
                    setCart([]);
                    setClientDoc({ tipo: '-', numero: '', nombre: '' });
                    try {
                      localStorage.removeItem(cartStorageKey);
                    } catch {
                      // ignore
                    }
                  }}
                  disabled={cart.length === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
                  title="Vaciar carrito"
                >
                  <Trash2 size={16} />
                </button>
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
        <div className="p-4 space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
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
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs animate-in fade-in"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800 leading-tight">
                    {l.name}
                  </p>
                  {canOverridePrices ? (
                    editingPriceLineId === l.lineId ? (
                      <form
                        className="mt-1 flex items-center gap-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          commitPrice(l.lineId);
                        }}
                      >
                        <span className="text-xs font-bold text-primary">S/</span>
                        <input
                          autoFocus
                          type="text"
                          inputMode="decimal"
                          value={priceDraft}
                          onChange={(event) => {
                            const val = event.target.value;
                            if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                              setPriceDraft(val);
                            }
                          }}
                          onFocus={(event) => event.currentTarget.select()}
                          onBlur={() => commitPrice(l.lineId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                              setEditingPriceLineId(null);
                              setPriceDraft('');
                            }
                          }}
                          className="h-9 w-24 rounded-lg border border-primary/40 px-2 font-mono text-sm font-bold outline-none focus:ring-2 focus:ring-primary/20"
                          aria-label={`Precio de ${l.name}`}
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="mt-1 min-h-8 rounded-lg bg-indigo-50 px-2 font-mono text-[11px] font-bold text-primary hover:bg-indigo-100"
                        onClick={() => {
                          setEditingPriceLineId(l.lineId);
                          setPriceDraft(l.unitPrice.toFixed(2));
                        }}
                        title="Editar el precio solo para esta venta"
                      >
                        {cartLineDescription(l)} · editar precio
                      </button>
                    )
                  ) : (
                    <span className="text-[11px] font-mono text-slate-500">{cartLineDescription(l)}</span>
                  )}
                </div>

                {/* Stepper +/- */}
                <div className="flex items-center gap-1.5">
                  <button
                    aria-label={`Restar ${l.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                    onClick={() => {
                      const next = round3(l.qty - cartLineStep(l));
                      if (next <= 0) setCart((prev) => prev.filter((item) => item.lineId !== l.lineId));
                      else updateCartQuantity(l.lineId, next);
                    }}
                  >
                    <Minus size={12} />
                  </button>

                  <CartQuantityInput
                    line={l}
                    onCommit={(nextQty) => updateCartQuantity(l.lineId, nextQty)}
                  />

                  <button
                    aria-label={`Sumar ${l.name}`}
                    className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 active:scale-95"
                    onClick={() => updateCartQuantity(l.lineId, round3(l.qty + cartLineStep(l)))}
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
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-critical transition-colors"
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
        <div className="border-t border-slate-200 bg-white p-4 pb-28 space-y-3.5 shadow-lg lg:shrink-0 lg:pb-4">
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
          <div className="hidden items-center justify-between rounded-2xl bg-slate-950 p-4 text-white shadow-md lg:flex">
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
            className="group relative hidden w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-primary via-indigo-600 to-indigo-500 py-4 text-base font-display font-extrabold text-white shadow-lg shadow-primary/30 transition-all duration-200 hover:shadow-primary/50 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed lg:flex"
          >
            <CheckCircle2 size={22} className="transition-transform group-hover:scale-110" />
            <span>{busy ? 'Procesando venta…' : `Cobrar S/ ${total.toFixed(2)}`}</span>
          </button>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Total · {cart.length} ítems</span>
          <span className="font-mono text-xl font-extrabold text-slate-950">S/ {total.toFixed(2)}</span>
        </div>
        <button
          type="button"
          disabled={cart.length === 0 || busy}
          onClick={() => void checkout()}
          className="flex min-h-12 min-w-40 items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-display text-sm font-extrabold text-white shadow-lg disabled:opacity-50"
        >
          <CheckCircle2 size={19} /> {busy ? 'Procesando…' : 'Cobrar'}
        </button>
      </div>

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

      <Modal open={Boolean(presentationProductId)} title={selectedStock?.productName ?? 'Elegir presentación'} onClose={closePresentations}>
        <PresentationSelector
          choices={presentationChoices}
          stock={selectedStock ?? undefined}
          product={selectedStock ? productsById.get(selectedStock.productId) : undefined}
          baseUnit={selectedStock ? productsById.get(selectedStock.productId)?.unit ?? 'UN' : 'UN'}
          cart={cart}
          onSelect={(choice) => { addToCart(choice); closePresentations(); }}
        />
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

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

function cartLineStep(line: CartLine): number {
  return line.presentationId ? (line.autoUnpackEnabled && line.allowFractionalSale ? line.fractionStep ?? 0.5 : 1) : baseQuantityStep(line.presentationUnit);
}

function cartLineDescription(line: CartLine): string {
  if (!line.presentationId) {
    return `${line.qty} ${line.qty === 1 ? 'unidad' : 'unidades'} × S/ ${line.unitPrice.toFixed(2)}`;
  }
  const label = (line.presentationLabel || line.presentationUnit || 'presentación').toLowerCase();
  const equivalent = round3(line.qty * (line.factor ?? 1));
  if (!Number.isInteger(line.qty)) {
    return `${line.qty} ${label} = ${equivalent} unidades · S/ ${line.total.toFixed(2)}`;
  }
  return `${line.qty} ${label} · ${equivalent} unidades · S/ ${line.unitPrice.toFixed(2)}`;
}

interface CartQuantityInputProps {
  line: CartLine;
  onCommit: (qty: number) => boolean;
}

function CartQuantityInput({ line, onCommit }: CartQuantityInputProps) {
  const [draft, setDraft] = useState(() => String(line.qty));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(line.qty));
    }
  }, [line.qty, isFocused]);

  const handleCommit = () => {
    const clean = draft.replace(',', '.').trim();
    const parsed = parseFloat(clean);
    if (!clean || !Number.isFinite(parsed) || parsed <= 0) {
      setDraft(String(line.qty));
      return;
    }
    const success = onCommit(parsed);
    if (!success) {
      setDraft(String(line.qty));
    } else {
      setDraft(String(round3(parsed)));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCommit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(String(line.qty));
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const step = cartLineStep(line);
      const next = round3(line.qty + step);
      const success = onCommit(next);
      if (success) {
        setDraft(String(next));
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const step = cartLineStep(line);
      const next = round3(line.qty - step);
      if (next > 0) {
        const success = onCommit(next);
        if (success) {
          setDraft(String(next));
        }
      }
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        const val = e.target.value;
        if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
          setDraft(val);
        }
      }}
      onFocus={(e) => {
        setIsFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => {
        setIsFocused(false);
        handleCommit();
      }}
      onKeyDown={handleKeyDown}
      className="h-11 w-16 rounded-xl border border-slate-200 bg-white px-1 text-center font-mono text-sm font-extrabold text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      aria-label={`Cantidad de ${line.name}`}
    />
  );
}

