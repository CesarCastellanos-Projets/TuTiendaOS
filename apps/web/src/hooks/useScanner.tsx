import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';

/**
 * Escáner dual:
 * - PC: pistola USB actúa como teclado → input siempre enfocado captura Enter.
 * - Móvil PWA: cámara con ZXing cargado dinámicamente bajo demanda.
 */
export function useScanner(onDetected: (code: string) => void, captureKeyboard = true) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const videoIdRef = useRef(`scanner-video-${Math.random().toString(36).slice(2)}`);
  const handlerRef = useRef(onDetected);
  handlerRef.current = onDetected;

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOpen(false);
  };

  const startCamera = () => {
    setError(null);
    setCameraOpen(true);
  };

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;

    // Verificación de contexto seguro (HTTPS o localhost obligatorio para getUserMedia)
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setError('La cámara requiere conexión HTTPS segura para activarse en el celular.');
      setCameraOpen(false);
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Este navegador no tiene soporte para acceder a la cámara.');
      setCameraOpen(false);
      return;
    }

    // Carga perezosa (dynamic import) de la librería pesada de escáner
    import('@zxing/browser')
      .then(({ BrowserMultiFormatReader }) => {
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const video = document.getElementById(videoIdRef.current) as HTMLVideoElement | null;

        // decodeFromVideoDevice pide permisos nativos y selecciona la cámara trasera preferida
        return reader.decodeFromVideoDevice(undefined, video ?? videoIdRef.current, (result) => {
          if (result && !cancelled) {
            handlerRef.current(result.getText().trim());
            stop();
          }
        });
      })
      .then((controls) => {
        if (!controls) return;
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCameraOpen(false);
        const name = (err as Error)?.name ?? '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('Permiso de cámara bloqueado. Toca el candado  en la barra de tu navegador y activa la cámara.');
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setError('No se detectó cámara física en este dispositivo.');
        } else if (name === 'NotReadableError' || name === 'TrackStartError') {
          setError('La cámara está en uso por otra app. Ciérrala e intenta de nuevo.');
        } else {
          setError('No se pudo acceder a la cámara. Revisa los permisos de tu navegador.');
        }
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [cameraOpen]);

  // Detector global de pistola / escáner USB en cualquier parte de la pantalla
  useEffect(() => {
    if (!captureKeyboard) return;
    let buffer = '';
    let lastKeyTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

      const now = Date.now();
      const diff = now - lastKeyTime;
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (buffer.length >= 3) {
          const code = buffer.trim();
          buffer = '';
          if (!isInput) {
            e.preventDefault();
            handlerRef.current(code);
          }
        }
        buffer = '';
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (diff > 120) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [captureKeyboard]);

  return { cameraOpen, error, startCamera, stop, videoId: videoIdRef.current };
}

/** Input tipo "wedge": el escáner USB escribe y envía Enter. */
export function WedgeInput({
  onSubmit,
  placeholder,
  autoFocus,
  className
}: {
  onSubmit: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = value.trim();
        if (!code) return;
        setValue('');
        onSubmit(code);
      }}
      className="contents"
    >
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className={className ?? 'field'}
        autoComplete="off"
        inputMode="search"
        aria-label={placeholder}
      />
    </form>
  );
}
