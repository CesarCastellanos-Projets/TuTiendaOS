import { DEFAULT_TICKET_DESIGN, type CompanyConfig, type Sale, type TicketDesign } from '../types';
import { fmtDateTime } from './utils';
import { PAYMENT_LABELS, salePayments } from './payments';

export function ticketDesign(cfg?: CompanyConfig): TicketDesign {
  const source = cfg?.ticketDesign;
  return {
    layout: source?.layout === 'compact' ? 'compact' : 'detailed',
    fontSize: bounded(source?.fontSize, 9, 14, DEFAULT_TICKET_DESIGN.fontSize),
    logoWidth: bounded(source?.logoWidth, 40, 180, DEFAULT_TICKET_DESIGN.logoWidth),
    headerAlign: source?.headerAlign === 'left' ? 'left' : 'center',
    showCode: source?.showCode === true,
    showUnitPrice: source?.showUnitPrice !== false,
    showCashier: source?.showCashier !== false,
    showClient: source?.showClient !== false
  };
}

export function ticketLogoSource(value?: string | null): string {
  const source = value?.trim() ?? '';
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
  if (source.startsWith('/') && !source.startsWith('//')) return source;
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function ticketHtml(sale: Sale, cfg?: CompanyConfig): string {
  const design = ticketDesign(cfg);
  const logo = ticketLogoSource(cfg?.logoUrl);
  const itemDescription = (item: Sale['items'][number]) => `${esc(item.name)}${item.presentationId ? `<small>${esc(item.presentationLabel || item.presentationUnit || 'Presentación')} · ${Math.round(item.qty * (item.factor ?? 1) * 1000) / 1000} un</small>` : ''}`;
  const lines = design.layout === 'compact'
    ? sale.items.map((item) => `<div class="ticket-item"><div>${itemDescription(item)}</div><div class="row"><span>${esc(ticketItemDetail(item))}${design.showUnitPrice ? ` · S/ ${item.unitPrice.toFixed(2)}` : ''}</span><span class="mono r">${item.total.toFixed(2)}</span></div>${design.showCode ? `<small>Cód.: ${esc(item.barcode || item.productId)}</small>` : ''}</div>`).join('')
    : `<table class="ticket-items"><thead><tr>${design.showCode ? '<th class="item-code">CÓD.</th>' : ''}<th class="item-qty r">CANT.</th><th class="item-unit">UNID.</th><th>DESCRIPCIÓN</th>${design.showUnitPrice ? '<th class="item-money r">P.UNIT.</th>' : ''}<th class="item-money r">TOTAL</th></tr></thead><tbody>${sale.items.map((item) => `<tr>${design.showCode ? `<td class="item-code">${esc(item.barcode || item.productId)}</td>` : ''}<td class="item-qty r">${item.qty}</td><td class="item-unit">${esc(item.presentationUnit || 'UN')}</td><td>${itemDescription(item)}</td>${design.showUnitPrice ? `<td class="item-money r">${item.unitPrice.toFixed(2)}</td>` : ''}<td class="item-money r">${item.total.toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="thermal-ticket" data-ticket-width="${cfg?.ticketWidth === '58mm' ? '58mm' : '80mm'}" style="font-size:${design.fontSize}px;">
  <div class="head" style="text-align:${design.headerAlign};">
    ${logo ? `<div class="ticket-logo"><img src="${esc(logo)}" style="width:${design.logoWidth}px;" alt="Logo" /></div>` : ''}
    <div class="brand">${esc(cfg?.razonSocial ?? "TuTiendaOS")}</div>
    ${cfg?.slogan ? `<div>${esc(cfg.slogan)}</div>` : ''}
    ${cfg?.ruc ? `<div>R.U.C. ${esc(cfg.ruc)}</div>` : ''}
    ${cfg?.direccion ? `<div>${esc(cfg.direccion)}</div>` : ''}
    ${cfg?.phone ? `<div>Tel.: ${esc(cfg.phone)}</div>` : ''}
    <div>${esc(sale.storeName)}</div>
    <div class="ticket-document">${sale.type === 'nota' ? 'NOTA DE VENTA' : sale.type === 'factura' ? 'FACTURA ELECTRÓNICA' : 'BOLETA DE VENTA ELECTRÓNICA'}</div>
    <div class="ticket-document">${esc(sale.code)}${sale.consolidated ? ' (CONSOLIDADO)' : ''}</div>
  </div>
  <hr />
  <div>Fecha de emisión: ${esc(fmtDateTime(sale.createdAt))}</div>
  ${design.showCashier ? `<div>Cajero: ${esc(sale.userName)}</div>` : ''}
  ${design.showClient ? `<div>Cliente: ${esc(sale.clientDoc.nombre || 'Consumidor final')}</div>${sale.clientDoc.tipo !== '-' ? `<div>${esc(sale.clientDoc.tipo)}: ${esc(sale.clientDoc.numero)}</div>` : ''}` : ''}
  <hr />${lines}<hr />
  <div class="row"><span>SUBTOTAL</span><span class="mono r">S/ ${sale.subtotal.toFixed(2)}</span></div>
  <div class="row"><span>IGV (${((sale.igvRate ?? cfg?.igvRate ?? 0.18) * 100).toFixed(0)}%)</span><span class="mono r">S/ ${sale.igv.toFixed(2)}</span></div>
  <div class="row total"><span>TOTAL A PAGAR</span><span class="mono r">S/ ${sale.total.toFixed(2)}</span></div>
  <hr />
  <div>Condición de pago: Contado</div>
  ${salePayments(sale).map((part) => `<div class="row"><span>${esc(PAYMENT_LABELS[part.method])}</span><span class="mono r">S/ ${part.amount.toFixed(2)}</span></div>${part.bankName ? `<small>Banco: ${esc(part.bankName)}</small>` : ''}${part.operationNumber ? `<small>Operación: ${esc(part.operationNumber)}</small>` : ''}`).join('')}
  ${salePayments(sale).some((part) => part.method === 'efectivo') ? `<div class="row"><span>Efectivo recibido</span><span class="mono r">S/ ${(salePayments(sale).find((part) => part.method === 'efectivo')?.receivedAmount ?? 0).toFixed(2)}</span></div><div class="row"><span>Vuelto</span><span class="mono r">S/ ${sale.changeAmount.toFixed(2)}</span></div>` : ''}
  <hr /><div class="foot">${esc(cfg?.footerText ?? '¡Gracias por su compra!')}</div></div>`;
}

export interface PrintResult { missingImages: number }
let printQueue: Promise<void> = Promise.resolve();

export function printTicket(html: string): Promise<PrintResult> {
  const pending = printQueue.then(() => preparePrint(html));
  printQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function preparePrint(html: string): Promise<PrintResult> {
  document.getElementById('ticket-print')?.remove();
  const holder = document.createElement('div');
  holder.id = 'ticket-print';
  holder.innerHTML = html;
  holder.dataset.width = (holder.firstElementChild as HTMLElement | null)?.dataset.ticketWidth === '58mm' ? '58mm' : '80mm';
  document.body.appendChild(holder);
  const cleanup = () => { holder.remove(); window.removeEventListener('afterprint', cleanup); };
  try {
    const images = await Promise.all(Array.from(holder.querySelectorAll('img')).map(waitForImage));
    await Promise.race([document.fonts.ready.catch(() => undefined), new Promise<void>((resolve) => window.setTimeout(resolve, 1500))]);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 300000);
    return { missingImages: images.filter((loaded) => !loaded).length };
  } catch (error) { cleanup(); throw error; }
}

function waitForImage(image: HTMLImageElement): Promise<boolean> {
  if (image.complete) { if (!image.naturalWidth) image.hidden = true; return Promise.resolve(image.naturalWidth > 0); }
  return new Promise((resolve) => {
    const finish = (loaded: boolean) => {
      window.clearTimeout(timer);
      image.removeEventListener('load', loadedImage);
      image.removeEventListener('error', failedImage);
      if (!loaded) image.hidden = true;
      resolve(loaded);
    };
    const loadedImage = () => finish(image.naturalWidth > 0);
    const failedImage = () => finish(false);
    const timer = window.setTimeout(failedImage, 8000);
    image.addEventListener('load', loadedImage, { once: true });
    image.addEventListener('error', failedImage, { once: true });
  });
}

function bounded(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value!))) : fallback;
}

export function cashCloseTicketHtml(
  session: {
    storeName?: string;
    userName: string;
    openingAmount: number;
    closingAmount?: number;
    expectedAmount?: number;
    difference?: number;
    cashBalanceAdjustment?: number;
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

  return `<div class="thermal-ticket" data-ticket-width="${cfg?.ticketWidth === '58mm' ? '58mm' : '80mm'}">
  <div class="head">
    <div class="brand">${esc(cfg?.razonSocial ?? "TuTiendaOS")}</div>
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
  ${session.cashBalanceAdjustment ? `<div class="row"><span>Anulaciones / reembolsos:</span><span class="mono r">S/ ${session.cashBalanceAdjustment.toFixed(2)}</span></div>` : ''}
  <div class="row"><span>Ventas Yape / Plin:</span><span class="mono r">S/ ${salesSummary.yapeSales.toFixed(2)}</span></div>
  <div class="row"><span>Ventas Tarjeta:</span><span class="mono r">S/ ${salesSummary.cardSales.toFixed(2)}</span></div>
  ${salesSummary.otherSales > 0 ? `<div class="row"><span>Otros medios:</span><span class="mono r">S/ ${salesSummary.otherSales.toFixed(2)}</span></div>` : ''}
  <hr />
  <div class="row total"><span>TOTAL VENTAS (${salesSummary.salesCount}):</span><span class="mono r">S/ ${salesSummary.totalSales.toFixed(2)}</span></div>
  <hr />
  <div class="row"><span>Efectivo Esperado:</span><span class="mono r">S/ ${(session.expectedAmount ?? (session.openingAmount + salesSummary.cashSales + (session.cashBalanceAdjustment ?? 0))).toFixed(2)}</span></div>
  <div class="row"><span>Efectivo Contado:</span><span class="mono r">S/ ${(session.closingAmount ?? 0).toFixed(2)}</span></div>
  <div class="row" style="font-weight:bold;"><span>DIFERENCIA:</span><span class="mono r">${diffLabel}</span></div>
  <br /><br />
  <div style="text-align:center;font-size:11px;line-height:1.5;">
    __________________________<br />
    Firma Cajero: ${esc(session.userName)}<br /><br />
    __________________________<br />
    V°B° Administrador / Supervisor
  </div></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function ticketItemDetail(item: Sale['items'][number]): string {
  if (!item.presentationId) return `${item.qty} un x ${item.unitPrice.toFixed(2)}`;
  const label = item.presentationLabel || item.presentationUnit || 'pres.';
  const equivalent = Math.round((item.qty * (item.factor ?? 1) + Number.EPSILON) * 1000) / 1000;
  return `${item.qty} ${label} = ${equivalent} un`;
}
