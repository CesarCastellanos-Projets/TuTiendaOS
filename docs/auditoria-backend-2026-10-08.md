# Auditoría de backend D'ENZOZ — 8 de octubre de 2026

> Este documento conserva el diagnóstico inicial. Los cambios realizados después de su aprobación y el procedimiento de publicación están en [backend-implementacion-2026-10-08.md](backend-implementacion-2026-10-08.md).

## Dictamen

La base transaccional de ventas e inventario está bien encaminada, pero todavía hay fallos de integridad entre módulos y riesgos de consumo al crecer. Que las pruebas actuales pasen no cubre reintentos de todas las operaciones, edición del catálogo con existencias, sincronización entre dispositivos ni todos los estados tributarios.

Este documento propone cambios para aprobación. No se modificaron las Functions, las reglas ni los datos de producción. Se preservaron los cambios previos del frontend. Las escrituras de prueba se realizaron exclusivamente en emuladores con el proyecto `demo-denzoz-ops`.

**Evidencia:** R = reproducido en emuladores; C = confirmado por código; N = observado mediante consultas de solo lectura a la nube; P = requiere validación posterior. Un riesgo C no significa que ya haya causado un incidente en producción.

## 1. Alcance y verificación

Se revisaron autenticación, roles, permisos temporales, catálogo, presentaciones, ingresos, ajustes, transferencias, faltantes, reposiciones, ventas, pagos, caja, cotizaciones, estadísticas, calendario, notificaciones, incidencias, Storage y el puente tributario Functions/Laravel.

| Verificación | Resultado |
| --- | --- |
| Functions: compilación y pruebas de stock/calendario | 15/15 pasan |
| Integración de inventario y ventas | 5/5 escenarios pasan |
| Integración de calendario | 1/1 escenario pasa |
| Migración de presentaciones | 1/1 escenario pasa |
| Reglas Firestore/Storage | 14/14 pasan |
| Utilidades de frontend: búsqueda, stock, CSV e impresión | 8/8 pasan |
| Construcción del comprobante fiscal | 4/4 pasan |
| Laravel, con SQLite en memoria y servicios simulados | 15 pruebas, 59 aserciones pasan |
| Typecheck y lint web | Pasan |
| Auditorías de dependencias de producción | Alertas pendientes; sección 8 |

Son 48 pruebas JavaScript existentes y 15 pruebas PHP. También se ejecutaron **10 comprobaciones adicionales**, todas con el resultado esperado: seis reprodujeron problemas o brechas de flujo y cuatro confirmaron controles correctos. Sus resultados y los errores de nube sin datos personales están en [la evidencia adjunta](auditoria-backend-2026-10-08-evidencia.json). Las pruebas de regresión no prueban ausencia de errores ni sustituyen carga, dispositivos reales o una homologación tributaria.

Java estaba disponible en la instalación local de JBR 21 y permitió ejecutar los emuladores. La ejecución local usó Node 24; las Functions publicadas indican Node 20. Hay que alinear el runtime en la validación final. Los planificadores y la entrega real de FCM no se validaron de extremo a extremo; la suite llama directamente a la lógica de recordatorios. No se enviaron comprobantes reales a SUNAT. El emulador intentó resolver un secreto en el proyecto demo y recibió 403; no se extrajeron secretos de producción.

### Configuración real observada

- Firestore `(default)`: edición **Standard**, modo Native, región `nam5`, elegible para cuota gratuita.
- Los 36 índices compuestos devueltos por la API estaban `READY`.
- Las reglas Firestore desplegadas coincidían exactamente con el archivo local consultado.
- Las Functions listadas usan segunda generación, `us-central1` y Node 20. No se comparó el código binario desplegado con cada archivo local.
- PITR y protección contra eliminación de la base figuraban desactivados. No se auditó el calendario de backups ni se hizo una restauración.
- Logs `ERROR` consultados desde el 1 de octubre: errores por índice/precondición en `getSalesStatistics` el 4 de octubre UTC y `getCashSessionSummary` el 1 de octubre UTC. Los índices actuales están disponibles. Esto explica errores históricos, pero no certifica por sí solo todas las consultas actuales.

No se descargaron colecciones comerciales para esta revisión. Las consultas a producción se limitaron a configuración, reglas, índices, métricas y errores técnicos.

## 2. Stock y cotizaciones: respuesta al caso del usuario

**La venta sí descuenta el stock del servidor transaccionalmente.** La Function vuelve a verificar producto, presentación, cantidad, precio y disponibilidad; el cliente no puede autorizar stock inexistente. Stock, movimientos, venta, correlativo y resumen de caja se escriben dentro de la transacción final.

**Una cotización no reserva ni descuenta stock.** El borrador del trabajador recalcula disponibilidad al recibir cambios del catálogo de tienda. Al guardar, el servidor calcula una fotografía de disponibilidad y precios. El PDF y la cotización guardada son fotografías; no cambian automáticamente después de emitirse. Al cobrar se valida otra vez la disponibilidad.

