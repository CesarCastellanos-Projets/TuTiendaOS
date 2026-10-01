export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let beforePrevious = previous;
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        current[j] = Math.min(current[j], beforePrevious[j - 2] + 1);
    }
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

export function searchScore(query: string, name: string, codes: string[]): number {
  const raw = query.trim().toLowerCase();
  if (!raw) return 0;
  if (codes.some((code) => code.toLowerCase() === raw)) return 1000;
  const term = normalizeSearch(query);
  if (!term) return 0;
  if (name === term) return 900;
  if (name.startsWith(term)) return 800;
  if (name.includes(term)) return 700;
  if (codes.some((code) => code.toLowerCase().startsWith(raw))) return 600;
  const words = name.split(' ');
  const tokens = term.split(' ');
  let score = 500;
  for (const token of tokens) {
    if (words.some((word) => word.startsWith(token))) continue;
    if (token.length < 3 || /^\d+$/.test(token)) return 0;
    const max = token.length >= 7 ? 2 : 1;
    const closest = words.reduce(
      (best, word) =>
        Math.abs(word.length - token.length) <= max ? Math.min(best, distance(token, word)) : best,
      max + 1
    );
    if (closest > max) return 0;
    score -= closest * 60;
  }
  return score;
}
