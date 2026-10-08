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
      className={`notice-toast text-sm font-medium ${
        error ? 'notice-error' : 'text-slate-900'
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
      <p className="font-display text-lg font-semibold">{title}</p>
      {hint && <p className="max-w-sm text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}
