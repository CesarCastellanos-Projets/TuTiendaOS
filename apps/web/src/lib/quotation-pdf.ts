import type { CompanyConfig, QuotationItem } from '../types';
import { ticketLogoSource } from './print';

export interface QuotationPdfData {
  items: QuotationItem[];
  clientName: string;
  storeName: string;
  note: string;
  createdAt: number;
}

export async function createQuotationPdf(data: QuotationPdfData, company?: CompanyConfig): Promise<File> {
  if (!data.items.length || data.items.some((item) => !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.total) || !Number.isFinite(item.unitPrice))) {
    throw new Error('Revisa las cantidades de la cotización antes de compartir el PDF.');
  }
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), loadLogo(company?.logoUrl)]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const left = 15;
  const right = 195;
  let y = 20;
  const text = (value: string, x: number, size = 10, align: 'left' | 'right' = 'left') => {
    pdf.setFontSize(size);
    pdf.text(value, x, y, { align });
  };
  const rule = () => { pdf.setDrawColor(205, 213, 224); pdf.line(left, y, right, y); };
  if (logo) {
    const scale = Math.min(45 / logo.width, 22 / logo.height);
    pdf.addImage(logo.png, 'PNG', left, y - 6, logo.width * scale, logo.height * scale);
    y += logo.height * scale + 3;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(25, 39, 65);
  const companyLines = pdf.splitTextToSize(company?.razonSocial || "D'ENZOZ", 180) as string[];
  pdf.setFontSize(15);
  pdf.text(companyLines, left, y);
  y += companyLines.length * 6 + 2;
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(55, 65, 81);
  for (const value of [company?.ruc ? `RUC: ${company.ruc}` : '', company?.direccion, company?.phone ? `Tel.: ${company.phone}` : '']) {
    if (!value) continue;
    pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(value, 180) as string[];
    pdf.text(lines, left, y); y += lines.length * 4.5;
  }
  y += 5;
  pdf.setFont('helvetica', 'bold'); text('COTIZACIÓN ESTIMADA', left, 13); y += 7;
  pdf.setFont('helvetica', 'normal');
  text(`Fecha: ${new Date(data.createdAt).toLocaleString('es-PE')}`, left, 9); y += 5;
  for (const value of [`Cliente: ${data.clientName || 'Consumidor final'}`, `Tienda: ${data.storeName}`]) {
    const lines = pdf.splitTextToSize(value, 180) as string[];
    pdf.text(lines, left, y); y += lines.length * 4.5;
  }
  y += 5;
  const tableHeader = () => {
    pdf.setFillColor(238, 242, 248); pdf.rect(left, y - 4, 180, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    text('DESCRIPCIÓN / PRESENTACIÓN', left + 2, 8);
    text('CANT.', 132, 8, 'right'); text('P. UNIT.', 160, 8, 'right'); text('TOTAL S/', right - 2, 8, 'right');
    y += 8; pdf.setFont('helvetica', 'normal');
  };
  const newPage = (repeatHeader: boolean) => { pdf.addPage(); y = 20; if (repeatHeader) tableHeader(); };
  const space = (height: number, repeatHeader = true) => { if (y + height > 274) newPage(repeatHeader); };
  tableHeader();
  for (const item of data.items) {
    pdf.setFontSize(9);
    const name = pdf.splitTextToSize(item.name, 99) as string[];
    const details = [item.presentationLabel || item.unit || 'UN', item.isAvailable ? 'Disponible en tienda' : `Disponibilidad actual: ${item.availableQty}`];
    const detailLines = pdf.splitTextToSize(details.join(' · '), 99) as string[];
    const height = name.length * 4.5 + detailLines.length * 4 + 6;
    space(height);
    pdf.setFontSize(9); pdf.text(name, left + 2, y);
    text(`${item.qty}`, 132, 9, 'right'); text(item.unitPrice.toFixed(2), 160, 9, 'right'); text(item.total.toFixed(2), right - 2, 9, 'right');
    y += name.length * 4.5;
    pdf.setFontSize(8); pdf.setTextColor(85, 95, 110); pdf.text(detailLines, left + 2, y);
    pdf.setTextColor(55, 65, 81); y += detailLines.length * 4 + 3; rule(); y += 3;
  }
  const totalAll = data.items.reduce((sum, item) => sum + item.total, 0);
  const totalAvailable = data.items.filter((item) => item.isAvailable).reduce((sum, item) => sum + item.total, 0);
  space(24, false); y += 4;
  text('Total disponible en tienda', left, 10); text(`S/ ${totalAvailable.toFixed(2)}`, right, 10, 'right'); y += 7;
  pdf.setFont('helvetica', 'bold'); text('TOTAL DE LA COTIZACIÓN', left, 11); text(`S/ ${totalAll.toFixed(2)}`, right, 11, 'right'); y += 10;
  pdf.setFont('helvetica', 'normal');
  for (const value of [data.note ? `Observaciones: ${data.note}` : '', 'Precios sujetos a disponibilidad al momento de la compra. Esta cotización no es un comprobante de pago.', company?.footerText || 'Gracias por su preferencia.']) {
    if (!value) continue;
    pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(value, 180) as string[];
    for (const line of lines) { space(5, false); pdf.text(line, left, y); y += 4.5; }
    y += 3;
  }
  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page); pdf.setFontSize(8); pdf.setTextColor(100, 110, 120);
    pdf.text(`Cotización · ${page} / ${pages}`, right, 288, { align: 'right' });
  }
  const created = new Date(data.createdAt);
  const date = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
  const client = data.clientName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 50) || 'cliente';
  return new File([pdf.output('blob')], `Cotizacion-${client}-${date}.pdf`, { type: 'application/pdf' });
}

async function loadLogo(value?: string): Promise<{ png: string; width: number; height: number } | null> {
  if (!value) return null;
  const source = ticketLogoSource(value);
  if (!source) throw new Error('El enlace del logo no es válido. Revísalo en Diseño de tickets.');
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Logo no disponible');
    const blob = await response.blob();
    if (blob.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type.split(';')[0])) throw new Error('Formato de logo inválido');
    const image = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, 800 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo preparar el logo');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { png: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    } finally { image.close(); }
  } catch {
    throw new Error('No se pudo incluir el logo. Sube una imagen PNG o JPG en Diseño de tickets; algunos enlaces impiden usar la imagen en un PDF.');
  }
}
