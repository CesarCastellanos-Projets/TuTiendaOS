export async function runBounded<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('La concurrencia debe ser positiva.');
  let next = 0;
  let failed = false;
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const item = items[next++];
      try { await work(item); } catch (cause) { failed = true; throw cause; }
    }
  }));
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'No se completó la propagación.');
}
