export const QUOTATION_LIFETIME = 30 * 86400000;
export function quotationExpires(quote: Record<string, unknown>): number {
  const expiry = typeof quote.expiresAt === 'number' ? quote.expiresAt : Number(quote.createdAt) + QUOTATION_LIFETIME;
  return Number.isFinite(expiry) ? expiry : 0;
}
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