**La actualización visual entre equipos no está garantizada por el mecanismo actual.** Se escucha solamente el último documento modificado de la tienda, y esa señal dispara consultas de diferencias. Si cambia otro documento sin alterar el resultado de ese `limit(1)`, no llega la señal necesaria. Una prueba adicional reproduce el caso de marcas de tiempo empatadas. La autoridad del servidor evita sobreventa, pero la pantalla o el borrador pueden mostrar disponibilidad antigua hasta otra sincronización.

Reglas que deben conservarse:

- 50 unidades sueltas + 50 cajas cerradas de 30 = 1,550 unidades equivalentes: 50 vendibles sueltas y 50 cajas vendibles cerradas.
- El equivalente total no significa disponibilidad suelta. Una caja que no se puede abrir no cubre una venta de unidades.
- Con 950 hojas compartidas puede venderse 0.5 millar si la presentación permite apertura, fracciones y ese paso. Se cobra la mitad del precio del millar y se descuentan 500 hojas.
- La unidad contable `UN` exige enteros; unidades medibles configuradas, como KG o LT, admiten decimales.
- Cotizar no garantiza disponibilidad futura. La pantalla debe distinguir disponibilidad actual, fotografía guardada y reserva, si esta última se incorpora algún día.

## 3. Hallazgos de integridad y operación — prioridad alta

### A01. Repetir un envío puede descontar dos veces — R/C

`functions/src/inventory.ts`, `createInventoryTransfer`, genera un ID nuevo en cada llamada y no utiliza una clave idempotente. Con suficiente saldo, repetir el mismo envío produce dos transferencias y dos salidas. La prueba partió de 100 unidades, repitió un envío de 4 y terminó con 92. La prueba existente de concurrencia solo permitía un envío por falta de saldo; no cubría este caso.

**Propuesta:** ID de operación persistido en el dispositivo antes de enviar, huella del contenido y resultado recuperable en servidor. Aplicar el mismo contrato a ajustes y otras operaciones que cambian inventario. Los ingresos ya admiten `requestId`, pero su conservación en memoria no cubre cerrar o recargar la página después de una respuesta perdida.

### A02. Cambiar unidad base o apertura reinterpreta existencias — R/C

`functions/src/catalog.ts` impide eliminar presentaciones existentes o cambiar su factor, pero acepta cambiar la unidad base con stock. Se reprodujo UN → KG conservando cantidad 100. Esto cambia el significado de esas existencias y habilita otras reglas de fraccionamiento.

También acepta cambiar `autoUnpackEnabled`. `readStockState` incorpora dinámicamente cajas al saldo suelto cuando ese indicador está activo. Se reprodujo el cambio de 0 a 24 unidades disponibles sueltas a partir de dos cajas de 12 sin nuevo movimiento. Después de una operación, el estado se persiste convertido; desmarcar la opción no reconstruye cajas físicas.

**Propuesta:** separar la política de apertura de la conversión física. Bloquear cambios incompatibles con stock o documentos en tránsito; ofrecer conversión explícita, transaccional y con kardex cuando corresponda. No inventar cajas al volver a deshabilitar la apertura. Versionar el contrato de inventario/presentación para los documentos pendientes.

### A03. Las estadísticas pueden bloquear un cobro válido — C

`functions/src/statistics-model.ts` reescribe resúmenes mensuales y mapas de productos dentro de la transacción de venta. Existe un límite explícito de 850 KB que arroja `resource-exhausted`; al alcanzarlo, falla el cobro completo. El documento mensual por tienda, el correlativo y la caja también concentran contención. No se ha medido todavía el umbral real de concurrencia.

**Propuesta:** conservar venta, stock, correlativo y caja como núcleo autoritativo; sacar los agregados analíticos pesados mediante un evento duradero e idempotente. Usar particiones acotadas y agregados diarios/mensuales. Mostrar cuándo se actualizaron las estadísticas y reconciliarlas con ventas. Un retraso breve de analítica no debe impedir cobrar. Comparar costo total antes de escoger la partición definitiva.

### A04. Se permiten transferencias a almacenes que el flujo no puede recibir — R/C

`createInventoryTransfer` acepta destino `warehouse`, y la interfaz ofrece tiendas y almacenes. `receiveTransfer` solo autoriza un POS con tienda asignada y compara el destino con esa tienda. La prueba creó correctamente un envío a otro almacén; el admin no pudo recibirlo y el POS de otra ubicación tampoco.

**Propuesta:** receptor autorizado y explícito para cada tipo de destino; verificar existencia, tipo y permisos en la transacción. Mantener las cantidades recibidas ≤ enviadas y la gestión explícita de faltantes.

