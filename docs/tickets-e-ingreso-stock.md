# Tickets e ingreso de stock — 30/09/2026

## Stock

- 50 unidades sueltas + 50 cajas cerradas de 30 = 1550 unidades equivalentes.
- Se conservan `baseQuantity: 50` y `presentationQuantities: { closed30: 50 }`.
- Apertura desactivada: la caja se vende completa y no alimenta las unidades sueltas.
- Apertura activada: el contenido comparte stock base. La venta fraccionada permite cantidades de presentación según el paso permitido, sin fraccionar unidades contables.
- Ingreso usa `lib/inventory.ts` y la Function transaccional existente. El resumen de ingreso agrupa las equivalencias de cada producto y conserva las líneas enviadas por presentación.

## Ticket

- Diseñador: tabla o lista compacta, 58/80 mm, tamaño de texto, tamaño y alineación del logo, código, precio unitario, cajero y cliente; eslogan, teléfono y pie multilínea.
- La vista previa aplica los estilos usados al imprimir. El enlace del logo permanece editable; PNG/JPG/WEBP hasta 200 KB.
- Solo se guardan los campos de diseño mediante una transacción; no se sobrescriben parámetros tributarios.
- Solo se aceptan fuentes de imagen HTTP/HTTPS, rutas locales del sitio y datos PNG/JPEG/WEBP. Se escapan valores interpolados en HTML y se limitan tamaños.
- La impresión espera imágenes (hasta 8 segundos) y fuentes. Un logo fallido se oculta; el POS informa que puede reimprimir.
- Cada venta confirmada abre la impresión una sola vez. La ventana de éxito permanece con “Imprimir de nuevo”. Un fallo al imprimir no repite el cobro ni deja la venta pendiente.
- El navegador abre su diálogo de impresión. La impresión silenciosa requiere configuración del equipo o integración con la ticketera. No se confirmó salida en una impresora física.
- Los campos fiscales reales disponibles se conservan. Este cambio no genera un hash o QR fiscal ficticio.

## Reglas

Nuevo mapa `ticketDesign` validado profundamente: ocho claves exactas, enteros acotados, enums y booleanos. Mismo validador en creación y actualización. Solo administrador activo de la misma empresa escribe configuración. No se añadieron consultas ni índices.

Auditoría limitada al cambio de configuración:

```json
{"score":5,"summary":"El nuevo mapa de diseño conserva la autorización por empresa y administrador; se valida el documento final tanto al crear como al actualizar.","findings":[]}
```

El resultado no sustituye la auditoría completa previa ni acredita seguridad absoluta del sistema.

## Verificación

- Build web y Functions; typecheck y lint web.
- Pruebas de impresión: escape HTML, protocolos de imagen, ancho, límites de estilos, formatos y totales.
- Prueba en emulador de reglas: creación y actualización válida, mapa inválido, cambio anidado, usuario anónimo, POS y administrador de otra empresa.
- `tools/ticket-stock-smoke.py`: diseñador en 320/390/768/1365 px y 58/80 mm, logo lento/roto, ingreso mixto exacto de 1550 y venta con impresión automática, reimpresión y fallo de impresión.

Las pruebas solo permiten emuladores explícitos del proyecto `demo-denzoz-ops`. Preparar datos con `tools/seed-ui-emulator.mjs` antes del flujo de navegador.
