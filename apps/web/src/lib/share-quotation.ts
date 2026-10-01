let whatsappWindow: Window | null = null;

export function isMobileShareDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canShareQuotation(file: File): boolean {
  try { return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true; }
  catch { return false; }
}

export function downloadQuotation(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function quotationPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits && !value.trim()) return '';
  if (digits.length === 9) return `51${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  throw new Error('Escribe 9 dígitos para Perú o incluye el código de país.');
}

export function quotationWhatsAppUrl(phone: string, desktopApp = false): string {
  const number = quotationPhone(phone);
  if (desktopApp) return `whatsapp://send${number ? `?phone=${number}` : ''}`;
  if (isMobileShareDevice()) return number ? `https://wa.me/${number}` : 'whatsapp://send';
  return number ? `https://web.whatsapp.com/send?phone=${number}` : 'https://web.whatsapp.com/';
}

export function openQuotationWhatsApp(phone: string, desktopApp = false): boolean {
  const url = quotationWhatsAppUrl(phone, desktopApp);
  if (desktopApp) {
    window.location.href = url;
    return true;
  }
  if (whatsappWindow && !whatsappWindow.closed) {
    try { whatsappWindow.location.href = url; whatsappWindow.focus(); return true; }
    catch { whatsappWindow = null; }
  }
  whatsappWindow = window.open(url, 'denzoz-whatsapp');
  if (!whatsappWindow) return false;
  try { whatsappWindow.opener = null; whatsappWindow.focus(); } catch { /* WhatsApp puede aislar su ventana al cargar. */ }
  return true;
}