### A05. Eliminar ubicaciones deja referencias operativas — C

`apps/web/src/pages/admin/Locations.tsx` elimina tiendas/almacenes directamente. Las reglas permiten el borrado del admin sin verificar stock, cajas, usuarios ni transferencias. El texto de confirmación de tienda dice que se desasignarán usuarios, pero el código no realiza esa actualización. `receiveTransfer` lee la tienda sin exigir que exista antes de escribir la recepción.

**Propuesta:** archivar ubicaciones y bloquear nuevas operaciones, conservando historia; eliminación definitiva solo con verificación de dependencias y sin existencias. Definir un único almacén central o seleccionar explícitamente el origen de la reposición.

### A06. La cotización no queda procesada al vender — R/C

`Sale.tsx`, `loadQuoteIntoCart`, copia las líneas sin conservar una relación operativa con la cotización. `createSaleRecord` no procesa `quotationId`. La prueba cobró enviando ese ID y la cotización siguió `pendiente`.

Esto no duplica automáticamente un cobro, pero permite volver a presentar la misma cotización como pendiente y pierde su trazabilidad. Además, las 20 cotizaciones recientes se consultan antes de filtrar estados, por lo que pendientes antiguas pueden quedar ocultas.

**Propuesta:** conversión de cotización a venta en la transacción, relación bidireccional y estado procesado exactamente una vez; revalidar stock y precio, con confirmación si cambió el precio ofrecido. Paginar pendientes por estado. Añadir idempotencia a la creación de cotizaciones y solicitudes de reposición.

### A07. Anulación fiscal, devolución física y caja no forman un flujo completo — C/P

`functions/src/sale-status.ts` descuenta estadísticas y el resumen de una caja abierta al anular, pero no registra devolución de mercancía ni un movimiento de devolución de dinero. Si la caja está `cerrando` o cerrada, no actualiza su resumen; el cierre puede congelar otra interpretación de la venta. Las notas de venta y boletas consolidadas tampoco tienen resuelto el mismo recorrido que un comprobante individual aceptado.

**Propuesta:** distinguir anulación fiscal, devolución física y devolución de dinero; registrar cada evento una sola vez. No reingresar automáticamente mercancía dañada o no devuelta. Resolver anulaciones durante el cierre y después del cierre con movimientos compensatorios, conservando cierres históricos. La política de devolución física está pendiente de respuesta del usuario.

## 4. Sincronización y consultas — prioridad alta/media

### A08. Escuchar un único stock no es una señal completa — R/C

`apps/web/src/hooks/useStoreCatalog.ts`: listener de `updatedAt DESC limit(1)`; diferencias por `updatedAt >= watermark - 60000`. Los timestamps numéricos se calculan con `Date.now()` antes de confirmar. Empates, diferencias de reloj o confirmaciones fuera de orden pueden dejar una modificación fuera de la señal o de la ventana.

**Propuesta:** cursor basado en confirmación del servidor y señal de cambios fiable. Evaluar historial acotado de cambios con revisión, o listeners de documentos relevantes con reconciliación incremental; medir el costo de las escrituras adicionales frente al ahorro de lecturas. Evitar un único documento de revisión con contención sin medirlo. Incluir recuperación tras desconexión y cambios masivos. El servidor sigue verificando al cobrar.

### A09. La caché no evita recargar todos los stocks al navegar — C

Cada montaje de `useStoreCatalog` empieza sin cursor ni mapa compartido, aunque muestre Dexie primero. Relee todo el stock de la tienda en páginas de 300. Después vuelve a leer los productos modificados durante el último minuto por cada señal y reescribe la caché completa local.

**Propuesta:** repositorio compartido por empresa/tienda, cursor persistente, cambios aplicados solo a documentos modificados y suscripciones compartidas. Desmontar una página no debe reiniciar la sincronización. Diferenciar falta de conexión, permisos, índice y fallo local; hoy todos pueden aparecer como «offline».

### A10. Escanear espera una consulta de catálogo — C

`findInCatalog` espera `syncProductsCatalog` antes de buscar en memoria. Esto agrega red a cada lectura de código, aunque el producto ya esté cacheado. La sincronización de productos usa timestamps previos al commit sin solapamiento; una edición confirmada tarde puede quedar detrás del cursor. Una señal recibida durante la sincronización se comparte con la promesa existente sin exigir una nueva pasada.

**Propuesta:** resolver códigos primero en índices locales, refrescar en segundo plano y consultar red solo para desconocidos; revisión/cursor fiable y nueva pasada si llegó otra señal. Un precio o saldo local no sustituye la validación del cobro.

### A11. Disponibilidad de otras tiendas mezcla total y presentación — C

