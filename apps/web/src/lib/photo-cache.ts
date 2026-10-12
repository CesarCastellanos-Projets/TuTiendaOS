export function createPhotoCache(load: (path: string) => Promise<Blob>, authorize: (path: string) => Promise<unknown>, maxBytes = 20 * 1024 * 1024) {
  const cached = new Map<string, Blob>();
  const pending = new Map<string, Promise<Blob>>();
  let scope = '';
  let generation = 0;
  let bytes = 0;
  const clear = () => { cached.clear(); pending.clear(); bytes = 0; generation++; scope = ''; };
  return {
    clear,
    get(session: string, path: string): Promise<Blob> {
      if (session !== scope) { clear(); scope = session; }
      const existing = pending.get(path);
      if (existing) return existing;
      const current = generation;
      const blob = cached.get(path);
      const request = (blob ? authorize(path).then(() => blob) : load(path)).then((value) => {
        if (generation !== current) return value;
        if (blob && cached.delete(path)) bytes -= blob.size;
        while (cached.size && (bytes + value.size > maxBytes || cached.size >= 20)) {
          const oldest = cached.keys().next().value!;
          bytes -= cached.get(oldest)!.size; cached.delete(oldest);
        }
        if (value.size <= maxBytes) { cached.set(path, value); bytes += value.size; }
        return value;
      }).catch((cause: unknown) => {
        if (generation === current && cached.delete(path) && blob) bytes -= blob.size;
        throw cause;
      }).finally(() => { if (pending.get(path) === request) pending.delete(path); });
      pending.set(path, request);
      return request;
    }
  };
}
