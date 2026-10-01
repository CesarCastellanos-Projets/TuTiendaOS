import { useEffect, useState } from 'react';
import { getDocs, limit, query, where, orderBy, getDoc } from 'firebase/firestore';
import { onSnapshot } from '../../lib/firestore-listener';
import { Printer, Vault, CheckCircle2 } from 'lucide-react';
import { tenantCollection, tenantDoc } from '../../lib/tenant-firestore';
import { useAuth } from '../../lib/auth';
import { useCompany } from '../../hooks/useCompany';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { CashSession } from '../../types';
import { fmtDateTime, money, num } from '../../lib/utils';
import { printTicket, cashCloseTicketHtml } from '../../lib/print';
import { FlashBar, useFlash } from '../../components/ui/Feedback';

interface SalesSummary {
  totalSales: number;
  cashSales: number;
  yapeSales: number;
  cardSales: number;
  otherSales: number;
  salesCount: number;
}

export function CashPage() {
  const profile = useAuth((s) => s.profile)!;
  const user = useAuth((s) => s.user);
  const company = useCompany();
  const [session, setSession] = useState<(CashSession & { id: string }) | null>(null);
  const [lastClosedSession, setLastClosedSession] = useState<(CashSession & { id: string }) | null>(null);
  const [summary, setSummary] = useState<SalesSummary>({
    totalSales: 0,
    cashSales: 0,
    yapeSales: 0,
    cardSales: 0,
    otherSales: 0,
    salesCount: 0
  });
  const [openingAmount, setOpeningAmount] = useState('50');
  const [closingAmount, setClosingAmount] = useState('');
  const [storeName, setStoreName] = useState('Mi tienda');
  const [busy, setBusy] = useState(false);
  const { msg, flash } = useFlash();

  useEffect(() => {
    if (profile.storeId) {
      void getDoc(tenantDoc('stores', profile.storeId)).then((s) => {
        if (s.exists()) setStoreName((s.data() as { name: string }).name);
      });
    }
  }, [profile.storeId]);

  useEffect(() => {
    if (!user) return;
    const unsubOpen = onSnapshot(
      query(
        tenantCollection('cash_sessions'),
        where('userId', '==', user.uid),
        where('storeId', '==', profile.storeId),
        where('status', 'in', ['abierta', 'cerrando']),
        limit(1)
      ),
      (s) => {
        if (!s.empty) {
          const current = s.docs[0].data() as CashSession;
          setSession({ ...current, id: s.docs[0].id });
          if (current.status === 'cerrando') setClosingAmount(String(current.closingAmount ?? 0));
        } else {
          setSession(null);
          // Cargar última cerrada para posible reimpresión
          void getDocs(
            query(
              tenantCollection('cash_sessions'),
              where('userId', '==', user.uid),
              where('storeId', '==', profile.storeId),
              where('status', '==', 'cerrada'),
              orderBy('closedAt', 'desc'),
              limit(1)
            )
          ).then((snap) => {
            if (!snap.empty) setLastClosedSession({ ...(snap.docs[0].data() as CashSession), id: snap.docs[0].id });
          });
        }
      }
    );
    return () => unsubOpen();
  }, [profile.storeId, user]);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    const refresh = async () => {
      try {
        const response = await httpsCallable<{ sessionId: string }, SalesSummary>(functions, 'getCashSessionSummary')({ sessionId: session.id });
        if (alive) setSummary(response.data);
      } catch (err) {
        if (alive) flash(err instanceof Error ? err.message : 'No se pudo consultar el resumen');
      }
    };
    const unsub = onSnapshot(query(tenantCollection('sales'), where('cashSessionId', '==', session.id),
      where('userId', '==', user?.uid ?? ''), where('storeId', '==', profile.storeId), orderBy('createdAt', 'desc'), limit(1)), () => void refresh());
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => { alive = false; unsub(); window.clearInterval(timer); };
  }, [profile.storeId, session, user?.uid, flash]);

  const open = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await httpsCallable(functions, 'openCashSession')({ openingAmount: num(openingAmount) });
      flash('Caja abierta exitosamente.');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Error al abrir caja');
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!session || !user) return;
    setBusy(true);
    try {
      const response = await httpsCallable<{ sessionId: string; closingAmount: number }, CashSession & { id: string }>(functions, 'closeCashSession')({ sessionId: session.id, closingAmount: num(closingAmount) });
      const closed = response.data;
      setLastClosedSession(closed);
      if (!closed.salesSummary) throw new Error('El cierre no contiene el desglose de ventas.');
      printTicket(cashCloseTicketHtml({ ...closed, storeName }, closed.salesSummary, company ?? undefined));
      flash(`Caja cerrada. Total vendido: ${money(closed.salesSummary.totalSales)}`);
      setClosingAmount('');
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Error al cerrar caja');
    } finally {
      setBusy(false);
    }
  };

  const reprintLastZ = () => {
    if (!lastClosedSession) return;
    if (!lastClosedSession.salesSummary) { flash('El cierre antiguo no tiene desglose verificable para reimprimir.'); return; }
    printTicket(
      cashCloseTicketHtml(
        { ...lastClosedSession, storeName },
        lastClosedSession.salesSummary!,
        company ?? undefined
      )
    );
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide">
          <Vault size={22} /> Control de Caja
        </h1>
        {lastClosedSession && !session && (
          <button
            onClick={reprintLastZ}
            className="btn-ghost flex items-center gap-1 !min-h-8 !px-2.5 text-xs font-semibold"
          >
            <Printer size={14} /> Reimprimir último Cierre Z
          </button>
        )}
      </div>

      {!session ? (
        <div className="card space-y-4 p-5">
          <p className="text-sm text-slate-500">Abre la caja para habilitar el punto de venta y registrar ventas del turno.</p>
          <div>
            <label className="label">Monto inicial en caja (Sencillo / Base) S/</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.10"
              min="0"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
              className="field font-mono text-lg font-bold"
            />
          </div>
          <button disabled={busy} className="btn-brand w-full" onClick={() => void open()}>
            {busy ? 'Abriendo…' : 'Abrir caja e iniciar turno'}
          </button>
        </div>
      ) : (
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="badge bg-emerald-50 text-success font-bold flex items-center gap-1">
              <CheckCircle2 size={13} /> {session.status === 'cerrando' ? 'Cierre pendiente: reintenta para terminar' : 'Turno activo (caja abierta)'}
            </span>
            <span className="text-xs text-slate-500 font-mono">Desde {fmtDateTime(session.openedAt)}</span>
          </div>

          {/* Desglose de Ventas del Turno */}
          <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 space-y-2 text-sm">
            <p className="text-xs font-bold uppercase text-slate-500 tracking-wide">Resumen de ventas del turno:</p>
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">Base / Monto inicial:</span>
              <b className="font-mono">{money(session.openingAmount)}</b>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">Ventas en Efectivo:</span>
              <b className="font-mono text-success">{money(summary.cashSales)}</b>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">Ventas Yape / Plin:</span>
              <b className="font-mono">{money(summary.yapeSales)}</b>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">Ventas Tarjeta:</span>
              <b className="font-mono">{money(summary.cardSales)}</b>
            </div>
            <div className="border-t border-slate-200 pt-1.5 flex justify-between font-semibold">
              <span>Total Ventas ({summary.salesCount} tickets):</span>
              <span className="font-mono text-primary">{money(summary.totalSales)}</span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-dashed border-slate-200">
              <span className="text-slate-700 font-medium">Efectivo esperado en gaveta:</span>
              <b className="font-mono font-bold text-slate-900">
                {money(session.openingAmount + summary.cashSales)}
              </b>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <label className="label">Monto en efectivo contado al cierre S/ *</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.10"
              min="0"
              placeholder="0.00"
              value={closingAmount}
              disabled={session.status === 'cerrando'}
              onChange={(e) => setClosingAmount(e.target.value)}
              className="field font-mono text-lg font-bold"
            />
          </div>

          {closingAmount && (
            <div className="rounded p-2 text-xs flex justify-between bg-slate-100 font-semibold">
              <span>Diferencia calculada:</span>
              <span className="font-mono">
                {money(num(closingAmount) - (session.openingAmount + summary.cashSales))}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={busy || !closingAmount}
              className="btn-primary flex-1"
              onClick={() => void close()}
            >
              {busy ? 'Cerrando…' : 'Cerrar caja e imprimir Corte Z'}
            </button>
          </div>

          <p className="text-[11px] text-slate-500 text-center">
            Al cerrar caja se imprimirá automáticamente el ticket de arqueo físico para firma.
          </p>
        </div>
      )}

      <FlashBar msg={msg} />
    </div>
  );
}
