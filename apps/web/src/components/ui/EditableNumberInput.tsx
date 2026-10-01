import { useState, type InputHTMLAttributes } from 'react';

export function EditableNumberInput({ value, onChange, onBlur, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input {...props} type="number" value={draft ?? value} onChange={(event) => {
    setDraft(event.target.value);
    onChange?.(event);
  }} onBlur={(event) => {
    setDraft(null);
    onBlur?.(event);
  }} />;
}
