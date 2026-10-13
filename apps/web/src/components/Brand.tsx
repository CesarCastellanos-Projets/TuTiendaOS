export function Brand({ compact = false, subtitle = 'Sistema de tienda' }: { compact?: boolean; subtitle?: string }) {
  return <span className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-symbol"><img src="/branding/TuTiendaOS.png" alt="TuTiendaOS" width="220" height="220" /></span>
    {!compact && <span className="brand-name">TuTiendaOS<span className="brand-caption">{subtitle}</span></span>}
    {compact && <span className="sr-only">TuTiendaOS</span>}
  </span>;
}