`WorkerQuotations.checkStockInOtherLocations` lee por producto sin `limit()` y muestra `quantity` equivalente, sin calcular si ese saldo permite la presentación elegida. Los resultados de `useCatalogSearch` incluyen inactivos; el borrador comprueba existencia del producto, sin exigir siempre `active`. El servidor sí rechaza productos inactivos.

Además, los resultados secundarios de búsqueda/escaneo no propagan `autoUnpackEnabled`, aunque el cálculo inicial de cantidad en cotización lo usa: puede proponer 1 presentación cuando solo cabe una fracción permitida.

**Propuesta:** contrato compartido de disponibilidad por presentación para POS, trabajador y otras tiendas; filtrar inactivos, propagar todas las capacidades y paginar ubicaciones.

### A12. Lecturas duplicadas de configuración — C

Cada `useCompany` mantiene su propia carga y listener. Layout y página pueden solicitar lo mismo. Ante un error se puede recurrir a configuración de demostración y mostrar datos de empresa/ticket incorrectos, aunque el servidor controle el comprobante fiscal.

**Propuesta:** configuración compartida por empresa, último valor confirmado y estado de error visible; nunca presentar silenciosamente una empresa de ejemplo como real.

## 5. Estadísticas, caja y límites de listas

### A13. El panel general no representa todas las ventas — C

`admin/Dashboard.tsx` consulta hasta 500 ventas y luego excluye las consolidadas. No excluye expresamente anuladas. Es una carga puntual sin actualización de ventas en vivo. Agrupa un pago mixto como método único en lugar de sus partes. El «stock crítico» consulta solo 300 documentos, usa umbral fijo 5 e ignora `minStock`; algunos contadores muestran tamaños limitados como si fueran totales.

**Propuesta:** misma definición de venta vigente para panel, estadísticas, caja y reportes; agregados comunes y contador marcado como parcial cuando corresponde. Baja existencia por mínimo configurado y disponibilidad por presentación.

### A14. El significado de los rankings necesita corregirse — C

`getSalesStatistics` ordena primero por cantidad de tickets, después por importe, no por unidades vendidas. «Menos vendidos» solo incluye productos con ventas; el frontend añade ceros a partir del catálogo de toda la empresa, sin asegurar que esos productos pertenezcan al surtido de las tiendas consultadas. Las horas muestran cantidad de transacciones, no personas que entraron.

**Propuesta:** ranking por unidades equivalentes, ventas o tickets con etiqueta explícita; distinguir cero ventas de poca rotación y limitar al surtido de cada tienda. Nombrar la hora como «más ventas»; no inferir afluencia de personas que no se mide.

### A15. Consultas anuales y refrescos pueden consumir bastante — C

La Function está acotada a 10 tiendas y hasta 13 meses, con 32 particiones de productos por mes. En el extremo puede leer aproximadamente **4,302 documentos** incluyendo perfil, tiendas, resúmenes y cobertura, si existen todos los documentos. No equivale a las lecturas de cualquier consulta normal. El dato `documentsRead` que devuelve no es una factura: no incluye todos los costos de reglas, índices, red ni reintentos.

Hay caché local de estadísticas, pero forzar Actualizar evita esa caché. No existe caché compartida ni presupuesto/rate limit equivalente en servidor.

**Propuesta:** resultados cacheados por empresa, tiendas, período y revisión; granularidad diaria/mensual apropiada, límites de frecuencia y de trabajo. Invalidar el día actual con moderación; períodos cerrados deben reutilizarse mientras no haya correcciones.

### A16. Fechas y paginación no son uniformes — C

Servidor de estadísticas usa Lima; algunos filtros de «hoy» usan el huso del navegador y otros UTC. Usuarios (100), ubicaciones (50), incidencias (100/50), comprobantes y otras listas tienen topes que evitan lecturas completas, pero no todas ofrecen una forma de acceder a registros más antiguos.

**Propuesta:** fecha comercial de Lima compartida y probada cerca de medianoche; paginación por cursor y filtros de servidor. Un límite es bueno para costos, pero no debe volver inaccesibles operaciones pendientes.

## 6. Roles, usuarios y auditoría

### A17. Creación de usuario incompleta ante fallos — C

`functions/src/index.ts`, `createUser`, no verifica que la tienda asignada exista. Crea Auth, luego perfil y luego claims, sin una recuperación de los pasos parciales. Una caída intermedia puede dejar una cuenta huérfana o exigir intervención manual. Tampoco se protege al último administrador activo contra desactivarse.

**Propuesta:** validar tienda activa, tamaños y tipos; aprovisionamiento idempotente con estado recuperable/compensación; proteger al último administrador y auditar cambios de privilegios.

### A18. La tienda activa multitiendas se comparte entre dispositivos — C

`selectPosStore` actualiza `users/{uid}.storeId`. Otro equipo con la misma cuenta recibe ese cambio mediante el listener del perfil. Puede cambiar el contexto de venta, caja, cotización o recuperación pendiente durante otra operación.

