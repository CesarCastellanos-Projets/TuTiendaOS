import { useEffect, useState } from 'react';
import { Camera, PackageX, Search, TriangleAlert, WifiOff, ScanLine, X, AlertCircle, Layers } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useStoreCatalog, useCatalogSearch, findInCatalog } from '../../hooks/useStoreCatalog';
import type { ProductWithId } from '../../lib/catalog-repository';
import { useScanner } from '../../hooks/useScanner';
import { IncidentFormModal } from './Incidents';
import type { ProductStock } from '../../types';
import { money } from '../../lib/utils';

export function WorkerLookup() {
  const profile = useAuth((s) => s.profile)!;
  const storeId = profile.storeId!;
  const { items: catalog, products } = useStoreCatalog(storeId);
  const searchIn = useCatalogSearch(catalog);
  const [selected, setSelected] = useState<ProductStock | null>(null);
  const [term, setTerm] = useState('');
  const [notFound, setNotFound] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const results = term.trim().length >= 1 ? searchIn(term) : [];

  const onCode = (code: string) => {
    void findInCatalog(storeId, code, catalog).then((found) => {
      if (found) {
        setSelected(found);
        setNotFound(null);
        setTerm('');
        if (navigator.vibrate) navigator.vibrate(80);
      } else {
        setNotFound(code);
      }
    });
  };

  const scanner = useScanner(onCode);

  return (
    <div className="space-y-4">
      {/* Banner Offline PWA */}
      {!isOnline && (
        <div className="flex items-center gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs font-semibold text-amber-900 shadow-xs">
          <WifiOff size={18} className="text-amber-800 shrink-0" />
          <span>Modo Offline: Consultando catálogo local guardado en la memoria del dispositivo.</span>
        </div>
      )}

      {/* Input de Búsqueda Reactivo y Botón de Cámara */}
      <div className="flex gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = term.trim();
            if (!q) return;
            void findInCatalog(storeId, q, catalog).then((found) => {
              if (found) {
                setSelected(found);
                setNotFound(null);
                setTerm('');
              } else if (results.length === 1) {
                setSelected(results[0]);
                setNotFound(null);
                setTerm('');
              } else if (results.length === 0) {
                setNotFound(q);
              }
            });
          }}
          className="relative flex-1"
        >
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              if (notFound) setNotFound(null);
            }}
            placeholder="Escribe el nombre o escanea código…"
            className="field !pl-10 !pr-10 !h-12 !text-base shadow-xs"
            autoComplete="off"
            autoFocus
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
          title="Escanear con cámara"
          onClick={() => (scanner.cameraOpen ? scanner.stop() : scanner.startCamera())}
        >
          <Camera size={20} />
          <span className="hidden sm:inline text-xs font-bold">Cámara</span>
        </button>
      </div>

      {/* Visor de Cámara PWA con láser animado */}
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
            <p className="text-amber-800 text-[11px]">
              Puedes buscar el producto escribiendo su nombre en el buscador de arriba.
            </p>
          </div>
        </div>
      )}

      {/* Tarjeta Código no encontrado */}
      {notFound && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-3 shadow-xs animate-in fade-in">
          <div>
            <p className="font-display font-bold text-sm text-amber-950">Código no registrado en el sistema</p>
            <p className="font-mono text-xs font-semibold text-amber-800 mt-0.5">{notFound}</p>
          </div>
          <button
            className="btn-danger w-full !py-2.5 text-xs font-bold"
            onClick={() => {
              setSelected({
                productId: '',
                productName: `Producto sin código (${notFound.slice(-6)})`,
                locationType: 'store',
                locationId: storeId,
                locationName: '',
                quantity: 0,
                salePrice: 0
              });
              setNotFound(null);
            }}
          >
            <TriangleAlert size={15} /> Reportar producto sin código
          </button>
        </div>
      )}

      {/* Resultados de búsqueda por texto en vivo */}
      {term.trim().length >= 1 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden animate-in fade-in">
          <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Resultados de búsqueda ({results.length})</span>
            <span className="text-[10px] text-slate-400">Toca para consultar</span>
          </div>
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500 space-y-1">
              <p className="font-semibold text-slate-700">No se encontraron productos coincidentes con “{term}”</p>
              <p className="text-xs text-slate-400">Verifica la ortografía o intenta buscar por una palabra clave.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {results.map((p) => (
                <li key={p.productId}>
                  <button
                    onClick={() => {
                      setSelected(p);
                      setTerm('');
                    }}
                    className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-indigo-50/50 transition-colors group"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <span className="block truncate text-sm font-bold text-slate-800 group-hover:text-primary">
                        {p.productName}
                      </span>
                      {p.locationName && (
                        <span className="text-[11px] text-slate-400 block truncate mt-0.5">
                          📍 {p.locationName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={`badge text-[10px] font-bold ${p.quantity <= 5 ? 'bg-red-50 text-critical border border-red-200' : 'bg-emerald-50 text-success border border-emerald-200'}`}>
                        {p.quantity} un.
                      </span>
                      <span className="price-tag font-mono text-sm font-extrabold text-slate-900">
                        {money(p.salePrice)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Modales y Detalle del Producto */}
      {selected && selected.productId === '' && (
        <IncidentFormModal
          preset={{ type: 'sin_codigo', productName: selected.productName }}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && selected.productId !== '' && (
        <ProductCard
          p={selected}
          product={products.find((prod) => prod.id === selected.productId)}
          onClose={() => setSelected(null)}
        />
      )}

      {catalog.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-2 p-8 text-center text-slate-400">
          <PackageX size={32} className="opacity-40" />
          <p className="text-sm font-bold text-slate-600">Catálogo local vacío</p>
          <p className="text-xs text-slate-400">No hay productos registrados en esta tienda.</p>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  p,
  product,
  onClose
}: {
  p: ProductStock;
  product?: ProductWithId;
  onClose: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const lowStock = p.quantity <= 5;
  const isOutOfStock = p.quantity < 1;

  const baseUnit = product?.unit || 'UN';
  const basePrice = product?.salePrice ?? p.salePrice;
  const baseBarcode = product?.barcode || p.barcode;
  const presentations = product?.presentations || [];

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-in fade-in"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <article className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh]">
          {/* Cinta superior decorativa */}
          <div className="h-1.5 w-full bg-linear-to-r from-primary to-indigo-500" aria-hidden />

          {/* Cabecera del modal centrado */}
          <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/60">
            <div className="min-w-0 flex-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-primary block">
                Consulta de Producto
              </span>
              <h2 className="text-lg font-display font-extrabold text-slate-900 leading-tight mt-0.5">
                {product?.name || p.productName}
              </h2>
              {p.locationName && (
                <span className="text-xs text-slate-500 font-medium block mt-1">
                  📍 Ubicación: <strong className="text-slate-700">{p.locationName}</strong>
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors shrink-0 shadow-xs"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>

          {/* Contenido con scroll */}
          <div className="p-5 space-y-4 overflow-y-auto flex-1">
            {/* Estado del Stock en Tienda */}
            <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50 p-3.5">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Stock Físico en Tienda
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`badge text-xs font-bold ${
                      isOutOfStock
                        ? 'bg-red-50 text-critical border border-red-200'
                        : lowStock
                        ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-emerald-50 text-success border border-emerald-200'
                    }`}
                  >
                    {isOutOfStock ? 'Agotado (0)' : `${p.quantity} unidades`}
                  </span>
                  {lowStock && !isOutOfStock && (
                    <span className="text-[11px] font-semibold text-amber-600">
                      · Quedan pocas
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Precio Base ({baseUnit})
                </span>
                <span className="font-mono text-2xl font-extrabold text-slate-900">
                  {money(basePrice)}
                </span>
              </div>
            </div>

            {/* Presentaciones y Precios */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block flex items-center gap-1.5">
                <Layers size={14} className="text-indigo-600" />
                Presentaciones y Precios ({presentations.length + 1})
              </span>

              <div className="space-y-2.5">
                {/* 1. Unidad Base */}
                <div className="flex items-center justify-between rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 p-3.5 transition-all">
                  <div className="min-w-0 flex-1 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="badge bg-indigo-600 text-white font-extrabold text-[11px]">
                        {baseUnit}
                      </span>
                      <span className="text-xs font-extrabold text-slate-800">
                        Unidad Principal (x1)
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 font-mono block mt-1">
                      Código: {baseBarcode || 'Sin código'}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="price-tag font-mono text-xl font-extrabold text-primary block">
                      {money(basePrice)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Por unidad</span>
                  </div>
                </div>

                {/* 2. Otras Presentaciones */}
                {presentations.map((pres, idx) => {
                  const factor = pres.factor || 1;
                  const cajasDisponibles = Math.floor(p.quantity / factor);
                  const sobrante = p.quantity % factor;

                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs hover:border-slate-300 transition-all"
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="badge bg-slate-800 text-white font-extrabold text-[11px]">
                            {pres.unit}
                          </span>
                          <span className="text-xs font-bold text-slate-800">
                            Equivale a {factor} {baseUnit}
                          </span>
                        </div>
                        {pres.barcode && (
                          <span className="text-[11px] text-slate-500 font-mono block mt-1">
                            Código: {pres.barcode}
                          </span>
                        )}
                        <span className="text-[11px] text-emerald-700 font-medium block mt-1">
                          Alcanza para: <strong>{cajasDisponibles} {pres.unit}</strong>
                          {sobrante > 0 ? ` (sobran ${sobrante} ${baseUnit})` : ''}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="price-tag font-mono text-xl font-extrabold text-slate-900 block">
                          {money(pres.salePrice)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">
                          ({money(pres.salePrice / factor)} c/u)
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Acciones inferiores */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex gap-2">
            <button
              className="btn-ghost flex-1 !py-2.5 text-xs font-bold"
              onClick={() => setReporting(true)}
            >
              <TriangleAlert size={15} className="text-amber-500" /> Reportar Incidencia
            </button>
            <button
              className="btn-primary shrink-0 !py-2.5 !px-5 text-xs font-bold"
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        </article>
      </div>

      {reporting && (
        <IncidentFormModal
          preset={{ productId: p.productId, productName: p.productName }}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}
