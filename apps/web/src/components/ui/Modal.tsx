import { useEffect, useRef, type ReactNode } from 'react';
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    const topmost = () => Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) === dialog;
    const frame = requestAnimationFrame(() => (dialog?.querySelector<HTMLElement>('[data-modal-content] input, [data-modal-content] button:not(:disabled), [data-modal-content] select') ?? dialog)?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (!topmost()) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) { e.preventDefault(); dialog?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (topmost() && event.target instanceof Node && !dialog?.contains(event.target)) (focusable()[0] ?? dialog)?.focus();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', keepFocus);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); document.removeEventListener('focusin', keepFocus); if (previous?.isConnected) previous.focus(); };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:items-center sm:p-4 animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        tabIndex={-1}
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
        <div data-modal-content className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
