import { useEffect, useState } from 'react';
import { getBlob, ref } from 'firebase/storage';
import { storage } from '../lib/firebase';

export function IncidentPhoto({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setUrl(undefined); setFailed(false);
    if (path) void getBlob(ref(storage, path), 5 * 1024 * 1024).then((blob) => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  if (!path) return null;
  if (failed) return <p className="mt-2 text-xs text-critical">No se pudo cargar la foto con tus permisos.</p>;
  return url ? <img src={url} alt="Foto de la incidencia" className="mt-2 max-h-64 max-w-full rounded-lg object-contain" /> : <p className="text-xs text-slate-500">Cargando foto…</p>;
}
