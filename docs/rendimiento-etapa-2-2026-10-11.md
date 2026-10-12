# Etapa 2 — reducción de consumo

Fecha: 11 de octubre de 2026. Cambios locales autorizados después de la etapa 1. No se publicaron servicios ni índices, cambiaron planes o ejecutaron operaciones sobre producción.

## Alcance implementado

| Hallazgo | Cambio | Archivos principales |
| --- | --- | --- |
| F05 | Cobertura del catálogo por commit observado; recuperación acotada de desbordamientos | `apps/web/src/lib/live-collection.ts` |
| F06 | Presupuesto previo de lecturas y hasta cuatro consultas concurrentes de particiones estadísticas | `functions/src/statistics.ts` |
| F09 | Calendario y reintentos de reposiciones comparten el disparador de cinco minutos | `functions/src/calendar.ts`, `replenishment-notifications.ts`, `notification-maintenance.ts`, `index.ts` |
| F14 | Cuatro exenciones de campos grandes, contrastadas con consultas del repositorio | `firestore.indexes.json`, `tools/backend-indexes.test.mjs` |
| F08, preparación | Registro de venta utiliza las opciones comunes de App Check | `functions/src/operations.ts` |

Se conservaron ventas, movimientos de stock, permisos, configuración tributaria y el flujo de comprobantes. Los pendientes de hosting, persistencia tributaria y contrato DNI de la etapa 1 continúan registrados en `docs/rendimiento-etapa-1-2026-10-11.md`.

## F05: sincronización del catálogo

Antes de paginar, el repositorio obtiene el commit más reciente mediante una consulta de un documento. La carga inicial incluye los registros heredados sin `committedAt` y recorre una sola vez las páginas por ID. El listener se inicia desde ese commit observado.

La cobertura guardada corresponde a un intervalo efectivamente recuperado. Recibir un documento más nuevo en el listener no adelanta por sí solo esa cobertura durante una recuperación. Si más de 300 cambios superan la ventana del listener, se recuperan por páginas entre la cobertura anterior y un nuevo commit observado; no se repite la descarga completa.

Se mantienen los límites de 300, las suscripciones compartidas, la recuperación al reconectar, las bajas lógicas y la separación de repositorios por empresa/tienda. Los snapshots de caché o con escrituras pendientes no confirman cobertura. El primer snapshot confirmado utiliza sus documentos aunque `docChanges()` esté vacío tras un evento de metadatos.

Los cambios recibidos mientras IndexedDB guarda se conservan para la siguiente persistencia. Después de un fallo de escritura local, la siguiente persistencia reconstruye las filas antes de avanzar el checkpoint. Esto evita guardar una cobertura que apunte más allá de datos faltantes.

### Evidencia local de lecturas

| Caso | Recuperación | Listener inicial | Total de documentos lógicos |
| --- | ---: | ---: | ---: |
| 301 registros con commits distintos | 302, incluido el commit observado | 1 | 303 |
| 301 registros con el mismo commit y una fila heredada | 303, incluido el commit observado | 300 | 603 |

La auditoría había reproducido 902 documentos lógicos para 301 filas con el listener llegando durante la recuperación anterior. Estos casos actuales distinguen timestamps y orden de llegada; no constituyen una medición de facturación ni un porcentaje de ahorro universal. La frontera inclusiva conserva el solapamiento necesario para commits iguales.

La caché sigue usando `sync-v2` y conserva compatibilidad con IndexedDB existente. No se introdujo una migración remota. La persistencia incremental de todas las recuperaciones y la disposición completa de repositorios, propuestas en F11, pertenecen a la etapa 3.

## F06: estadísticas con presupuesto previo

Las consultas de productos se planifican en tandas de hasta cuatro. Cada límite se reserva antes de emitir la consulta, con un máximo de 513 documentos por mes para detectar el exceso de 512 particiones.

El presupuesto lógico de 5.000 incluye tiendas, resúmenes, particiones, consultas vacías y la lectura final de cobertura. Cuando una página limitada queda llena, se reutiliza el presupuesto no consumido de la tanda para comprobar su continuación. Si no alcanza para demostrar que los resultados son completos, se mantiene el rechazo explícito `resource-exhausted`; no se devuelven estadísticas truncadas.

Se conserva una transacción de lectura para la consistencia de los agregados, los permisos, el caché de resultados y la validación de periodos/tiendas. Cerca del límite puede rechazarse una solicitud que necesite una lectura adicional para demostrar el final de una página. El presupuesto no incluye las lecturas de autorización y cuota previas, posibles reintentos del SDK, entradas de índice ni todo el gasto facturable.

Pruebas del handler compilado, con Firestore simulado:

- 512 particiones mensuales devuelven importes y unidades completos.
- Trece meses de 513 particiones rechazan después de cuatro consultas: 2.066 lecturas lógicas, frente a las 6.683 que podía recuperar la tanda anterior antes del rechazo.
- Un caso de frontera completa termina con 5.000 lecturas, incluida una comprobación de final de página. El caso que requiere exceder el presupuesto se rechaza.
- Consultas vacías y varias tiendas mantienen el conteo y el máximo de cuatro consultas concurrentes.

## F09: un disparador para notificaciones

`sendCalendarReminders` conserva la cadencia de cinco minutos y ejecuta calendario y reposiciones mediante `Promise.allSettled`. Ambas tareas arrancan aunque una falle de forma síncrona o asíncrona. Los fallos se identifican por tarea y se propagan al scheduler después de esperar a ambas.

Cada tarea tiene su presupuesto temporal independiente. Se dejan de iniciar operaciones cuando quedan menos de 60 segundos del presupuesto de 240 segundos; el handler tiene timeout de 240 segundos. El trabajo que no comienza permanece pendiente para el siguiente ciclo. Los leases y estados por documento se conservan.

