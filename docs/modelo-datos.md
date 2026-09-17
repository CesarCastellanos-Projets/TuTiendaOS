# Modelo de datos Firestore

Los datos operativos viven bajo `tenants/{tenantId}`. Los nombres denormalizados evitan lecturas extra y cada documento operativo conserva `tenantId` como defensa adicional y soporte para consultas administrativas del servidor.

| Colección | Documento | Notas |
|---|---|---|
| `tenants/{tenantId}/config/company` | singleton `company` | RUC, razón social, series, entorno SUNAT y umbrales |
| `users/{uid}` | usuario global | incluye `tenantId`; `role: admin\|pos\|trabajador`; `storeId` para POS/trabajador |
| `tenants/{tenantId}/stores` | tienda física | nombre, código, dirección |
| `tenants/{tenantId}/warehouses` | almacén/bodega | `isCentral` marca el almacén principal |
| `tenants/{tenantId}/products` | catálogo | sin stock; precio, códigos, categoría, mínimo, ubicación y promoción |
| `tenants/{tenantId}/product_stocks/{productId}_{locationId}` | stock por ubicación | mutación exclusiva de Cloud Functions; nombre denormalizado |
| `tenants/{tenantId}/stock_movements` | bitácora inmutable | toda mutación de stock genera un movimiento |
| `tenants/{tenantId}/transfers` | traslado entre ubicaciones | `pendiente→recibido\|cancelado` con cantidades recibidas controladas |
| `tenants/{tenantId}/replenishment_requests` | solicitud del POS | items con stock actual y solicitado |
| `tenants/{tenantId}/incidents` | incidencias de piso | Admin resuelve |
| `tenants/{tenantId}/sales` | comprobante emitido | items embebidos, estado SUNAT y anulación |
| `tenants/{tenantId}/cash_sessions` | caja diaria del POS | apertura/cierre con diferencia calculada |
| `tenants/{tenantId}/clients/{tipo}-{doc}` | caché de clientes | llenado por `lookupClient` |
| `tenants/{tenantId}/counters` | correlativos de serie | incrementos transaccionales aislados por empresa |

## Decisiones de costo

1. **Items de venta embebidos** (no colección `sale_items`): un ticket se lee completo con 1 lectura. Un ticket típico < 50 ítems (~10 KB), muy por debajo del límite de 1 MiB. Las reglas limitan `items` a 200 elementos.
2. **Paginación obligatoria**: ventas y movimientos usan `limit()` + cursor (`startAfter`). Nada lee colecciones completas.
3. **Repositorio único de catálogo**: Admin, POS y Trabajador comparten una sola instancia en memoria. Primero carga IndexedDB (Dexie) y luego sincroniza deltas paginados por `updatedAt`; un documento liviano `meta/catalog` avisa cambios sin crear listeners de `products`. Las claves offline de productos y stock incluyen `tenantId`.
4. **Caché de clientes**: DNI/RUC se consulta a APIS.net.pe una vez; luego vive en `clients`.

## Reglas de seguridad (firestore.rules)

- Autoridad: perfil `users/{uid}` activo con `tenantId`; los claims replican `tenantId` y rol para las Functions.
- Toda ruta `tenants/{tenantId}` exige que coincida con el perfil. Incluso un Admin no puede leer otra empresa.
- `product_stocks`, movimientos, transferencias y ventas se mutan mediante Cloud Functions transaccionales; el cliente no escribe stock.
- El POS solo puede abrir/cerrar su caja y solicitar la anulación de una venta propia.
- Las colecciones raíz heredadas quedan denegadas después de la migración.