**Propuesta:** contexto operativo por sesión/dispositivo, con `storeId` explícito validado por servidor y permisos de alcance separados. Mantener caja ligada a usuario y tienda; no permitir que un cambio de pantalla desplace una operación pendiente.

### A19. Endpoints autenticados todavía pueden generar trabajo excesivo — C

La autorización comprueba perfil y empresa; los permisos multitiendas requieren perfil y claim. No se encontró un bypass entre tenants en las pruebas. Los permisos temporales del trabajador se vuelven a verificar dentro de la transacción: concesión, reintento del mismo ingreso y revocación funcionaron en la prueba adicional.

Sin embargo, la mayoría de endpoints caros no tiene rate limit ni App Check. Las reglas tampoco exigen `request.query.limit` en muchas colecciones. Un usuario autorizado puede generar lecturas repetidas o mayores que las previstas por la interfaz.

**Propuesta:** límites por usuario/empresa donde el costo lo amerite, tamaños y trabajo máximos, App Check primero observado y luego exigido, y límites de consultas compatibles con bootstrap/paginación. No introducir una lectura/escritura de rate limit por cada consulta local del escáner.

### A20. Metadatos de auditoría insuficientemente validados — C

La solicitud de anulación limita campos y razón, y exige dueño de la venta, pero no valida tipo/tamaño de `byUserName` y `requestedAt` ni exige todos los campos. Algunas actualizaciones de incidencias por admin pueden cambiar el origen histórico. Las listas anidadas escribibles requieren la misma validación semántica que espera el servidor.

**Propuesta:** actor y fecha generados por servidor, eventos de auditoría inmutables, esquemas completos create/update y transiciones permitidas. Conservar permisos de empresa y dueño; no abrir escrituras de stock al cliente.

## 7. SUNAT y notificaciones

### A21. Estados tributarios y reintentos pueden ocultar la causa o atascar la cola — C

`processSaleToSunat` convierte cualquier respuesta distinta de aceptado/observado satisfactorios en `rechazado`, incluso estados técnicos o de revisión. El planificador de ventas busca los primeros 50 pendientes sin orden por próximo intento ni backoff/max intentos uniforme; documentos problemáticos pueden ocupar los primeros cupos repetidamente. Las notas de crédito tienen otra política, pero filtrar elegibilidad después del límite puede retrasar documentos posteriores.

**Propuesta:** estados técnicos/fiscales distintos, próximo intento indexado, backoff, límite de intentos y cola de revisión; leases en cada frontera y reconciliación por referencia idempotente. SUNAT debe seguir fallando soft para el cobro.

### A22. Resumen diario incompleto al crecer o enviarse concurrentemente — C

`sendDailySummaryToSunat` trae 201 ventas y después filtra las ya resumidas. Más de 200 sin resumir arroja un error; no hay continuación por lotes. Las ya procesadas pueden llenar la página y esconder nuevas. La selección no reserva las boletas antes del envío externo: dos selecciones diferentes pueden solaparse. El cierre de caja no dispara el resumen diario, aunque la convención del proyecto lo contempla.

**Propuesta:** lotes estables e idempotentes de hasta 200, reserva de pertenencia antes de enviar, cursor y estados recuperables; programar la consolidación de fecha comercial y definir su relación con el cierre sin duplicar comprobantes.

### A23. El motor Laravel necesita exclusión y recuperación uniforme — C/P

Los índices únicos y el aislamiento por tenant son positivos. El controlador de facturas puede competir entre buscar y crear; el envío individual no usa el mismo mecanismo de claim/backoff que la recuperación de resúmenes/bajas. La asignación concurrente de ciertos correlativos fiscales requiere prueba específica, especialmente cuando todavía no hay una fila en la serie.

**Propuesta:** idempotencia por referencia y tenant, bloqueo/lease de envío, correlativos dedicados y manejo de conflicto único como recuperación. Probar timeout después de aceptación, envío repetido, ticket pendiente, revisión y recuperación. Las pruebas PHP actuales son locales con servicios simulados; falta verificar el motor publicado y el entorno de homologación, sin enviar documentos fiscales reales durante esta auditoría.

### A24. Push de reposiciones puede perderse o repetirse — C

El listener interno es acotado y compartido; calendario tiene IDs, versiones, leases y reintentos. En cambio `notifyReplenishmentRequest` envía FCM desde el trigger sin estado de entrega persistido y solo registra fallos transitorios. Puede perder avisos; un evento repetido puede enviarlos otra vez.

