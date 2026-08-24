# Modelo de datos Firestore

Colecciones (single-tenant D'ENZOZ). Los nombres denormalizados evitan lecturas extra.

| Colección | Documento | Notas |
|---|---|---|
| `company` | singleton `main` | RUC, razón social, series (F001/B001), entorno SUNAT, umbrales configurables |
| `users/{uid}` | usuario | `role: admin\|pos\|trabajador`, `storeId` obligatorio para pos/trabajador |
| `stores` | tienda física | nombre, código, dirección |
| `warehouses` | almacén/bodega | `isCentral` marca el almacén principal |
| `products` | catálogo | sin stock; precio, códigos, categoría, stock mínimo, ubicación en góndola, promo |
| `product_stocks/{productId}_{locationId}` | stock por ubicación | `quantity >= 0` garantizado por reglas; nombre denormalizado |
| `stock_movements` | bitácora inmutable | `venta\|ingreso\|transferencia\|ajuste`; solo create, nadie edita |
| `transfers` | traslado entre ubicaciones | items con `qtySent/qtyReceived`, estado `pendiente→en_transito→recibido\|cancelado` |
| `replenishment_requests` | solicitud del POS al Admin | items con stock actual y solicitado |
| `incidents` | incidencias de piso | `dañado\|vencido\|sin_etiqueta\|sin_codigo\|otro`; Admin resuelve |
| `sales` | comprobante emitido | **items embebidos** (ver decisión abajo), estado SUNAT, anulación |
| `cash_sessions` | caja diaria del POS | apertura/cierre con diferencia calculada |
| `clients/{tipo}-{doc}` | caché de clientes | llenado por Cloud Function `lookupClient` (APIS.net.pe) |
| `counters` | correlativos de serie | `{serie: {current}}`; incrementos transaccionales |

## Decisiones de costo

1. **Items de venta embebidos** (no colección `sale_items`): un ticket se lee completo con 1 lectura. Un ticket típico < 50 ítems (~10 KB), muy por debajo del límite de 1 MiB. Las reglas limitan `items` a 200 elementos.
2. **Paginación obligatoria**: ventas y movimientos usan `limit()` + cursor (`startAfter`). Nada lee colecciones completas.
3. **Catálogo en IndexedDB** (Dexie): POS/Trabajador buscan offline; sincronización delta por `updatedAt`.
4. **Caché de clientes**: DNI/RUC se consulta a APIS.net.pe una vez; luego vive en `clients`.

## Reglas de seguridad (firestore.rules)

- Autoridad única: `users/{request.auth.uid}.role`. Nadie se auto-asigna rol.
- `product_stocks`: POS solo puede tocar `quantity` (con `quantity >= 0`) — vende o recibe transferencias; crea/elimina solo Admin.
- `stock_movements`: append-only.
- `sales`: POS crea en su tienda; actualizar solo Admin (estado SUNAT / anulación autorizada).
- Validación estricta de tipos en create/update; límites de tamaño en arrays y strings.
