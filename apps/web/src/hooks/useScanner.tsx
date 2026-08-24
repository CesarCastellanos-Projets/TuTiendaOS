import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';

/**
 * Escáner dual:
 * - PC: pistola USB actúa como teclado → input siempre enfocado captura Enter.
 * - Móvil PWA: cámara con ZXing.
 */
export function useScanner(onDetected: (code: string) => void) {
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
    const reader = new BrowserMultiFormatReader();
    const video = document.getElementById(videoIdRef.current) as HTMLVideoElement | null;

    reader
      .decodeFromVideoElement(video ?? videoIdRef.current, (result) => {
        if (result && !cancelled) {
          handlerRef.current(result.getText().trim());
          stop();
        }
      })
      .then((controls) => {
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo abrir la cámara. Revisa permisos.');
        setCameraOpen(false);
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [cameraOpen]);

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
