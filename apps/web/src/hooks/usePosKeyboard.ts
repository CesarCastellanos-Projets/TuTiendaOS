import { useEffect, useRef, type RefObject } from 'react';

export function usePosKeyboard(
  input: RefObject<HTMLInputElement | null>,
  handlers: {
    blocked: boolean;
    onChange: (value: string) => void;
    onScan: (code: string) => void;
    onSubmit: (value: string) => void;
    onNavigate: (direction: number) => void;
    isKnownCode: (value: string) => boolean;
  }
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    let buffer = '';
    let sequence = '';
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
        sequence = '';
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
        sequence = '';
        burst = false;
        return;
      }
      if (event.key === 'Escape') {
        latest.current.onChange('');
        buffer = '';
        sequence = '';
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
        const recent = event.timeStamp - last <= 500;
        const known = recent && sequence.length > 0 && field.value.endsWith(sequence) && latest.current.isKnownCode(sequence);
        const scanned = known || (burst && event.timeStamp - last <= 150 && field.value.endsWith(buffer) && /^\d{3,}$/.test(buffer));
        const value = scanned ? (known ? sequence : buffer) : field.value;
        buffer = '';
        sequence = '';
        burst = false;
        if (value.trim()) {
          if (scanned) latest.current.onScan(value);
          else latest.current.onSubmit(value);
        }
        return;
      }
      if (event.key.length !== 1) {
        buffer = '';
        sequence = '';
        burst = false;
        return;
      }
      const now = event.timeStamp;
      if (now - last > 500) sequence = '';
      sequence += event.key;
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
