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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div
        className={`card max-h-[92dvh] w-full overflow-auto rounded-b-none sm:rounded-b-xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
