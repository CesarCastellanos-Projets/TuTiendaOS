import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

let openDialogs = 0;
let previousOverflow = '';


export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  drawer = false,
  side = false
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  drawer?: boolean;
  side?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    if (openDialogs++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
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
    return () => { if (--openDialogs === 0) document.body.style.overflow = previousOverflow; cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); document.removeEventListener('focusin', keepFocus); if (previous?.isConnected) previous.focus(); };
  }, [open]);

  if (!open) return null;

  return (
    <div className={`modal-backdrop ${drawer ? 'modal-drawer' : ''} ${side ? 'modal-side' : ''}`}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal-panel ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-heading">
          <h2 className="font-display font-bold text-base text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Cerrar modal"
            className="icon-button"
          >
            <X size={18} />
          </button>
        </div>
        <div data-modal-content className="modal-content">{children}</div>
      </div>
    </div>
  );
}
