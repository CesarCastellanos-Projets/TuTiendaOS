export function workBudget(durationMs: number, now: () => number = Date.now) {
  const deadline = now() + durationMs;
  return { canStart: (reserveMs = 60000) => now() + reserveMs < deadline };
}

export function roundRobin<T>(values: T[], cursor: number): { values: T[]; start: number } {
  const start = values.length && Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) % values.length : 0;
  return { values: [...values.slice(start), ...values.slice(0, start)], start };
}
