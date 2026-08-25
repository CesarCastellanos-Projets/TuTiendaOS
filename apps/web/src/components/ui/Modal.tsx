import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  open,
  title,
  onClose,
  children,
  wide
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in duration-200">
      <div
        className={`w-full overflow-hidden rounded-t-3xl sm:rounded-3xl border border-slate-200 bg-white shadow-2xl transition-all animate-in zoom-in-95 duration-200 max-h-[92dvh] flex flex-col ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="tape h-1 w-full shrink-0" aria-hidden />
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5 shrink-0">
          <h2 className="font-display font-bold text-base text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