El handler usa `maxInstances: 1` y `concurrency: 1`. Esto limita concurrencia en la instancia, pero no convierte la entrega del scheduler en exactamente una ejecución global; la protección por trabajo sigue siendo necesaria. Un timeout puede interrumpir una operación ya iniciada y debe observarse durante la publicación.

| Configuración de disparadores | Jobs | Ejecuciones por día | Ejecuciones en 30 días |
| --- | ---: | ---: | ---: |
| Anterior | 4 | 864 | 25.920 |
| Preparada en código | 3 | 576 | 17.280 |

La reducción es de 8.640 invocaciones programadas por 30 días. Las consultas útiles de ambas tareas se mantienen; el ahorro monetario depende del uso compartido de la cuenta y sus SKUs. [Documentación de funciones programadas](https://firebase.google.com/docs/functions/schedule-functions).

El export desplegable `retryReplenishmentPush` se retiró del código y su lógica quedó en `runReplenishmentPushRetries`. El job remoto anterior no se eliminó durante esta tarea: la reducción operativa requiere publicar el handler compartido, verificar ambas tareas y retirar después el despliegue anterior. Si se dejan ambos activos, continúan los cuatro jobs y el trabajo de recuperación duplicado.

## F14: matriz de exenciones

| Colección / campo exento | Uso observado | Campos consultados que se conservan |
| --- | --- | --- |
| `sales.items` | Detalle leído como parte de la venta y para reconstrucción fiscal/analítica | Tienda, usuario, fecha, tipo, estado y estados de recuperación |
| `sale_requests.input` | Recuperación del cobro mediante ID conocido | Identidad de solicitud y controles de estado existentes |
| `operation_receipts.result` | Resultado idempotente recuperado por ID/huella | Identidad y huella de operación |
| `sunat_summary_jobs.payload` | Payload tributario leído por documento conocido | Día, estado y fecha del siguiente intento |

La prueba recorre llamadas `where`/`orderBy` con campos literales en frontend, Functions y herramientas, y contrasta las exenciones con índices compuestos. No encontró filtros ni ordenamientos sobre esos campos o sus descendientes. Se preservan los índices de sincronización, colas y listados.

Las exenciones reducen trabajo y almacenamiento de índices cuando se publiquen; no eliminan documentos ni reducen el número de escrituras documentales. [Índices y exenciones de Firestore](https://firebase.google.com/docs/firestore/query-data/index-overview).

No se configuró TTL ni se eliminó información fiscal, kardex, solicitudes o recibos idempotentes. La retención requiere definir primero los periodos operativos y fiscales y el plazo durante el que se admiten reintentos; borrar recibos antes de ese plazo podría permitir repetir una operación.

## F08: App Check preparado

`createSaleRecord` utiliza ahora `onCall(appCheckOptions, safeRegisterSale)`, igual que los demás callables. No se modificó `ENFORCE_APP_CHECK`: el efecto al desplegar depende de su valor existente. Si ya está en `true`, esta venta empezará a exigir App Check también; comprobar clientes instalados y métricas de tokens antes de publicar esa combinación.

## Validación

| Verificación | Resultado |
| --- | --- |
| `npm run test`, en `functions` | Build correcto y 32 pruebas aprobadas |
| Pruebas de catálogo, índices, frontend y payload fiscal, con `node --test` | 25 pruebas aprobadas |
| Typecheck y lint de web | Correctos |
| Build de web y PWA | Correcto; avisos existentes de tamaño de chunks e importación mixta de `calendar-push` |
| Navegador Edge mediante Playwright, Firestore/Auth locales | Tres escenarios aprobados: 50, 500 y 5.000 productos |
| `git diff --check` | Sin errores de whitespace |

Total: 57 pruebas unitarias/de regresión y tres escenarios de navegador aprobados. La suite del catálogo se incorporó también a `tools/run-emulator-tests.mjs`; no se ejecutó en esta etapa la suite completa de migraciones/ventas/Storage, cuyo alcance no cambió.

### Navegador con SDK y Dexie reales

| Productos | Ráfaga con el mismo commit | Reconexión | Recarga desde IndexedDB | Tiempo inicial observado local |
| ---: | ---: | --- | --- | ---: |
| 50 | 50 actualizaciones | Correcta | Correcta | 5.218 ms |
| 500 | 500 actualizaciones | Correcta | Correcta | 1.562 ms |
| 5.000 | 500 actualizaciones | Correcta | Correcta | 7.094 ms |

Los tiempos incluyen el arranque y navegación de la prueba, se midieron una sola vez y no son un benchmark comparativo de producción. El caso pequeño fue el primero y tuvo arranque frío. El navegador bloqueó solicitudes a destinos ajenos a localhost. Los fixtures utilizaron el proyecto `demo-denzoz-ops` y emuladores nuevos, sin importar datos productivos.

## Publicación pendiente

La implementación local está terminada. Para hacer efectivos los cambios en una publicación autorizada:

1. Revisar el valor efectivo de App Check y la compatibilidad de los clientes que registran ventas.
2. Publicar Functions e índices, verificar que calendario y reposiciones corran en el handler compartido y retirar el job remoto anterior después de esa comprobación.
3. Publicar el frontend y verificar la versión del service worker y la actualización del catálogo con varios dispositivos.
4. Observar documentos recuperados, desbordamientos, errores de caché, consultas estadísticas rechazadas, edad de pendientes y duración de las dos tareas de notificaciones.

No hace falta redesplegar Laravel para estos cambios. La validación local no sustituye las métricas del despliegue ni resuelve los pendientes de infraestructura de la etapa 1.
