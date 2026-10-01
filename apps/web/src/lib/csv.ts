export function csvCell(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = /^[=+@-]/.test(value.trimStart()) || (value.length > 0 && value.charCodeAt(0) < 32) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