**Propuesta:** aviso durable y deduplicado por solicitud/destinatario, próximo intento y limpieza de tokens. Un fallo push nunca debe revertir la reposición. Firebase documenta que los eventos pueden repetirse y llegar fuera de orden: [triggers Firestore](https://firebase.google.com/docs/functions/firestore-events).

Los recordatorios de calendario se revisan cada cinco minutos; no prometen una alarma al segundo. La entrega con la app cerrada depende del permiso del navegador, service worker, sistema operativo y conexión. Falta validar dispositivos y restricciones reales de suspensión; no puede certificarse solo con emuladores.

### A25. Recuperación, archivos y observabilidad — C/N/P

No se comprobó una restauración de backup. PITR y protección contra borrado están desactivados. Las fotos admiten hasta 5 MB; existe limpieza del archivo si falla guardar la incidencia, pero una interrupción del proceso puede dejar huérfanos. No se verificó una política de retención activa para todas las colecciones técnicas, archivos, dispositivos y avisos antiguos.

**Propuesta:** plan de respaldo/restauración y retención con costo explícito, compresión razonable de fotos, limpieza de huérfanos y métricas por operación. Alertas de presupuesto y consumo son avisos, no un techo automático que garantice gasto cero. Evitar logs con tokens, certificados, datos personales o cuerpos completos de ventas.

## 8. Dependencias

Se ejecutaron auditorías de solo lectura, sin instalar ni actualizar paquetes:

| Componente | Resultado del registro consultado |
| --- | --- |
| Functions, `npm audit --omit=dev` | 14 paquetes señalados: 1 crítico, 3 altos y 10 moderados, incluyendo alertas propagadas por dependencias |
| Web, `npm audit --omit=dev` | 4 paquetes señalados altos, originados en la cadena de gRPC/Firestore |
| Laravel, `composer audit --locked --no-dev` | 6 entradas sobre Laravel/CommonMark; incluyen avisos altos y una entrada repetida sobre la misma familia de problema |

Estos números **no son 24 vulnerabilidades independientes ni prueban explotación en esta aplicación**. Por ejemplo, la alerta crítica de `proxy-addr` depende de configuración de confianza de proxy/IP; no se demostró un bypass de la autenticación Firebase. La cadena gRPC del SDK web no prueba que ese código entre en el bundle del navegador.

**Propuesta:** revisar alcance real y actualizar con versiones compatibles, lockfiles y regresión. No ejecutar `audit fix --force`: el sugeridor web propone incluso una versión mayor anterior de Firebase y el de Functions incluye una actualización mayor de Admin SDK. Laravel requiere una ruta de actualización compatible con Greenter y PHP.

Referencias de avisos consultados: [proxy-addr](https://github.com/advisories/GHSA-jqcg-44mw-7w3h), [Laravel](https://github.com/laravel/framework/security/advisories/GHSA-5vg9-5847-vvmq). Los JSON de evidencia conservan la lista exacta observada; conviene actualizarla al implementar porque los registros cambian.

## 9. Costos y rendimiento

### Uso observado

Cloud Monitoring, ventanas móviles de 24 horas terminadas aproximadamente a las 16:16 UTC; no son los días de facturación que reinician en horario del Pacífico:

| Fin de ventana UTC | Lecturas de documentos | Escrituras de documentos |
| --- | ---: | ---: |
| 2026-10-08 | 2,687 | 38 |
| 2026-10-07 | 321 | 11 |
| 2026-10-06 | 662 | 34 |
| 2026-10-05 | 393 | 11 |
| 2026-10-04 | 1,000 | 17 |
| 2026-10-03 | 691 | 8 |
| 2026-10-02 | 414 | 8 |

No se devolvieron series de borrados; ausencia de datos no se interpreta como cero certificado. Estas métricas no reemplazan la factura ni incluyen por sí solas todos los recursos.

La cuota Standard incluye 50,000 lecturas, 20,000 escrituras y 20,000 borrados al día para una base elegible por proyecto; también hay límites de almacenamiento y transferencia. Lecturas de listeners y evaluación de reglas pueden sumar consumo. Backups, PITR y TTL tienen cobro propio. [Precios oficiales de Firestore](https://firebase.google.com/docs/firestore/pricing).

### Presupuesto por flujo

- Si una tienda tiene N stocks y hay M montajes de pantalla, la recarga inicial actual cuesta aproximadamente N × M lecturas de stock, además del catálogo, reglas y otros listeners. Ejemplo hipotético: 1,000 stocks × 20 montajes × 3 equipos = 60,000 lecturas solo para ese patrón.
- Cada señal de stock repite los cambios del último minuto para cada cliente conectado. El consumo crece con usuarios, productos distintos vendidos por minuto y navegación, no solo con ventas.
- Una venta con P productos distintos, L líneas y B particiones estadísticas toca, aproximadamente, `10 + 2P + B` lecturas y `5 + P + L + B` escrituras en el camino actual de cobro. Son estimaciones por inspección, sin reintentos, listeners, reglas, SUNAT ni otros procesos. Tres productos/líneas en tres particiones dan aproximadamente 19 lecturas y 14 escrituras.
- Con ese ejemplo, 1,000 ventas ya implican unas 14,000 escrituras antes de otros módulos. Es necesario presupuestar escrituras además de ahorrar lecturas.
- Firestore, Functions/Cloud Run, Storage, red, Scheduler, logs, Secret Manager y el host tributario tienen modelos de costo distintos. Estar bajo 50,000 lecturas no garantiza factura total cero.

No propongo activar instancias mínimas ni una infraestructura adicional por defecto. Primero medir arranque frío/caliente, red, contención y costo. El runtime de emulador no permite prometer latencia de producción.

### Objetivos medibles propuestos

1. Búsqueda y escaneo de un código ya cacheado: respuesta local perceptible sin esperar red; objetivo p95 ≤ 100 ms en equipos acordados.
2. Cambiar entre pantallas de la misma tienda no provoca otra descarga completa de stocks.
3. Con conexión, cambios relevantes de stock visibles en otros equipos: objetivo p95 ≤ 2 s, medido bajo carga; el cobro siempre revalida servidor.
4. El cobro no depende de tamaño ni disponibilidad de agregados analíticos. Medir p50/p95 frío/caliente antes de fijar un SLO del servidor.
5. Estadísticas del día pueden tener unos segundos de retraso, informado por fecha de actualización y verificado mediante reconciliación.
6. Presupuesto objetivo con margen: ≤ 35,000 lecturas y ≤ 14,000 escrituras por día para el volumen operativo que confirme el usuario. No es una garantía universal ni un límite que deba bloquear ventas legítimas.

## 10. Evaluación específica de reglas

```json
{
  "score": 4,
  "summary": "Aislamiento de empresa y autoridad servidor de inventario sólidos en las pruebas realizadas. No se reprodujo acceso entre empresas ni escalamiento de POS/trabajador. Quedan validaciones de auditoría y límites de consultas por reforzar.",
  "findings": [
    {
      "check": "Type Safety / Update Bypass",
      "severity": "minor",
      "issue": "La solicitud de anulación no exige ni valida completamente byUserName y requestedAt, y permite metadatos de auditoría elegidos por el cliente.",
      "recommendation": "Generar actor/fecha en servidor y validar el esquema completo y la transición."
    },
    {
      "check": "Resource Exhaustion",
      "severity": "minor",
      "issue": "Muchas reglas list no exigen límites de consulta, aunque la interfaz normalmente los use.",
      "recommendation": "Exigir límites compatibles con caché y paginación, y controlar endpoints caros."
    },
    {
      "check": "Business Logic vs Rules",
      "severity": "minor",
      "issue": "El borrado de ubicaciones por un admin autorizado no protege referencias operativas.",
      "recommendation": "Archivar mediante servidor y denegar borrado directo; comprobar dependencias antes de eliminar."
    },
    {
      "check": "Audit Integrity",
      "severity": "minor",
      "issue": "El admin puede modificar ciertos datos de origen de incidencias al actualizar.",
      "recommendation": "Mantener origen inmutable y registrar la resolución como transición auditada."
    }
  ]
}
```

La puntuación pertenece a las reglas, no es una calificación global del sistema. Las Functions usan Admin SDK y no están sujetas a estas reglas; su validación y autorización se auditaron separadamente. Cambiar reglas no arregla por sí solo la idempotencia, los estados fiscales ni la sincronización.

## 11. Plan de implementación para aprobación

### Fase 1 — Proteger operaciones y existencias

- Incorporar las reproducciones como regresiones permanentes.
- Idempotencia persistente y recuperación para transferencias, ajustes e ingresos; extender a cotizaciones/reposiciones.
- Proteger unidad base, identidad de presentaciones y cambios de apertura con existencias o tránsito; conversiones explícitas con kardex.
- Resolver recepción de almacenes y existencia del destino; archivar ubicaciones con dependencias.
- Vincular conversión de cotización y venta transaccionalmente.
- Validar contratos de entrada antes de reservar: la prueba inicial mostró un `INTERNAL` si se omite `paidAmount`, aunque el formulario actual sí lo envía. Datos inválidos deben producir un error de validación sin trabajo parcial.

**Salida:** ningún reintento de la misma operación duplica stock, kardex o venta; ninguna edición cambia silenciosamente el significado de existencias.

### Fase 2 — Sincronización rápida con costo acotado

- Repositorio compartido de stock/configuración y cursores persistentes por empresa/tienda.
- Resolver búsqueda/escaneo en memoria; actualización incremental fiable, recuperación offline y errores diferenciados.
- Unificar disponibilidad e inactivos en POS, cotización y consulta de otras ubicaciones.
- Medir dos diseños de señales/deltas antes de escoger; incluir escrituras, listeners, reglas e índices en la comparación.

**Salida:** venta de un equipo se refleja en los borradores de otro; navegación no recarga colecciones completas; empates y commits fuera de orden no omiten cambios.

### Fase 3 — Caja y analítica coherentes

- Agregados pesados fuera del cobro, consumidores idempotentes y reconciliación.
- Panel general basado en los mismos agregados y definiciones; rankings y mínimos correctos.
- Caché de consultas y refrescos controlados; paginación y fecha Lima compartidas.
- Movimientos compensatorios para anulaciones, devoluciones y cierres según política acordada.

**Salida:** importes de venta, caja, métodos combinados y estadísticas concilian; una avería analítica no impide vender.

### Fase 4 — Permisos, reglas y dependencias

- Aprovisionamiento recuperable de usuarios y protección del último administrador.
- Contexto de tienda por sesión, permisos temporales probados durante operaciones concurrentes.
- Reglas de auditoría, borrado y consultas; rate limits selectivos y despliegue gradual de App Check.
- Actualizaciones compatibles de dependencias con regresión; revisar alcance de cada aviso.

**Salida:** matriz admin/POS asignado/POS multitiendas/trabajador con permisos concedidos y revocados pasa en servidor y reglas.

### Fase 5 — Fiscal, notificaciones y operación

- Máquina de estados, backoff y leases uniformes para comprobantes/notas/resúmenes.
- Resúmenes paginados y reclamados sin solapamiento; automatización por fecha/cierre acordado.
- Avisos de reposición duraderos, deduplicados y recuperables.
- Retención, respaldo/restauración, métricas y alertas con presupuesto explícito.

**Salida:** caídas y respuestas perdidas no duplican envíos fiscales ni dejan colas atascadas; push no cambia el éxito de la operación comercial.

### Fase 6 — Validación y publicación controlada

- Pruebas de contratos, reglas, concurrencia y recuperación en emuladores.
- Catálogos de 50, 500 y 5,000 productos; varios POS y trabajadores; escaneo continuo, reintentos, reconexión y navegación repetida.
- Medir consumo de una jornada representativa y p95; no extrapolar solo desde una cuenta de prueba.
- Validar FCM en escritorio/tableta/celular y motor tributario en homologación autorizada.
- Migraciones con diagnóstico previo, respaldo, idempotencia, pausa acotada y plan de recuperación. No ejecutar una migración de stock ambigua.
- Preparar cambios, instrucciones de despliegue y revisión de compatibilidad con clientes publicados antes de publicar.

## 12. Casos de aceptación mínimos

1. Dos cajas compiten por la última unidad: una venta, un descuento y un movimiento; la otra recibe stock insuficiente.
2. Respuesta perdida y recarga: recuperar la misma venta/envío/ingreso; cero duplicados.
3. 50 sueltos y 50 cajas de 30 cerradas: equivalentes 1,550; vender sueltos nunca consume cajas cerradas.
4. 950 hojas: 1 millar rechazado; 0.5 millar permitido si la configuración lo permite; queda 450.
5. Cotización abierta en otro dispositivo actualiza disponibilidad después de vender; guardarla no reserva; cobrarla queda vinculado una sola vez.
6. Cambio de unidad/apertura con stock o tránsito: bloqueado o conversión explícita con movimiento, nunca reinterpretación silenciosa.
7. Revocar permiso temporal durante un ingreso: la transacción no permite un ingreso posterior a la revocación confirmada.
8. Pago total 30, Plin 15 y efectivo recibido 20: aplicado 15+15, vuelto 5, caja efectivo 15, estadísticas Plin 15.
9. Anulación concurrente con cierre: saldos y compensaciones conciliables; devolución física según decisión registrada.
10. Varias tiendas/dispositivos con la misma cuenta multitiendas: el contexto de un equipo no cambia el del otro.
11. Más de 200 boletas consolidadas y envíos concurrentes: todos los lotes procesados, ninguna boleta incluida dos veces.
12. Agregado grande/temporalmente fallido: venta confirmada, analítica pendiente y recuperación comprobada.
13. Usuarios de otra empresa, perfil desactivado, claim antiguo y escrituras directas de stock: denegados.
14. Más registros que el límite de cada lista: cursor accesible y contadores honestos.
15. Reconexión, timestamps iguales y escrituras confirmadas fuera de orden: caché converge sin descarga completa en cada pantalla.

## Pendientes para dimensionar y cerrar políticas

- Cantidad prevista de tiendas, usuarios simultáneos y ventas diarias.
- Si una anulación exige confirmar devolución física, y cómo registrar reembolsos después del cierre.
- Homologación fiscal, entrega push real, carga y restauración de backup: requieren la siguiente etapa; no están certificados por esta auditoría.

Con esas decisiones y aprobación del plan se podrá implementar por fases, manteniendo los cambios de frontend existentes y sin publicar ni migrar datos durante esta etapa de diagnóstico.
