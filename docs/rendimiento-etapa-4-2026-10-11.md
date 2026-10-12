# Etapa 4 — optimizaciones avanzadas con evidencia

Fecha: 11 de octubre de 2026. Trabajo local autorizado después de la etapa 3.

## Resultado y límites

Se implementaron la omisión de escrituras tributarias idénticas, señales de reintento de transacciones analíticas y un diagnóstico acotado para cajas, particiones y vencimientos. Se verificaron con datos ficticios y Firestore Standard local. No se realizaron lecturas ni escrituras productivas, solicitudes SUNAT, migraciones, borrados, cambios de planes, commits, push o despliegues.

La etapa incluye evaluar las alternativas avanzadas, no activarlas indiscriminadamente. **No se migraron cajas antiguas ni se repartieron nuevamente las estadísticas:** faltan la conciliación financiera de datos reales y métricas productivas que justifiquen esos cambios. Tampoco se activó una política de retención destructiva. La preparación local está entregada; estas intervenciones siguen condicionadas a su evidencia.

| Hallazgo | Trabajo entregado | Decisión |
| --- | --- | --- |
| F17, cajas antiguas | Conciliación de solo lectura, validación de pagos, contexto y corte de cierre | Mantener el respaldo paginado; no promover un saldo histórico automáticamente |
| F18, estados derivados | Evitar `set` idéntico en `applySaleStatusPatch`; medir intentos y duración de reconciliación | Conservar atomicidad de anulación, retención de efectivo y agregados |
| F18, contención analítica | Diagnóstico de tamaño de documentos por tienda/mes y señales de transacción reintentada | Ampliar particiones solo si mediciones reales identifican el cuello de botella |
| Retención | Muestra acotada de avisos, trabajos push y dispositivos vencidos; matriz de conservación | No borrar por antigüedad ventas, movimientos, cajas, comprobantes ni claves de idempotencia |

## F17: conciliación previa a cualquier migración

`functions/src/cash.ts` ya diferencia cajas con `summaryVersion: 1` de las antiguas. Las nuevas leen su resumen; una caja antigua abierta recorre sus ventas en páginas de 250. Un cierre antiguo con resumen conserva ese resumen; si carece de desglose verificable, se mantiene el error existente.

Para una consulta de una caja antigua con `N` ventas, las lecturas de datos de caja/ventas son aproximadamente `1 + N + indicador(N mod 250 = 0)`. La última consulta vacía cuenta como mínimo una lectura. Autorización, entradas de índices y otros consumos están fuera de esa fórmula. Una caja con 251 ventas requiere 252 lecturas de estos documentos frente a una lectura del resumen acumulado. **Ese ahorro es potencial si procede migrar; no se obtuvo con este diagnóstico.**

Se incorporaron `tools/audit-stage4.mjs` y `tools/stage4-audit-lib.mjs`:

- Conciliación de una sola caja, con empresa y sesión explícitas. Validación de empresa, tienda, usuario y estado en cada venta.
- Importes en centavos y pagos mixtos con suma exacta al total. Importes inválidos, métodos desconocidos, fechas ambiguas, devoluciones y efectivo de anulaciones quedan señalados para revisión.
- Corte basado en `closingStartedAt` para cajas cerrando/cerradas. Una anulación posterior al corte sigue formando parte de la fotografía reconstruida. Un corte ausente nunca se presume.
- Comparación con el resumen guardado, efectivo esperado y diferencia de cierre. Las divergencias se informan sin corregirlas.
- Transacción de solo lectura, páginas de hasta 250 y presupuesto predeterminado de 1.000 lecturas lógicas, configurable entre 3 y 5.000. Caja, ventas y páginas comparten la transacción. Si falta presupuesto para demostrar fin de consulta, `complete` es `false`, no se calculan efectivo esperado/diferencia ni se declaran discrepancias contra el resumen guardado usando ese subtotal.
- Máximo de 20 detalles de incidencias en el reporte, conservando el conteo total. No incluye nombres de clientes, documentos, tokens, comprobantes completos o líneas de productos.

Los valores son una vista calculada (`balancePreviewOnly: true`), no una acreditación de efectivo físico. `requiresFinancialReview` permanece verdadero incluso sin errores. Los importes parciales o calculados con incidencias no sirven para cerrar ni migrar una caja. No se verifican físicamente reembolsos ni se reemplazan sus registros; cualquier historia de efectivo anulada requiere revisar sus compensaciones.

Para una migración futura haría falta identificar las cajas que realmente siguen usando el respaldo, revisar pagos/anulaciones/reembolsos y saldos, acordar el resultado financiero y comprobar que no haya escrituras concurrentes al aplicar el cambio. Cambiar solo `summaryVersion` omitiría ventas históricas y es incorrecto. No existe un flag de aplicación en esta herramienta.

Ejemplo completamente local, sin Firebase ni credenciales:

