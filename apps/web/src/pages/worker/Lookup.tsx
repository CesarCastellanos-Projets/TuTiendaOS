import { useEffect, useState } from 'react';
import { Camera, PackageX, Search, TriangleAlert, WifiOff } from 'lucide-react';
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
    } else {
      setNotFound(code);
    }
  };

  const scanner = useScanner(onCode);

  return (
    <div className="space-y-4">
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-100 p-2.5 text-xs font-semibold text-amber-900 shadow-sm">
          <WifiOff size={16} className="text-amber-800 shrink-0" />
          <span>Modo Offline: Consultando catálogo local guardado en el dispositivo.</span>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <WedgeInput onSubmit={onCode} placeholder="Escanea o busca producto" className="field !pl-9" />
        </div>
        <button
          className={`btn shrink-0 !px-3 ${scanner.cameraOpen ? 'btn-brand' : 'btn-sol'}`}
          aria-label="Escanear con cámara"
          onClick={() => (scanner.cameraOpen ? scanner.stop() : scanner.startCamera())}
        >
          <Camera size={20} />
        </button>
      </div>

      {scanner.cameraOpen && (
        <div className="overflow-hidden rounded-xl border-2 border-slate-900" id={scanner.videoId} />
      )}
      {scanner.error && (
        <p className="text-sm font-semibold text-critical">
          {scanner.error} Usa la búsqueda por nombre mientras tanto.
        </p>
      )}

      {notFound && (
        <div className="card border-l-4 border-l-acento p-4">
          <p className="font-semibold">No encontré el código</p>
          <p className="font-mono text-xs text-slate-500">{notFound}</p>
          <button
            className="btn-danger mt-3 w-full"
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
            <TriangleAlert size={15} /> Reportar como "sin código"
          </button>
        </div>
      )}

      {term.trim().length >= 2 && (
        <ul className="card divide-y divide-linea overflow-hidden">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-slate-500">Nada coincide con “{term}”.</li>
          ) : (
            results.map((p) => (
              <li key={p.productId}>
                <button
                  onClick={() => setSelected(p)}
                  className="flex w-full items-center justify-between px-3 py-3 text-left hover:bg-slate-100"
                >
                  <span className="truncate font-medium">{p.productName}</span>
                  <span className="price-tag rounded px-2 py-0.5 font-mono text-lg font-bold">
                    {money(p.salePrice)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

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
        <div className="card flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
          <PackageX size={18} /> Catálogo no disponible en esta tienda.
        </div>
      )}
    </div>
  );
}

function ProductCard({ p, onClose }: { p: ProductStock; onClose: () => void }) {
  const [reporting, setReporting] = useState(false);
  const lowStock = p.quantity <= 5;

  return (
    <>
      <article className="fixed inset-x-0 bottom-16 z-40 mx-auto max-w-lg px-4 sm:bottom-20">
        <div className="card overflow-hidden shadow-xl">
          <div className="tape h-2 w-full" aria-hidden />
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 text-lg font-bold leading-tight">{p.productName}</h2>
              <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100" aria-label="Cerrar">
                ✕
              </button>
            </div>
            <p className="price-tag inline-block rounded-lg px-4 py-1.5 font-display text-5xl leading-none">
              S/ {p.salePrice.toFixed(2)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`badge ${lowStock ? 'bg-red-50 text-critical' : 'bg-emerald-50 text-success'}`}>
                {p.quantity > 0 ? `${p.quantity} en tienda` : 'Sin stock'}
              </span>
              {p.locationName && <span className="badge bg-slate-100 text-slate-900">{p.locationName}</span>}
            </div>
            {lowStock && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-critical">
                Stock bajo. Avisa al encargado o pide reposición.
              </p>
            )}
            <button className="btn-primary w-full" onClick={() => setReporting(true)}>
              <TriangleAlert size={15} /> Reportar incidencia de este producto
            </button>
          </div>
        </div>
      </article>

      {reporting && (
        <IncidentFormModal
          preset={{ productId: p.productId, productName: p.productName }}
          onClose={() => {
            setReporting(false);
          }}
        />
      )}
    </>
  );
}
