import { useEffect, useRef, type RefObject } from 'react';

export function usePosKeyboard(
  input: RefObject<HTMLInputElement | null>,
  handlers: {
    blocked: boolean;
    onChange: (value: string) => void;
    onScan: (code: string) => void;
    onSubmit: (value: string) => void;
    onNavigate: (direction: number) => void;
    isCode: (value: string) => boolean;
  }
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    let buffer = '';
    let last = 0;
    let burst = false;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing)
        return;
      const field = input.current;
      if (
        !field ||
        latest.current.blocked ||
        document.querySelector('[role="dialog"], [data-pos-block-input]')
      ) {
        buffer = '';
        burst = false;
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inSearch = target === field;
      if (
        !inSearch &&
        target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
      ) {
        buffer = '';
        burst = false;
        return;
      }
      if (event.key === 'Escape') {
        latest.current.onChange('');
        buffer = '';
        burst = false;
        return;
      }
      if (inSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        latest.current.onNavigate(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' && (inSearch || buffer)) {
        event.preventDefault();
        const scanned =
          burst &&
          performance.now() - last <= 150 &&
          field.value.endsWith(buffer) &&
          latest.current.isCode(buffer);
        const value = scanned ? buffer : field.value;
        buffer = '';
        burst = false;
        if (value.trim()) {
          if (scanned) latest.current.onScan(value);
          else latest.current.onSubmit(value);
        }
        return;
      }
      if (event.key.length !== 1) {
        buffer = '';
        burst = false;
        return;
      }
      const now = performance.now();
      if (now - last > 65) {
        buffer = '';
        burst = false;
      }
      buffer += event.key;
      last = now;
      if (buffer.length >= 3) burst = true;
      if (!inSearch) {
        event.preventDefault();
        field.focus();
        field.value = event.key;
        latest.current.onChange(event.key);
      }
    };
    window.addEventListener('keydown', handle, true);
    return () => window.removeEventListener('keydown', handle, true);
  }, [input]);
}
