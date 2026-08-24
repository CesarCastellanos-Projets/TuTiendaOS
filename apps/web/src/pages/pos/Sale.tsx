import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, limit, onSnapshot, query, where } from 'firebase/firestore';
import { Camera, Check, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';
import { findInCatalog, useCatalogSearch, useStoreCatalog } from '../../hooks/useStoreCatalog';
import { useScanner, WedgeInput } from '../../hooks/useScanner';
import { createSale } from '../../lib/sales';
import { sendToSunat } from '../../services/sunat';
import { lookupClient } from '../../services/ruc';
import { ticketHtml, printTicket } from '../../lib/print';
import type { CashSession, ClientDoc, PaymentMethod, ProductStock, SaleItem } from '../../types';
import { DNI_RE, money, RUC_RE } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';

interface CartLine extends SaleItem {
  stock: number;
  promo?: boolean;
}

const PAYMENTS: PaymentMethod[] = ['efectivo', 'tarjeta', 'yape', 'plin'];

export function PosSale() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const company = useCompany();
  const storeId = profile.storeId!;
  const { items: catalog } = useStoreCatalog(storeId);
  const searchIn = useCatalogSearch(catalog);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [term, setTerm] = useState('');
  const [clientDoc, setClientDoc] = useState<ClientDoc>({ tipo: '-', numero: '', nombre: '' });
  const [payment, setPayment] = useState<PaymentMethod>('efectivo');
  const [paid, setPaid] = useState('');
  const [invoiceMode, setInvoiceMode] = useState(false);
  const [dniModal, setDniModal] = useState(false);
  const [rucValue, setRucValue] = useState('');
  const [dniValue, setDniValue] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [receiptDone, setReceiptDone] = useState<{ code: string; total: number; change: number; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionOpen, setSessionOpen] = useState<(CashSession & { id: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [storeName, setStoreName] = useState('Tienda');

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

  const total = useMemo(() => cart.reduce((s, l) => s + l.total, 0), [cart]);
  const change = Math.max(0, (Number(paid) || 0) - total);

  function addToCart(p: ProductStock): void {
    setError(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.productId);
      if (existing) {
        if (existing.qty + 1 > existing.stock) {
          setError(`Solo quedan ${p.quantity} de ${p.productName}`);
          return prev;
        }
        return prev.map((l) =>
          l.productId === p.productId
            ? { ...l, qty: l.qty + 1, total: round2((l.qty + 1) * l.unitPrice) }
            : l
        );
      }
      if (p.quantity < 1) {
        setError(`${p.productName} sin stock`);
        return prev;
      }
      return [
        ...prev,
        {
          productId: p.productId,
          name: p.productName,
          qty: 1,
          unitPrice: p.salePrice,
          total: round2(p.salePrice),
          stock: p.quantity
        }
      ];
    });
  }

  const scanCode = (code: string) => {
    void findInCatalog(storeId, code, catalog).then((p) => {
      if (p) addToCart(p);
      else setError(`Código no encontrado: ${code}`);
    });
  };

  const scanner = useScanner(scanCode);

  const results = term.trim().length >= 2 ? searchIn(term) : [];

  async function doRucLookup(): Promise<void> {
    if (!RUC_RE.test(rucValue)) {
      setError('El RUC debe tener 11 dígitos');
      return;
    }
    setLookupBusy(true);
    try {
      const c = await lookupClient('RUC', rucValue);
      setClientDoc({ tipo: 'RUC', numero: c.numero, nombre: c.nombre });
      setInvoiceMode(true);
      setDniModal(false);
    } catch {
      setError('No se pudo consultar el RUC. Verifica conexión.');
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
      setError('El DNI debe tener 8 dígitos');
      return;
    }
    setLookupBusy(true);
    try {
      const c = await lookupClient('DNI', dniValue).catch(() => null);
      setClientDoc({
        tipo: 'DNI',
        numero: dniValue,
        nombre: c?.nombre ?? `DNI ${dniValue}`
      });
      setInvoiceMode(false);
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
      setError('Agrega productos para cobrar');
      return;
    }
    if (payment === 'efectivo' && (Number(paid) || 0) < total - 0.001) {
      setError('El monto pagado es menor al total');
      return;
    }
    if (invoiceMode && clientDoc.tipo !== 'RUC') {
      setError('Para factura necesitas RUC y razón social');
      return;
    }
    if (!invoiceMode && total >= minSinDni && clientDoc.tipo !== 'DNI') {
      setError(`Desde S/ ${minSinDni} el DNI en boleta es obligatorio`);
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
        items: cart.map(({ productId, name, qty, unitPrice, total }) => ({
          productId,
          name,
          qty,
          unitPrice,
          total
        })),
        paymentMethod: payment,
        paidAmount: payment === 'efectivo' ? Number(paid) || total : total,
        consolidated: !invoiceMode && total < umbralConsol,
        cashSessionId: sessionOpen?.id,
        type: invoiceMode ? 'factura' : 'boleta'
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
      setInvoiceMode(false);

      void sendToSunat(sale.code, sale);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar la venta');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-4.5rem)] lg:flex-row">
      {/* Panel izquierdo: escaneo y búsqueda */}
      <section className="flex min-w-0 flex-1 flex-col gap-3 border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r">
        {!sessionOpen && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            Caja cerrada. Ábrela en la pestaña Caja antes de vender.
          </p>
        )}

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <WedgeInput
              onSubmit={scanCode}
              placeholder="Escanea o escribe código y Enter"
              className="field !pl-9"
            />
          </div>
          <button
            className="btn-sol shrink-0 !px-3 lg:hidden"
            aria-label="Escanear con cámara"
            onClick={() => (scanner.cameraOpen ? scanner.stop() : scanner.startCamera())}
          >
            <Camera size={20} />
          </button>
        </div>

        {scanner.error && <p className="text-sm font-semibold text-critical">{scanner.error}</p>}
        {scanner.cameraOpen && (
          <div className="overflow-hidden rounded-lg border-2 border-slate-900" id={scanner.videoId} />
        )}

        <div className="relative">
          <input
            className="field"
            placeholder="Buscar por nombre…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoComplete="off"
          />
          {results.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
              {results.map((p) => (
                <li key={p.productId}>
                  <button
                    onClick={() => {
                      addToCart(p);
                      setTerm('');
                    }}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-100"
                  >
                    <span className="truncate">{p.productName}</span>
                    <span className="ml-2 flex shrink-0 items-center gap-2">
                      <span className={`badge ${p.quantity <= 5 ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                        {p.quantity}
                      </span>
                      <b className="font-mono">{money(p.salePrice)}</b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-critical">
            {error}
          </p>
        )}

        <div className="hidden grid-cols-2 gap-2 sm:grid">
          {catalog.slice(0, 8).map((p) => (
            <button
              key={p.productId}
              onClick={() => addToCart(p)}
              disabled={p.quantity < 1}
              className="card flex items-center justify-between gap-2 p-2.5 text-left transition-colors hover:bg-slate-100 disabled:opacity-40"
            >
              <span className="min-w-0 truncate text-sm font-medium">{p.productName}</span>
              <span className="price-tag rounded px-1.5 py-0.5 font-mono text-sm font-bold">
                {p.salePrice.toFixed(2)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Panel derecho: ticket */}
      <aside className="flex w-full shrink-0 flex-col bg-slate-50 lg:w-[420px]">
        {/* Selector de Comprobante y Cliente */}
        <div className="border-b border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex rounded-lg border border-slate-200 p-0.5 bg-slate-100 text-xs font-semibold">
              <button
                type="button"
                className={`rounded px-3 py-1 transition-colors ${!invoiceMode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}
                onClick={() => {
                  setInvoiceMode(false);
                  if (clientDoc.tipo === 'RUC') setClientDoc({ tipo: '-', numero: '', nombre: '' });
                }}
              >
                Boleta
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1 transition-colors ${invoiceMode ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'}`}
                onClick={() => {
                  setInvoiceMode(true);
                  if (clientDoc.tipo !== 'RUC') setDniModal(true);
                }}
              >
                Factura (RUC)
              </button>
            </div>

            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('¿Vaciar todos los productos del carrito?')) {
                    setCart([]);
                  }
                }}
                className="flex items-center gap-1 text-xs font-semibold text-critical hover:opacity-75"
                title="Vaciar carrito"
              >
                <Trash2 size={13} /> Vaciar
              </button>
            )}
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            {clientDoc.tipo === '-' ? (
              <div className="flex items-center justify-between w-full">
                <span className="text-slate-600 font-medium">Cliente: Consumidor Final</span>
                <button
                  type="button"
                  className="text-blue-600 font-semibold hover:underline"
                  onClick={() => setDniModal(true)}
                >
                  + Agregar DNI / RUC
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full bg-slate-50 p-1.5 rounded border border-slate-200">
                <span className="truncate">
                  <b className="font-mono">{clientDoc.tipo}: {clientDoc.numero}</b> · {clientDoc.nombre}
                </span>
                <button
                  type="button"
                  aria-label="Quitar cliente"
                  onClick={() => {
                    setClientDoc({ tipo: '-', numero: '', nombre: '' });
                    setInvoiceMode(false);
                  }}
                  className="text-slate-400 hover:text-slate-700 ml-1"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
        </div>

        <ul className="min-h-[120px] flex-1 divide-y divide-linea overflow-y-auto">
          {cart.length === 0 ? (
            <li className="grid h-full place-items-center p-6 text-center text-sm text-slate-500">
              Escanea o busca un producto para empezar.
            </li>
          ) : (
            cart.map((l) => (
              <li key={l.productId} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <div className="flex items-center gap-1">
                  <button
                    aria-label={`Restar ${l.name}`}
                    className="rounded-lg border border-slate-200 p-1 hover:bg-slate-100"
                    onClick={() =>
                      setCart((prev) =>
                        prev
                          .map((x) =>
                            x.productId === l.productId
                              ? { ...x, qty: x.qty - 1, total: round2((x.qty - 1) * x.unitPrice) }
                              : x
                          )
                          .filter((x) => x.qty > 0)
                      )
                    }
                  >
                    <Minus size={13} />
                  </button>
                  <span className="w-8 text-center font-mono text-sm">{l.qty}</span>
                  <button
                    aria-label={`Sumar ${l.name}`}
                    className="rounded-lg border border-slate-200 p-1 hover:bg-slate-100 disabled:opacity-30"
                    disabled={l.qty >= l.stock}
                    onClick={() =>
                      setCart((prev) =>
                        prev.map((x) =>
                          x.productId === l.productId
                            ? { ...x, qty: x.qty + 1, total: round2((x.qty + 1) * x.unitPrice) }
                            : x
                        )
                      )
                    }
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <span className="w-16 text-right font-mono text-sm font-semibold">{l.total.toFixed(2)}</span>
              </li>
            ))
          )}
        </ul>

        <div className="space-y-3 border-t-2 border-dashed border-slate-200 p-4">
          <div className="flex items-center justify-between gap-2">
            {PAYMENTS.map((m) => (
              <button
                key={m}
                onClick={() => setPayment(m)}
                className={`flex-1 rounded-lg py-2 text-xs font-bold capitalize ${
                  payment === m ? 'bg-slate-900 text-primary' : 'bg-white border border-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
            <button
              onClick={() => setPayment('otro')}
              className={`flex-1 rounded-lg py-2 text-xs font-bold ${payment === 'otro' ? 'bg-slate-900 text-primary' : 'bg-white border border-slate-200'}`}
            >
              otro
            </button>
          </div>

          {payment === 'efectivo' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label !mb-0.5 text-xs">Con cuánto paga</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.10"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                  placeholder={(total || 0).toFixed(2)}
                  className="field font-mono"
                />
              </div>
              <div>
                <label className="label !mb-0.5 text-xs">Vuelto</label>
                <div className="field flex items-center bg-slate-100 font-mono">{change.toFixed(2)}</div>
              </div>
            </div>
          )}

          <div className="flex items-end justify-between">
            <span className="text-sm font-bold uppercase tracking-wide text-slate-500">
              Total ({cart.length} ítems)
            </span>
            <span className="price-tag rounded-lg px-3 py-1 font-display text-4xl leading-none tracking-wide">
              S/ {total.toFixed(2)}
            </span>
          </div>

          <button className="btn-brand w-full !py-4 text-lg" disabled={cart.length === 0 || busy} onClick={() => void checkout()}>
            <Check size={20} /> Cobrar
          </button>
        </div>
      </aside>

      {/* Modal cliente */}
      <Modal open={dniModal} title="Cliente" onClose={() => setDniModal(false)}>
        <div className="space-y-4">
          <div>
            <label className="label">Factura — RUC</label>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                maxLength={11}
                value={rucValue}
                onChange={(e) => setRucValue(e.target.value.replace(/\D/g, ''))}
                placeholder="11 dígitos"
                className="field font-mono"
              />
              <button className="btn-primary shrink-0" disabled={lookupBusy} onClick={() => void doRucLookup()}>
                Buscar
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Consulta automática de razón social (APIS.net.pe vía servidor).
            </p>
          </div>
          <div className="border-t border-dashed border-slate-200 pt-3">
            <label className="label">Boleta con DNI (opcional; obligatorio ≥ S/ {company?.minBoletaSinDni ?? 700})</label>
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                maxLength={8}
                value={dniValue}
                onChange={(e) => setDniValue(e.target.value.replace(/\D/g, ''))}
                placeholder="8 dígitos"
                className="field font-mono"
              />
              <button className="btn-sol shrink-0" disabled={lookupBusy} onClick={() => void doDniSave()}>
                Usar
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Venta exitosa */}
      <Modal open={receiptDone !== null} title="Venta registrada" onClose={() => setReceiptDone(null)}>
        {receiptDone && (
          <div className="space-y-4 text-center">
            <p className="font-mono text-lg">{receiptDone.code}</p>
            <p className="price-tag mx-auto inline-block rounded-lg px-4 py-2 font-display text-4xl">
              S/ {receiptDone.total.toFixed(2)}
            </p>
            {payment === 'efectivo' && receiptDone.change > 0 && (
              <p className="text-lg font-semibold">
                Vuelto: <span className="font-mono">S/ {receiptDone.change.toFixed(2)}</span>
              </p>
            )}
            <div className="flex justify-center gap-2">
              <button className="btn-ghost" onClick={() => printTicket(receiptDone.html)}>
                Imprimir ticket
              </button>
              <button className="btn-brand" onClick={() => setReceiptDone(null)}>
                Nueva venta
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
