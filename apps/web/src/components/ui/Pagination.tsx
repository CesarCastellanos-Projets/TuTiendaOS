interface PaginationProps {
  page: number; hasNext: boolean; hasPrevious: boolean; loading: boolean;
  next: () => void; previous: () => void;
}
export function Pagination(props: PaginationProps) {
  return <nav aria-label="Paginación" className="flex items-center justify-center gap-3 py-3">
    <button className="btn-ghost text-sm" disabled={!props.hasPrevious || props.loading} onClick={props.previous}>Anterior</button>
    <span className="text-sm text-slate-500">Página {props.page}</span>
    <button className="btn-ghost text-sm" disabled={!props.hasNext || props.loading} onClick={props.next}>Siguiente</button>
  </nav>;
}
