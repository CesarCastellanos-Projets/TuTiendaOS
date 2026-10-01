import { useCallback, useEffect, useState, type ReactNode } from 'react';

export function useFlash(): { msg: string | null; flash: (m: string) => void } {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const flash = useCallback((m: string) => setMsg(m), []);
  return { msg, flash };
}

export function FlashBar({ msg }: { msg: string | null }): ReactNode {
  if (!msg) return null;
  const error = /error|insuficiente|no se pudo|falta/i.test(msg);
  return (
    <div
      role="status"
      className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg ${
        error ? 'bg-critical text-white' : 'bg-slate-900 text-slate-50'
      }`}
    >
      {msg}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 p-8 text-center">
      <p className="font-display text-lg uppercase tracking-wide">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}
