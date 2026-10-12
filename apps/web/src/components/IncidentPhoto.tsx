import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { incidentPhotoCache, photoSession } from '../lib/incident-photo-cache';

export function IncidentPhoto({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const profile = useAuth((state) => state.profile);
  const uid = useAuth((state) => state.user?.uid);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setUrl(undefined); setFailed(false);
    const session = photoSession();
    let started = false;
    const load = () => {
      if (started || !path) return;
      started = true;
      if (!session || !path.startsWith(`tenants/${profile?.tenantId}/incidents/`)) { setFailed(true); return; }
      void incidentPhotoCache.get(session, path).then((blob) => {
        if (!alive || photoSession() !== session) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      }).catch(() => { if (alive) setFailed(true); });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { observer?.disconnect(); load(); }
    }, { rootMargin: '200px' });
    if (container.current && path) { if (observer) observer.observe(container.current); else load(); }
    return () => { alive = false; observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, profile, uid]);
  if (!path) return null;
  return <div ref={container} className="mt-2 min-h-6">
    {failed ? <p className="text-xs text-critical">No se pudo cargar la foto con tus permisos.</p>
      : url ? <img src={url} alt="Foto de la incidencia" className="max-h-64 max-w-full rounded-lg object-contain" />
        : <p className="text-xs text-slate-500">Cargando foto…</p>}
  </div>;
}
