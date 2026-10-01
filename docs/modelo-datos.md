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

## Stock compartido por presentaciones

Todos los productos usan un saldo por ubicación en unidad base. `quantity` y `baseQuantity` guardan el mismo total con `stockModelVersion: 3`; `presentationQuantities` queda vacío. Las presentaciones conservan factor, código, precio y configuración de fracciones, y consumen ese mismo saldo.

Una venta de 0.5 millar con factor 1000 descuenta 500 unidades y cobra 0.5 del precio por millar. Las líneas del mismo producto suman su consumo base antes de validar disponibilidad. Ingresos, transferencias, recepciones, reposiciones, ajustes y faltantes usan la misma equivalencia.

Los registros de versión 2 se leen verificando `sueltas + suma(empaques × factor) = quantity`, y se unifican al escribir la siguiente operación. Una mezcla heredada sin equivalencia verificable se rechaza para conciliación. [Detalle y verificación](stock-compartido-presentaciones.md).

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

## Calendario compartido

`users/{uid}.canManageCalendar` es un permiso boolean del POS administrado por el admin. Admin siempre tiene calendario; POS multi-tienda heredado sin el campo conserva acceso, y false lo revoca.

`tenants/{tenantId}/calendar_events/{eventId}` guarda título, descripción, tipo, fecha/hora de Perú, dueAt, estado, repetición, reminderDays, version, autor/editor y cursor de recordatorios. Es común para toda la empresa y solo Functions escribe.

`tenants/{tenantId}/calendar_inboxes/{uid}/notifications/{notificationId}` guarda avisos derivados con eventId/eventVersion, título y fecha denormalizados, estado de lectura/posposición, active, cursor de push y expiresAt. Cada propietario autorizado lee su bandeja; las modificaciones son Functions.

`calendar_push_devices/{sha256(token)}` es privado al servidor, identifica propietario/empresa, token, fecha de renovación y vencimiento. No participa en lecturas de cliente. Los índices y el flujo de activación están en `docs/calendario-y-mejoras-pos.md`.


## Stock mixto (versión 4, septiembre de 2026)

El detalle vigente está en `stock-compartido-presentaciones.md`. `baseQuantity` contiene unidades compartidas; `presentationQuantities` conserva cajas cerradas por ID; `quantity` es su total equivalente. Las presentaciones con `autoUnpackEnabled: false` solo se venden enteras desde su propio saldo. La versión 3 con cajas cerradas requiere reclasificación física antes de operar. `adjustInventory` acepta `type: reclasificar` solo para admin y registra conversión con variación total cero.
