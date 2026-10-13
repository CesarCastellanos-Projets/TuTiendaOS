# AGENTS.md

Convenciones del proyecto TuTiendaOS.

## Comandos

| Acción | Carpeta | Comando |
|--------|---------|---------|
| Dev web | `apps/web` | `npm run dev` |
| Build web | `apps/web` | `npm run build` |
| Typecheck web | `apps/web` | `npm run typecheck` |
| Lint web | `apps/web` | `npm run lint` |
| Functions dev | `functions` | `npm run build` |
| API tributaria | `apps/api-fact` | `php artisan serve` |

## Estructura

- `apps/web/src/pages/admin|pos|worker` — páginas por rol. Nunca mezclar flujos entre roles.
- `apps/web/src/lib/inventory.ts` — ÚNICA fuente para mutar stock (`product_stocks`). Toda operación registra movimiento en `stock_movements`.
- `apps/web/src/services/sunat.ts` — único punto de contacto con el microservicio Laravel. Falla siempre *soft* (la venta nunca se bloquea si SUNAT cae; queda `sunatStatus: pendiente`).

## Reglas de negocio críticas

1. El POS **nunca** escribe stock manualmente: vende (decremento transaccional) o recibe transferencias (incremento controlado).
2. Transferencias: Admin envía → estado `pendiente` → POS destino recibe cantidades ≤ enviadas → `recibido`.
3. Ventas < S/5 sin comprobante exigido se marcan `consolidated: true` y se agrupan en boleta al cierre (resumen diario).
4. Boleta: DNI obligatorio solo ≥ S/700 (configurable). Factura: RUC + razón social obligatorios.
5. Anulación = nota de crédito vía Greenter. POS solicita, Admin autoriza.

## Estilo de código

- TypeScript estricto, sin `any`.
- Componentes pequeños, formularios controlados simples (sin react-hook-form).
- Sin comentarios salvo lógica genuinamente no obvia.
- Textos de UI en español peruano, tono directo ("Guardar cambios", no "Enviar").

## Costos Firebase (leer antes de agregar lecturas)

- Catálogo de productos se cachea en IndexedDB (Dexie) para POS/Trabajador.
- Listas paginadas con `limit()`; nada de leer colecciones completas.
- Denormalizar nombre de producto en stocks/movimientos para evitar joins.
