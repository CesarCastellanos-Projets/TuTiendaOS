import { useEffect, useState } from 'react';
import { Camera, PackageX, Search, TriangleAlert, WifiOff, ScanLine, X, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useStoreCatalog } from '../../hooks/useStoreCatalog';
import { useCatalogSearch } from '../../hooks/useStoreCatalog';
import { useScanner, WedgeInput } from '../../hooks/useScanner';
import { IncidentFormModal } from './Incidents';
import type { ProductStock } from '../../types';
import { money } from '../../lib/utils';

export function WorkerLookup() {
  const profile = useAuth((s) => s.profile)!;
  const storeId = profile.storeId!;
  const { items: catalog } = useStoreCatalog(storeId);
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

  const results = term.trim().length >= 2 ? searchIn(term) : [];

  const onCode = (code: string) => {
    const found = catalog.find((p) => p.barcode === code || p.productId === code);
    if (found) {
      setSelected(found);
      setNotFound(null);
      setTerm('');
      if (navigator.vibrate) navigator.vibrate(80);
    } else {
      setNotFound(code);
    }
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

      {/* Input de Búsqueda y Botón de Cámara */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <WedgeInput
            onSubmit={onCode}
            placeholder="Escanea o busca producto…"
            className="field !pl-10 !h-12 !text-base shadow-xs"
          />
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

      {/* Visor de Cámara PWA con láser animado */}
      {scanner.cameraOpen && (
        <div className="relative overflow-hidden rounded-2xl border-2 border-primary bg-slate-950 shadow-xl">
          <div className="absolute inset-x-0 z-10 h-0.5 bg-primary shadow-lg shadow-primary animate-laser" />
          <div className="p-2" id={scanner.videoId} />
          <div className="absolute bottom-3 inset-x-0 flex justify-center z-10">
            <span className="rounded-full bg-slate-900/80 backdrop-blur-md px-3 py-1 text-xs font-medium text-white flex items-center gap-1.5">
              <ScanLine size={14} className="text-primary" /> Apunta al código de barras
            </span>
          </div>
        </div>
      )}

      {scanner.error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-critical">
          <AlertCircle size={16} />
          <span>{scanner.error} Usa la búsqueda manual por nombre mientras tanto.</span>
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

      {/* Resultados de búsqueda por texto */}
      {term.trim().length >= 2 && (
        <ul className="rounded-2xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100 overflow-hidden animate-in fade-in">
          {results.length === 0 ? (
            <li className="px-4 py-4 text-center text-sm text-slate-500">
              No se encontraron productos coincidentes con “{term}”.
            </li>
          ) : (
            results.map((p) => (
              <li key={p.productId}>
                <button
                  onClick={() => setSelected(p)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-indigo-50/50 transition-colors"
                >
                  <span className="truncate text-sm font-medium text-slate-800">{p.productName}</span>
                  <div className="flex items-center gap-2.5 ml-2 shrink-0">
                    <span className={`badge text-[10px] ${p.quantity <= 5 ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                      {p.quantity} un.
                    </span>
                    <span className="price-tag font-mono text-base font-extrabold text-primary">
                      {money(p.salePrice)}
                    </span>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {/* Modales y Detalle del Producto */}
      {selected && selected.productId === '' && (
        <IncidentFormModal
          preset={{ type: 'sin_codigo', productName: selected.productName }}
          onClose={() => setSelected(null)}
        />
      )}

      {selected && selected.productId !== '' && (
        <ProductCard p={selected} onClose={() => setSelected(null)} />
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

function ProductCard({ p, onClose }: { p: ProductStock; onClose: () => void }) {
  const [reporting, setReporting] = useState(false);
  const lowStock = p.quantity <= 5;
  const isOutOfStock = p.quantity < 1;

  return (
    <>
      <article className="fixed inset-x-0 bottom-18 z-40 mx-auto max-w-lg px-4">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl animate-in slide-in-from-bottom">
          <div className="tape h-1.5 w-full" aria-hidden />
          <div className="space-y-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-display font-extrabold text-slate-900 leading-tight">
                  {p.productName}
                </h2>
                {p.locationName && (
                  <span className="text-xs text-slate-500 font-medium">{p.locationName}</span>
                )}
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                aria-label="Cerrar"
              >
                <X size={16} />
              </button>
            </div>

            {/* Precio Grande */}
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-bold text-slate-400 uppercase">Precio:</span>
              <span className="price-tag font-mono text-5xl font-extrabold text-slate-900">
                S/ {p.salePrice.toFixed(2)}
              </span>
            </div>

            {/* Badges de Stock */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`badge text-xs ${
                  isOutOfStock
                    ? 'bg-red-50 text-critical font-extrabold'
                    : lowStock
                    ? 'bg-amber-50 text-amber-700 font-extrabold'
                    : 'bg-emerald-50 text-success font-extrabold'
                }`}
              >
                {isOutOfStock ? 'Agotado' : `${p.quantity} disponibles en tienda`}
              </span>
              {lowStock && !isOutOfStock && (
                <span className="text-xs font-semibold text-amber-600">
                  · Quedan pocas unidades
                </span>
              )}
            </div>

            {/* Botón de Incidencia */}
            <button
              className="btn-ghost w-full !py-3 text-xs font-bold"
              onClick={() => setReporting(true)}
            >
              <TriangleAlert size={16} className="text-amber-500" /> Reportar Incidencia o Faltante
            </button>
          </div>
        </div>
      </article>

      {reporting && (
        <IncidentFormModal
          preset={{ productId: p.productId, productName: p.productName }}
          onClose={() => setReporting(false)}
        />
      )}
    </>
  );
}
