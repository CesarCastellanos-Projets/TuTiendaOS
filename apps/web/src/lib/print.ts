import type { CompanyConfig, Sale } from '../types';
import { fmtDateTime } from './utils';

export function ticketHtml(sale: Sale, cfg?: CompanyConfig): string {
  const lines = sale.items
    .map(
      (i) =>
        `<div class="row"><span class="name">${esc(i.name)}</span>` +
        `<span class="mono">${i.qty} x ${i.unitPrice.toFixed(2)}</span>` +
        `<span class="mono r">${i.total.toFixed(2)}</span></div>`
    )
    .join('');

  return `
  <div class="head">
    ${cfg?.logoUrl ? `<div style="text-align:center;margin-bottom:6px;"><img src="${esc(cfg.logoUrl)}" style="max-height:48px;max-width:140px;display:inline-block;filter:grayscale(100%);" alt="Logo" /></div>` : ''}
    <div class="brand">${esc(cfg?.razonSocial ?? "D'ENZOZ")}</div>
    ${cfg?.slogan ? `<div style="font-size:10px;color:#555;margin-bottom:2px;">${esc(cfg.slogan)}</div>` : ''}
    ${cfg?.ruc ? `<div>RUC: ${esc(cfg.ruc)}</div>` : ''}
    ${cfg?.direccion ? `<div style="font-size:10px;">${esc(cfg.direccion)}</div>` : ''}
    ${cfg?.phone ? `<div style="font-size:10px;">Tel: ${esc(cfg.phone)}</div>` : ''}
    <div style="font-weight:bold;margin-top:3px;">${esc(sale.storeName)}</div>
    <div style="font-weight:bold;font-size:13px;margin:2px 0;">${sale.type.toUpperCase()} ELECTRÓNICA: ${esc(sale.code)}${sale.consolidated ? ' (CONSOLIDADO)' : ''}</div>
    <div>Fecha: ${fmtDateTime(sale.createdAt)}</div>
    <div>Cajero: ${esc(sale.userName)}</div>
    ${sale.clientDoc.tipo !== '-' ? `<div>Cliente: ${esc(sale.clientDoc.nombre)} (${esc(sale.clientDoc.numero)})</div>` : ''}
  </div>
  <hr />
  ${lines}
  <hr />
  <div class="row"><span>SUBTOTAL</span><span class="mono r">S/ ${sale.subtotal.toFixed(2)}</span></div>
  <div class="row"><span>IGV (${((cfg?.igvRate ?? 0.18) * 100).toFixed(0)}%)</span><span class="mono r">S/ ${sale.igv.toFixed(2)}</span></div>
  <div class="row total"><span>TOTAL A PAGAR</span><span class="mono r">S/ ${sale.total.toFixed(2)}</span></div>
  <div class="row"><span>Pago: ${esc(sale.paymentMethod).toUpperCase()}</span><span class="mono r">Vuelto S/ ${sale.changeAmount.toFixed(2)}</span></div>
  <hr />
  <div class="foot" style="text-align:center;font-size:11px;margin-top:6px;line-height:1.4;">
    ${esc(cfg?.footerText ?? '¡Gracias por su compra!')}
  </div>`;
}

export function printTicket(html: string): void {
  let holder = document.getElementById('ticket-print');
  if (!holder) {
    holder = document.createElement('div');
    holder.id = 'ticket-print';
    document.body.appendChild(holder);
  }
  holder.innerHTML = html;
  window.print();
}

export function cashCloseTicketHtml(
  session: {
    storeName?: string;
    userName: string;
    openingAmount: number;
    closingAmount?: number;
    expectedAmount?: number;
    difference?: number;
    openedAt: number;
    closedAt?: number;
  },
  salesSummary: {
    totalSales: number;
    cashSales: number;
    yapeSales: number;
    cardSales: number;
    otherSales: number;
    salesCount: number;
  },
  cfg?: CompanyConfig
): string {
  const diff = session.difference ?? 0;
  const diffLabel = diff === 0 ? 'CUADRADO' : diff > 0 ? `SOBRANTE +${diff.toFixed(2)}` : `FALTANTE ${diff.toFixed(2)}`;

  return `
  <div class="head">
    <div class="brand">${esc(cfg?.razonSocial ?? "D'ENZOZ")}</div>
    ${cfg?.ruc ? `<div>RUC ${esc(cfg.ruc)}</div>` : ''}
    <div>${esc(session.storeName ?? 'TIENDA')}</div>
    <div style="font-weight:bold;margin:4px 0;">=== CIERRE DE CAJA (CORTE Z) ===</div>
    <div>Apertura: ${fmtDateTime(session.openedAt)}</div>
    <div>Cierre: ${fmtDateTime(session.closedAt ?? Date.now())}</div>
    <div>Cajero: ${esc(session.userName)}</div>
  </div>
  <hr />
  <div class="row"><span>Monto inicial en caja:</span><span class="mono r">S/ ${session.openingAmount.toFixed(2)}</span></div>
  <div class="row"><span>Ventas en Efectivo:</span><span class="mono r">S/ ${salesSummary.cashSales.toFixed(2)}</span></div>
  <div class="row"><span>Ventas Yape / Plin:</span><span class="mono r">S/ ${salesSummary.yapeSales.toFixed(2)}</span></div>
  <div class="row"><span>Ventas Tarjeta:</span><span class="mono r">S/ ${salesSummary.cardSales.toFixed(2)}</span></div>
  ${salesSummary.otherSales > 0 ? `<div class="row"><span>Otros medios:</span><span class="mono r">S/ ${salesSummary.otherSales.toFixed(2)}</span></div>` : ''}
  <hr />
  <div class="row total"><span>TOTAL VENTAS (${salesSummary.salesCount}):</span><span class="mono r">S/ ${salesSummary.totalSales.toFixed(2)}</span></div>
  <hr />
  <div class="row"><span>Efectivo Esperado:</span><span class="mono r">S/ ${(session.expectedAmount ?? (session.openingAmount + salesSummary.cashSales)).toFixed(2)}</span></div>
  <div class="row"><span>Efectivo Contado:</span><span class="mono r">S/ ${(session.closingAmount ?? 0).toFixed(2)}</span></div>
  <div class="row" style="font-weight:bold;"><span>DIFERENCIA:</span><span class="mono r">${diffLabel}</span></div>
  <br /><br />
  <div style="text-align:center;font-size:11px;line-height:1.5;">
    __________________________<br />
    Firma Cajero: ${esc(session.userName)}<br /><br />
    __________________________<br />
    V°B° Administrador / Supervisor
  </div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

