import { EditableNumberInput } from '../../components/ui/EditableNumberInput';
import { useEffect, useMemo, useRef, useState } from 'react';
import { runTransaction } from 'firebase/firestore';
import { Printer, Upload, Image, Trash2, Check } from 'lucide-react';
import { db } from '../../lib/firebase';
import { tenantDoc } from '../../lib/tenant-firestore';
import { useCompany } from '../../hooks/useCompany';
import { DEFAULT_COMPANY, DEFAULT_TICKET_DESIGN, type CompanyConfig, type Sale, type TicketDesign } from '../../types';
import { FlashBar, useFlash } from '../../components/ui/Feedback';
import { ticketHtml, ticketDesign, ticketLogoSource, printTicket } from '../../lib/print';

interface TicketDraft {
  logoUrl: string;
  slogan: string;
  phone: string;
  footerText: string;
  ticketWidth: '80mm' | '58mm';
  ticketDesign: TicketDesign;
}

export function TicketDesignerPage() {
  const cfg = useCompany();
  const [draft, setDraft] = useState<TicketDraft>({ logoUrl: '', slogan: '', phone: '', footerText: DEFAULT_COMPANY.footerText ?? '', ticketWidth: '80mm', ticketDesign: DEFAULT_TICKET_DESIGN });
  const dirty = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewDocType, setPreviewDocType] = useState<'boleta' | 'factura'>('boleta');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const { msg, flash } = useFlash();
  useEffect(() => {
    if (cfg && !dirty.current) setDraft({ logoUrl: cfg.logoUrl ?? '', slogan: cfg.slogan ?? '', phone: cfg.phone ?? '', footerText: cfg.footerText ?? '', ticketWidth: cfg.ticketWidth ?? '80mm', ticketDesign: ticketDesign(cfg) });
  }, [cfg]);
  useEffect(() => setLogoError(false), [draft.logoUrl]);
  const update = <K extends keyof TicketDraft>(key: K, value: TicketDraft[K]) => {
    dirty.current = true;
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const updateDesign = <K extends keyof TicketDesign>(key: K, value: TicketDesign[K]) => update('ticketDesign', { ...draft.ticketDesign, [key]: value });
  const sampleSale = useMemo((): Sale => ({
    code: previewDocType === 'boleta' ? 'B001-00000142' : 'F001-00000089', serie: previewDocType === 'boleta' ? 'B001' : 'F001', correlativo: 142, type: previewDocType,
    storeId: 'demo-store', storeName: 'Tienda principal', userId: 'demo-user', userName: 'Rosa Cajera',
    clientDoc: previewDocType === 'boleta' ? { tipo: 'DNI', numero: '74839201', nombre: 'Carlos Mendoza' } : { tipo: 'RUC', numero: '20601234567', nombre: 'DISTRIBUIDORA LIMA S.A.C.' },
    items: [
      { productId: '1', barcode: '7750000000001', name: 'Gaseosa Cola 500ml', presentationUnit: 'UN', qty: 2, unitPrice: 3.5, total: 7 },
      { productId: '2', barcode: '7750000000002', name: 'Galletas Chocolate', presentationUnit: 'PAQ', presentationId: 'pack6', presentationLabel: 'Paquete x6', factor: 6, qty: 1, unitPrice: 5.5, total: 5.5 },
      { productId: '3', barcode: '7750000000003', name: 'Aceite Vegetal 1L', presentationUnit: 'UN', qty: 1, unitPrice: 9.8, total: 9.8 }
    ], subtotal: 18.9, igv: 3.4, igvRate: 0.18, total: 22.3, paymentMethod: 'efectivo', paidAmount: 30, changeAmount: 7.7, consolidated: false, sunatStatus: 'aceptado', status: 'activa', createdAt: Date.now()
  }), [previewDocType]);
  const previewConfig: CompanyConfig = { ...(cfg ?? DEFAULT_COMPANY), ...draft };
  const previewHtml = ticketHtml(sampleSale, previewConfig);
  const logoSource = ticketLogoSource(draft.logoUrl);
  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { flash('Error: usa PNG, JPG o WEBP de hasta 200 KB'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') update('logoUrl', reader.result); };
    reader.onerror = () => flash('Error: no se pudo leer la imagen');
    reader.readAsDataURL(file);
  };
  const save = async () => {
    if (!cfg) return;
    if (draft.logoUrl.trim() && (!logoSource || logoError)) { flash('Error: el logo no carga. Usa un enlace directo a la imagen o súbela desde tu equipo.'); return; }
    setBusy(true);
    try {
      const ref = tenantDoc('config', 'company');
      const patch = { ...draft, logoUrl: logoSource || null, slogan: draft.slogan.trim() || null, phone: draft.phone.trim() || null, footerText: draft.footerText.trim() || null, updatedAt: Date.now() };
      await runTransaction(db, async (tx) => {
        const snapshot = await tx.get(ref);
        if (snapshot.exists()) tx.update(ref, patch);
        else tx.set(ref, { ...DEFAULT_COMPANY, ...patch });
      });
      dirty.current = false;
      flash('Diseño del ticket guardado');
    } catch (error) { flash(`Error: ${error instanceof Error ? error.message : 'no se pudo guardar el diseño'}`); }
    finally { setBusy(false); }
  };
  const printTest = async () => {
    setPrinting(true);
    try {
      const result = await printTicket(previewHtml);
      if (result.missingImages) flash('Error: no se pudo cargar el logo. La impresión se abrió sin la imagen.');
    } catch { flash('Error: no se pudo abrir la impresión'); }
    finally { setPrinting(false); }
  };
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h1 className="font-display text-2xl uppercase tracking-wide">Diseño de tickets</h1>
        <p className="text-sm text-slate-500">Personaliza el formato de impresión. La vista previa utiliza el mismo diseño que las ventas.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void printTest()} disabled={printing} className="btn-ghost"><Printer size={16} />{printing ? 'Preparando impresión…' : 'Imprimir ticket de prueba'}</button>
          <button onClick={() => void save()} disabled={busy || !cfg} className="btn-brand"><Check size={16} />{busy ? 'Guardando…' : 'Guardar diseño'}</button>
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <section className="card space-y-3 p-4">
            <h2 className="flex items-center gap-2 font-semibold"><Image size={17} /> Logotipo</h2>
            <p className="text-sm text-slate-500">Usa una imagen de alto contraste para la ticketera.</p>
            <label className="label" htmlFor="ticket-logo-url">Enlace directo de la imagen</label>
            <input id="ticket-logo-url" className="field font-mono text-xs" value={draft.logoUrl.startsWith('data:') ? '' : draft.logoUrl} onChange={(e) => update('logoUrl', e.target.value)} placeholder="https://ejemplo.com/logo.png" />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-ghost" onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Subir imagen</button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="hidden" />
              <span className="text-xs text-slate-500">PNG, JPG o WEBP, máximo 200 KB</span>
              {draft.logoUrl && <button type="button" className="btn-ghost text-critical" onClick={() => { update('logoUrl', ''); if (fileInputRef.current) fileInputRef.current.value = ''; }}><Trash2 size={16} /> Quitar logo</button>}
            </div>
            {logoSource && <div className="flex min-h-20 items-center justify-center rounded-xl border border-slate-200 bg-white p-3"><img src={logoSource} alt="Logo cargado" onLoad={() => setLogoError(false)} onError={() => setLogoError(true)} className="max-h-20 max-w-full object-contain grayscale" /></div>}
            {draft.logoUrl && (!logoSource || logoError) && <p className="text-sm text-critical">El enlace no carga una imagen. Usa su dirección directa o sube el archivo.</p>}
          </section>
          <section className="card space-y-4 p-4">
            <h2 className="font-semibold">Formato y columnas</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="label">Ancho de impresión<select className="field mt-1" value={draft.ticketWidth} onChange={(e) => update('ticketWidth', e.target.value as TicketDraft['ticketWidth'])}><option value="80mm">80 mm</option><option value="58mm">58 mm</option></select></label>
              <label className="label">Formato<select className="field mt-1" value={draft.ticketDesign.layout} onChange={(e) => updateDesign('layout', e.target.value as TicketDesign['layout'])}><option value="detailed">Tabla con columnas</option><option value="compact">Lista compacta</option></select></label>
              <label className="label">Tamaño de texto<EditableNumberInput className="field mt-1" type="number" min={9} max={14} step={1} value={draft.ticketDesign.fontSize} onChange={(e) => updateDesign('fontSize', Math.min(14, Math.max(9, Math.round(Number(e.target.value)) || 9)))} /></label>
              <label className="label">Ancho del logo (px)<EditableNumberInput className="field mt-1" type="number" min={40} max={180} step={1} value={draft.ticketDesign.logoWidth} onChange={(e) => updateDesign('logoWidth', Math.min(180, Math.max(40, Math.round(Number(e.target.value)) || 40)))} /></label>
              <label className="label">Alineación del encabezado<select className="field mt-1" value={draft.ticketDesign.headerAlign} onChange={(e) => updateDesign('headerAlign', e.target.value as TicketDesign['headerAlign'])}><option value="center">Centrado</option><option value="left">Izquierda</option></select></label>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([{ key: 'showCode', label: 'Mostrar código de producto' }, { key: 'showUnitPrice', label: 'Mostrar precio unitario' }, { key: 'showCashier', label: 'Mostrar cajero' }, { key: 'showClient', label: 'Mostrar cliente' }] as const).map(({ key, label }) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.ticketDesign[key]} onChange={(e) => updateDesign(key, e.target.checked)} />{label}</label>)}
            </div>
          </section>
          <section className="card space-y-4 p-4">
            <h2 className="font-semibold">Textos del ticket</h2>
            <label className="label">Eslogan<input className="field mt-1" maxLength={250} value={draft.slogan} onChange={(e) => update('slogan', e.target.value)} /></label>
            <label className="label">Teléfono o WhatsApp<input className="field mt-1" maxLength={40} value={draft.phone} onChange={(e) => update('phone', e.target.value)} /></label>
            <label className="label">Mensaje de pie de ticket<textarea className="field mt-1" rows={4} maxLength={1000} value={draft.footerText} onChange={(e) => update('footerText', e.target.value)} /></label>
          </section>
        </fieldset>
        <section className="min-w-0 space-y-3 xl:sticky xl:top-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Vista previa</h2><div className="flex gap-1 rounded-lg bg-slate-100 p-1">{(['boleta', 'factura'] as const).map((type) => <button key={type} className={`min-h-11 rounded-lg px-3 text-sm capitalize ${previewDocType === type ? 'bg-primary text-white' : 'text-slate-600'}`} onClick={() => setPreviewDocType(type)}>{type}</button>)}</div></div>
          <div className="rounded-2xl bg-slate-800 p-3 sm:p-5"><div className="mx-auto max-w-full bg-white shadow-lg" style={{ width: draft.ticketWidth === '58mm' ? '58mm' : '80mm', padding: '2mm' }} dangerouslySetInnerHTML={{ __html: previewHtml }} /></div>
        </section>
      </div>
      <FlashBar msg={msg} />
    </div>
  );
}
