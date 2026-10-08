export function Brand({ compact = false, subtitle = 'Sistema de tienda' }: { compact?: boolean; subtitle?: string }) {
  return <span className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-symbol"><img src="/branding/logo_denzoz.png" alt="" width="220" height="220" /></span>
    {!compact && <span className="brand-name">D’ENZOZ<span className="brand-caption">{subtitle}</span></span>}
    {compact && <span className="sr-only">D’ENZOZ</span>}
  </span>;
}
