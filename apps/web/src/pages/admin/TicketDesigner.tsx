import { useState, useRef, useMemo } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  Printer,
  Upload,
  Image,
  Trash2,
  Receipt,
  Check,
  Building2,
  FileText
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { useCompany } from '../../hooks/useCompany';
import { clean } from '../../lib/utils';
import { DEFAULT_COMPANY, type CompanyConfig, type Sale } from '../../types';
import { FlashBar, useFlash } from '../../components/ui/Feedback';
import { ticketHtml, printTicket } from '../../lib/print';

export function TicketDesignerPage() {
  const cfg = useCompany();
  const [logoUrl, setLogoUrl] = useState<string>(cfg?.logoUrl ?? '');
  const [slogan, setSlogan] = useState<string>(cfg?.slogan ?? 'Calidad y confianza en cada compra');
  const [phone, setPhone] = useState<string>(cfg?.phone ?? '+51 987 654 321');
  const [footerText, setFooterText] = useState<string>(
    cfg?.footerText ?? '¡Gracias por su compra!\nConserve su ticket para cambios o devoluciones.'
  );
  const [ticketWidth, setTicketWidth] = useState<'80mm' | '58mm'>(cfg?.ticketWidth ?? '80mm');
  const [previewDocType, setPreviewDocType] = useState<'boleta' | 'factura'>('boleta');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { msg, flash } = useFlash();

  // Actualizar estados locales cuando carga el config de Firestore
  useMemo(() => {
    if (cfg) {
      if (cfg.logoUrl !== undefined) setLogoUrl(cfg.logoUrl);
      if (cfg.slogan !== undefined) setSlogan(cfg.slogan);
      if (cfg.phone !== undefined) setPhone(cfg.phone);
      if (cfg.footerText !== undefined) setFooterText(cfg.footerText);
      if (cfg.ticketWidth !== undefined) setTicketWidth(cfg.ticketWidth);
    }
  }, [cfg]);

  // Venta ficticia de muestra para la previsualización en vivo
  const sampleSale: Sale = useMemo(
    () => ({
      id: 'demo-sale-001',
      code: previewDocType === 'boleta' ? 'B001-00000142' : 'F001-00000089',
      serie: previewDocType === 'boleta' ? 'B001' : 'F001',
      correlativo: 142,
      type: previewDocType,
      storeId: 'demo-store',
      storeName: 'Tienda Principal - Central',
      userId: 'demo-user',
      userName: 'Rosa Cajero',
      clientDoc:
        previewDocType === 'boleta'
          ? { tipo: 'DNI', numero: '74839201', nombre: 'Carlos Mendoza' }
          : { tipo: 'RUC', numero: '20601234567', nombre: 'DISTRIBUIDORA LIMA S.A.C.' },
      items: [
        { productId: '1', name: 'Gaseosa Cola 500ml', qty: 2, unitPrice: 3.5, total: 7.0 },
        { productId: '2', name: 'Galletas Chocolate Pack x6', qty: 1, unitPrice: 5.5, total: 5.5 },
        { productId: '3', name: 'Aceite Vegetal 1L', qty: 1, unitPrice: 9.8, total: 9.8 }
      ],
      subtotal: 18.9,
      igv: 3.4,
      total: 22.3,
      paymentMethod: 'efectivo',
      paidAmount: 30.0,
      changeAmount: 7.7,
      consolidated: false,
      sunatStatus: 'aceptado',
      status: 'activa',
      createdAt: Date.now()
    }),
    [previewDocType]
  );

  // Configuración compuesta para el renderizado del ticket
  const previewCompanyConfig: CompanyConfig = useMemo(
    () => ({
      ...(cfg ?? DEFAULT_COMPANY),
      logoUrl: logoUrl.trim() || undefined,
      slogan: slogan.trim() || undefined,
      phone: phone.trim() || undefined,
      footerText: footerText.trim() || undefined,
      ticketWidth
    }),
    [cfg, logoUrl, slogan, phone, footerText, ticketWidth]
  );

  const previewHtml = useMemo(
    () => ticketHtml(sampleSale, previewCompanyConfig),
    [sampleSale, previewCompanyConfig]
  );

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      flash('Error: La imagen no debe superar 2 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setLogoUrl(reader.result as string);
      flash('Logotipo cargado correctamente');
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    flash('Logotipo removido');
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await setDoc(
        doc(db, 'company', 'main'),
        {
          ...(cfg ?? DEFAULT_COMPANY),
          logoUrl: logoUrl.trim() || null,
          slogan: clean(slogan) || null,
          phone: clean(phone) || null,
          footerText: clean(footerText) || null,
          ticketWidth,
          updatedAt: Date.now()
        },
        { merge: true }
      );
      flash('Diseño y personalización del ticket guardados con éxito');
    } catch {
      flash('Error al guardar la configuración del ticket');
    } finally {
      setBusy(false);
    }
  };

  const handlePrintTest = () => {
    printTicket(previewHtml);
  };

  return (
    <div className="space-y-4">
      {/* ─── ENCABEZADO ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wide">Personalizador de Tickets Térmicos</h1>
          <p className="text-xs text-slate-500">
            Personaliza el logotipo, datos de contacto, políticas y formato de las boletas y facturas impresas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrintTest}
            className="btn-ghost !min-h-[40px] text-xs font-bold border-slate-300 bg-white"
          >
            <Printer size={15} /> Imprimir Ticket de Prueba
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={busy}
            className="btn-brand !min-h-[40px] text-xs font-bold"
          >
            <Check size={15} /> {busy ? 'Guardando…' : 'Guardar Diseño'}
          </button>
        </div>
      </div>

      {/* ─── GRID DE PERSONALIZACIÓN Y PREVIEW EN VIVO ───────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
        {/* LADO IZQUIERDO: FORMULARIO DE PERSONALIZACIÓN (7 columnas) */}
        <div className="space-y-4 lg:col-span-7">
          {/* Tarjeta: Logotipo de la Empresa */}
          <div className="card p-5 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5">
              <Image size={15} className="text-primary" /> Logotipo del Ticket Térmico
            </h3>
            <p className="text-xs text-slate-500">
              Sube una imagen o pega un enlace. Para impresoras térmicas se recomienda un logo en blanco y negro o alto contraste.
            </p>

            {logoUrl ? (
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex h-16 w-28 items-center justify-center rounded-xl bg-white border border-slate-200 p-1.5 shadow-xs">
                  <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain filter grayscale" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-800">Logotipo cargado</p>
                  <p className="text-[11px] text-slate-400">Se optimizará para impresión monocromática.</p>
                  <button
                    type="button"
                    onClick={removeLogo}
                    className="flex items-center gap-1 text-xs font-bold text-critical hover:underline pt-1"
                  >
                    <Trash2 size={13} /> Quitar logotipo
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-6 text-center cursor-pointer hover:border-primary hover:bg-indigo-50/20 transition-all"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-xs border border-slate-200">
                    <Upload size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">Haz clic para subir tu logotipo</p>
                    <p className="text-[11px] text-slate-400">PNG o JPG (máximo 2 MB)</p>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                />

                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">O escribe una URL de imagen:</label>
                  <input
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://ejemplo.com/logo.png"
                    className="field text-xs font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Tarjeta: Textos del Encabezado y Contacto */}
          <div className="card p-5 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5">
              <Building2 size={15} className="text-primary" /> Textos del Encabezado
            </h3>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Eslogan o Giro del Negocio</label>
                <input
                  value={slogan}
                  onChange={(e) => setSlogan(e.target.value)}
                  placeholder="Ej.: Venta de abarrotes y bebidas al por mayor"
                  className="field"
                />
              </div>

              <div>
                <label className="label">Teléfono / WhatsApp de Contacto</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ej.: +51 987 654 321"
                  className="field"
                />
              </div>

              <div>
                <label className="label">Ancho de Impresión</label>
                <select
                  value={ticketWidth}
                  onChange={(e) => setTicketWidth(e.target.value as '80mm' | '58mm')}
                  className="field font-bold text-xs"
                >
                  <option value="80mm">80mm (Estándar POS / Ticketera Térmica)</option>
                  <option value="58mm">58mm (Mini Impresora Móvil Bluetooth)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Tarjeta: Pie de Ticket y Políticas */}
          <div className="card p-5 space-y-3 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 font-display flex items-center gap-1.5">
              <FileText size={15} className="text-primary" /> Mensaje de Pie de Ticket
            </h3>
            <p className="text-xs text-slate-500">
              Mensaje final, agradecimiento o políticas de garantía/cambio que aparecerán al final del comprobante.
            </p>
            <textarea
              rows={3}
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Ej.: ¡Gracias por su preferencia! - No se aceptan devoluciones de productos abiertos."
              className="field !h-auto resize-none text-xs"
            />
          </div>
        </div>

        {/* LADO DERECHO: PREVISUALIZADOR EN TIEMPO REAL (5 columnas) */}
        <div className="space-y-3 lg:col-span-5 sticky top-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 font-display flex items-center gap-1.5">
              <Receipt size={15} className="text-primary" /> Vista Previa del Ticket Térmico
            </span>

            {/* Toggle Boleta vs Factura */}
            <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => setPreviewDocType('boleta')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                  previewDocType === 'boleta' ? 'bg-primary text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Boleta
              </button>
              <button
                type="button"
                onClick={() => setPreviewDocType('factura')}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all ${
                  previewDocType === 'factura' ? 'bg-primary text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Factura
              </button>
            </div>
          </div>

          {/* Contenedor del Ticket Físico con estética de papel térmico */}
          <div className="rounded-3xl bg-slate-800 p-5 shadow-2xl">
            <div
              className={`mx-auto bg-white p-4 shadow-md rounded-lg font-mono text-xs text-black transition-all ${
                ticketWidth === '58mm' ? 'max-w-[240px]' : 'max-w-[300px]'
              }`}
              style={{ fontFamily: '"JetBrains Mono", monospace' }}
            >
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={handlePrintTest}
              className="btn-primary w-full !py-2.5 text-xs font-bold"
            >
              <Printer size={15} /> Probar Impresión en Ticketera
            </button>
          </div>
        </div>
      </div>

      <FlashBar msg={msg} />
    </div>
  );
}
