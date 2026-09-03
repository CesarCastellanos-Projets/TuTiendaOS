export function RouteLoading() {
  return (
    <div className="flex h-64 w-full flex-col items-center justify-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-primary/20 border-t-primary" />
      <span className="text-xs font-semibold text-slate-400">Cargando módulo…</span>
    </div>
  );
}