```powershell
node tools/audit-stage4.mjs cash --fixture=docs/fixtures/etapa4-caja.json
```

Fixture ficticio: venta mixta S/25, efectivo S/15, Plin S/10 y apertura S/50 → efectivo esperado calculado S/65. No representa una caja del negocio.

Para un emulador local ya iniciado:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'demo-denzoz-ops'
$env:TENANT_ID = 'stage4-local'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
node tools/audit-stage4.mjs cash --session=legacy --budget=300
node tools/audit-stage4.mjs statistics --store=statistics-store --month=2026-10
node tools/audit-stage4.mjs retention --uid=U1 --sample=100
```

`--output=archivo.json` guarda un archivo nuevo; no sobrescribe uno existente. Los argumentos de escritura como `--apply` se rechazan. La ayuda describe un opt-in para lecturas remotas con ADC y proyecto explícito; **no se ejecutó**. Un diagnóstico remoto consume operaciones y requiere un alcance de lectura autorizado. Los emuladores solo se admiten en localhost:8080 y el proyecto demo indicado.

## F18: escrituras repetidas y señales de contención

`applySaleStatusPatch` ya leía la venta dentro de una transacción. Ahora compara el resultado efectivo con ese snapshot antes de escribir. Se conserva la primera `voidedAt`, no se reactiva una venta anulada y los efectos de la primera anulación permanecen en la misma transacción.

Los valores ordinarios se comparan estructuralmente. Borrar un campo ausente se omite; borrar uno presente se ejecuta. Incrementos, timestamps del servidor y otras transformaciones se siguen ejecutando. No se cambian el intento tributario, leases, próxima recuperación ni montos. Una respuesta distinta sigue escribiéndose.

Prueba instrumentada: primera anulación produjo una escritura de caja y una de venta; 100 repeticiones agregaron cero escrituras, conservaron fecha y ajustaron efectivo una sola vez. Se mantuvieron 103 lecturas entre la primera operación, las repeticiones y un intento de reactivación, antes de considerar reintentos del SDK. El cambio no incorpora lecturas nuevas para comparar.

Firestore cuenta cada `set`/`update` como escritura según su [documentación de facturación](https://firebase.google.com/docs/firestore/pricing). También establece que una escritura sin cambio de datos no genera eventos; por eso **no se contabiliza una reducción adicional de invocaciones por estos no-op**. Los cambios tributarios efectivos siguen invocando el trigger de ventas y su filtro analítico existente. [Triggers de Firestore](https://firebase.google.com/docs/functions/firestore-events).

`reconcileSaleStatistics` registra un aviso estructurado solo si el callback transaccional se ejecutó más de una vez: `tenantId`, `saleId`, `attempts`, `elapsedMs`, `completed`. No crea documentos adicionales, no registra pagos/items/clientes y propaga los mismos errores. Estos avisos tienen consumo de logs. Un reintento es una señal para investigar, no una prueba de que el resumen mensual sea la causa: también puede intervenir la misma venta o una falla transitoria. [Transacciones y contención](https://firebase.google.com/docs/firestore/transaction-data-contention).

La recuperación programada y los filtros del trigger no se modificaron. Se probaron eventos de metadata SUNAT, confirmación de analítica y backoff: no entran al modelo de agregación. Esto evita trabajo dentro de la función, aunque una modificación real de la venta sigue generando su invocación.

### Por qué no se ampliaron las particiones

Cada venta toca un resumen mensual de tienda y los grupos de sus productos. El modelo ya usa 32 grupos y divide nodos grandes antes de aproximadamente 850.000 bytes JSON. Esa división protege tamaño, pero el resumen mensual continúa siendo un documento compartido. Aumentar solo grupos de productos no elimina esa contención.

El modo `statistics` inspecciona una tienda/mes con transacción de solo lectura, páginas de 100 y presupuesto de 515 lecturas lógicas por defecto. Informa tickets del resumen, número de productos por partición, nodos divididos y bytes JSON; advierte desde 800.000 bytes, un margen diagnóstico respecto del umbral del código. **Bytes JSON no son tamaño almacenado exacto, bytes de índices ni facturación.** Una inspección truncada se marca como incompleta y no acredita cobertura.

No mide latencia, carga máxima o contención productiva (`contentionMeasured: false`). Las pruebas de concurrencia comprobaron idempotencia y generaron avisos de reintento en el emulador; contenían solicitudes duplicadas y no permiten atribuir el bloqueo solo al resumen mensual.

Antes de aplicar shards de escritura o una cola independiente, medir duración p50/p95, errores ABORTED, intentos por reconciliación, demora entre venta y aplicación, backlog/edad de pendientes, escrituras de los documentos involucrados y costos de consulta. Comparar bajo la misma carga y demostrar igualdad tras duplicados/anulaciones. Más shards también aumentan lecturas para consultar y necesitan una transición compatible; la [solución oficial de contadores distribuidos](https://firebase.google.com/docs/firestore/solutions/counters) describe ese intercambio. No se añadieron servicios, schedulers ni un esquema analítico paralelo sin evidencia.

## Retención: decisión y muestra

| Datos | Decisión de esta etapa | Motivo |
| --- | --- | --- |
| Ventas, caja, reembolsos y kardex | Conservar | Trazabilidad financiera y de inventario |
| Correlativos, XML/CDR/PDF, resúmenes/bajas/notas y jobs tributarios | Conservar | Identidad fiscal, recuperación y archivo; no asumir plazo legal |
| `operation_receipts`, `sale_requests`, reservas de operación | Conservar | Borrarlos puede permitir repetir operaciones con claves antiguas |
| Catálogo, stocks, locks operativos y permisos | Conservar | Estado activo; la edad no determina obsolescencia |
| Agregados estadísticos y cobertura histórica | Conservar | Descartarlos rompe consultas; reconstruir también cuesta y requiere cobertura |
| Fotos/incidencias | Conservar | Revisar referencias y necesidades del negocio antes de eliminar archivos |
| Avisos calendario | Evaluar vencidos | `expiresAt` existente de 90 días; revisar inbox, activos y push en curso |
| Jobs push de reposición | Evaluar terminales vencidos | `expiresAt` existente de siete días; pendientes/leases requieren revisión |
| Dispositivos push | Evaluar vencidos | Vencimiento numérico existente; confirmar uso y registro antes de limpiar |

El modo `retention` lee las primeras 100 filas por ID de tres ámbitos: inbox del usuario elegido, jobs de reposición de la empresa y dispositivos de esa empresa. Configurable hasta 250 por ámbito. Distingue vencidos, vencidos pendientes/en lease y vencimientos inválidos. Si llena la muestra, `mayHaveMore` es verdadero. **Es una muestra por orden de ID, no aleatoria ni un conteo global ni una estimación del total vencido.** No inspecciona ni acredita la configuración TTL remota.

Se conservan las expiraciones lógicas implementadas en la etapa 1. No se deduce una política destructiva de esos campos. TTL requiere tipos temporales apropiados en Standard; un vencimiento numérico de dispositivo no basta. Las eliminaciones TTL no incluyen cuota gratuita, no son instantáneas y pueden disparar listeners/triggers. Activarlo sobre históricos puede causar un barrido. [Facturación](https://firebase.google.com/docs/firestore/pricing), [retención TTL](https://firebase.google.com/docs/firestore/ttl).

Antes de una limpieza futura, establecer candidatos, exclusiones, revisión de referencias/leases, respaldo verificable, tamaño de lote y beneficio de almacenamiento frente a lecturas/borrados. No se propone un plazo tributario: esta etapa no fue una revisión legal ni cambió obligaciones de archivo.

## Validación y cierre

| Verificación | Resultado |
| --- | --- |
| `npm run test`, Functions | Build TypeScript estricto y 39 pruebas aprobadas, incluidas cuatro nuevas de esta etapa |
| Diagnóstico y protección de CLI | Siete pruebas aprobadas: centavos, pagos mixtos, contexto, corte, presupuesto, particiones, retención y rechazo de accesos remotos implícitos |
| Diagnóstico y concurrencia en Firestore Standard local | Cuatro pruebas aprobadas con SDK reales; 251 ventas, anulaciones simultáneas, agregados y conservación de datos |
| Regresiones de backend en Auth/Firestore/Functions locales | Ocho pruebas aprobadas: inventario, compensación/reembolso, cierre, particiones grandes, lotes fiscales simulados, usuarios, push y preparación de metadatos |
| Requisitos de índices/exenciones | Dos pruebas aprobadas; sin nuevos índices ni cambios a reglas en esta etapa |
| Sintaxis de scripts y `git diff --check` | Correctos; avisos de normalización LF/CRLF de Git |

Total de esta ejecución, sin repeticiones: **60 pruebas**, de las cuales 15 son nuevas de la etapa 4. Se probó además el fixture CLI sin red. Los tiempos del emulador no constituyen un benchmark productivo ni una promesa de capacidad. Functions volvió a usar Node 24 del equipo, aunque la configuración de publicación solicita Node 22.

No se modificaron UI, reglas, índices, umbrales fiscales, stock ni contratos públicos. No se repitieron las suites de navegador, PHP o build web porque esta etapa no modificó esos módulos. Las herramientas se incorporaron al runner local de emuladores. Los emuladores iniciados para verificar esta etapa se detuvieron al terminar.

Para publicar, siguen pendientes la validación Docker, persistencia y respaldo de Render, compatibilidad del runtime Node 22 y las comprobaciones de infraestructura/contrato DNI registradas en las etapas anteriores. No existe una etapa 5 en el plan; el trabajo posterior es validar y publicar de forma coordinada, y ejecutar únicamente las intervenciones avanzadas justificadas por datos reales.
