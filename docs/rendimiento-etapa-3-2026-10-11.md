# Etapa 3 — rendimiento y escalabilidad

Fecha: 11 de octubre de 2026. Implementación local autorizada después de la etapa 2.

## Estado y alcance

Se implementaron las mejoras de caché, búsqueda, metadatos, fotografías y listados. El servidor tributario quedó preparado para Nginx/PHP-FPM y se probó su coordinación SQL con procesos PHP concurrentes. **La imagen Docker no se construyó ni ejecutó: Docker no está disponible en este equipo.** La capacidad HTTP del contenedor, consumo de memoria y comportamiento en Render siguen pendientes de esa validación.

No se realizaron despliegues, migraciones productivas, cambios de planes ni solicitudes a SUNAT. Se preservaron los cambios de las etapas 1 y 2. Los fixtures usaron el proyecto `demo-denzoz-ops`, emuladores locales y bases SQLite temporales. No se modificaron reglas, contratos fiscales, umbrales DNI ni cantidades o estados de negocio.

| Hallazgo | Implementación | Archivos principales |
| --- | --- | --- |
| F07 | Runtime Nginx/PHP-FPM, límites por empresa y servicio, coordinación de transacciones SQLite | `apps/api-fact/Dockerfile`, `docker/*`, `ApiServiceProvider.php`, `DatabaseTransaction.php` |
| F11 | Recuperación incremental en IndexedDB, referencias estables ante metadata, evicción tras inactividad | `live-collection.ts`, `catalog-repository.ts`, `stock-repository.ts` |
| F12 | Índice de búsqueda independiente del stock y reutilización de filas combinadas | `useStoreCatalog.ts` |
| F13 | Lecturas únicas dentro de cada intento y propagación con cuatro operaciones concurrentes | `transaction-reads.ts`, `bounded-work.ts`, `inventory.ts`, `operations.ts`, `stock-metadata.ts` |
| F15 | Continuidad de transferencias y ubicaciones; historial filtrado antes de limitar | `Receiving.tsx`, `Adjustments.tsx`, `useLocationOptions.ts` |
| F16 | Descarga por visibilidad y caché autorizada de blobs | `IncidentPhoto.tsx`, `photo-cache.ts`, `incident-photo-cache.ts` |

## F11: caché incremental y liberación

La primera recuperación conserva el reemplazo completo necesario para establecer la cobertura. Las siguientes guardan los IDs incluidos en el intervalo recuperado y los eventos concurrentes, tomando la versión más reciente de cada fila. No borran ni reinsertan todo el catálogo. Un fallo de persistencia mantiene la reconstrucción completa de seguridad incorporada en la etapa 2.

Los eventos recibidos mientras IndexedDB escribe se vacían antes de terminar la recuperación. Las actualizaciones de metadata/offline conservan la referencia del array de filas cuando no cambian sus datos, evitando reconstrucciones derivadas por cambios de conexión.

Después de 30 segundos sin suscriptores, el repositorio detiene el listener, retira su manejador `online`, espera sus escrituras pendientes, libera sus mapas y sale del registro de empresa/tienda. Una recuperación en curso aplaza esa liberación. La caché persistente no se borra; una nueva visita carga IndexedDB y recupera el intervalo faltante. También se programan la liberación de repositorios creados sin suscriptores y las recuperaciones directas.

Prueba de 5.000 filas con commits distintos y un cambio: como máximo dos filas enviadas a persistencia incremental, por la frontera inclusiva del intervalo, sin reemplazo. Esto mide argumentos de persistencia local, no bytes de disco ni facturación. Con muchos commits iguales puede recuperarse una frontera más grande; no se afirma que todas las reconexiones escriban exactamente una fila.

## F12: separar búsqueda y disponibilidad

Los nombres, códigos, presentaciones y textos normalizados se construyen a partir de las definiciones de productos. Un cambio de cantidad no reconstruye ese índice ni vuelve a puntuar el último término. La disponibilidad se calcula al proyectar los resultados, manteniendo el límite de 40, el ranking, desempate en español, códigos y búsqueda tolerante a errores.

El catálogo combinado conserva las referencias de los stocks que no cambiaron, mientras las definiciones sigan iguales. Los mapas de productos se reutilizan entre cambios de stock. Los arrays y el mapa de disponibilidad todavía recorren el catálogo; esto no convierte toda actualización en una operación O(1).

En una prueba instrumentada de 5.000 productos y una presentación adicional, construir y consultar el índice ejecutó 5.001 normalizaciones y puntuaciones. Cambiar la disponibilidad y repetir el mismo término agregó **cero** normalizaciones y puntuaciones; la cantidad de la presentación cambió de dos cajas a una. Desactivar el producto reconstruyó el índice y retiró sus resultados. Se probaron tildes, transposición de letras, código base, código de presentación y código interno con las mismas reglas existentes.

No se incorporó virtualización al catálogo Admin ni se reescribieron todos los buscadores auxiliares: falta un perfil que justifique su complejidad. Las mejoras anteriores cubren el índice usado por el POS; no se promete una reducción porcentual de CPU o latencia de toda la aplicación.

## F13: inventario y metadatos

`readUnique` agrupa referencias por ruta y ejecuta `getAll` una vez por conjunto. Devuelve snapshots en el orden original, incluidas las posiciones repetidas de varias presentaciones del mismo producto. Cada intento transaccional vuelve a leer: no se reutilizan snapshots entre reintentos.

Se aplica a ingresos, envío de transferencias, cancelación, atención de reposiciones y recepción. Se conservan las validaciones de cantidades, factores, permisos, acumulación por producto, movimientos por línea e idempotencia. Por ejemplo, tres líneas del mismo producto en un ingreso pasan de seis referencias de producto/stock a dos referencias únicas, además de la ubicación; esto es una reducción de solicitudes lógicas y no una medición de ahorro facturado del SDK.

La propagación de metadatos mantiene páginas de 100 stocks y ejecuta hasta cuatro transacciones simultáneas. Cada transacción vuelve a leer producto y stock, por lo que un evento atrasado no impone su nombre o mínimo antiguo. Cuando falla una tarea, se espera a las ya iniciadas, se deja de iniciar trabajo adicional y se propaga el error para el reintento existente. Los cambios ya aplicados se omiten al reintentar si sus metadatos coinciden.

Las comprobaciones con 101 stocks confirmaron el máximo de cuatro operaciones, uso de datos frescos, reintento y desactivación del producto. Se mantienen aproximadamente `3k` lecturas por propagación; la concurrencia mejora la organización de la espera, no elimina las comprobaciones de consistencia.

## F15: continuidad de listados

Recepciones utiliza páginas de 100 con orden por ID, conservando los filtros de tienda y estados `pendiente`/`en_transito`. La página visible mantiene su listener en tiempo real. Se muestran carga, errores, número de página y controles anterior/siguiente; el conteo indica los pendientes de esa página.

Ubicaciones carga hasta 50 tiendas y 50 almacenes por tanda. El botón de continuidad agrega la siguiente tanda sin perder opciones ya cargadas ni la selección. Las respuestas de una empresa anterior se descartan al cambiar de contexto. Tiendas y almacenes conservan su identidad de colección al combinar opciones.

El historial consulta `type in ['ajuste', 'merma', 'conversion']` **antes** del orden y límite de 20. Se mantiene un listener por página y continuidad. Los índices compuestos de `transfers(toLocationId,status)` y `stock_movements(type,createdAt desc)` ya existían; sus requisitos se agregaron a la prueba de índices. No se agregó un índice remoto nuevo.

Navegador con Firestore/Auth reales en emuladores: se accedió a 101 transferencias, 51 ubicaciones y 21 ajustes, aunque existían 101 ventas más recientes. No se ejerció recepción física ni ajuste desde esta pantalla de fixtures; esas operaciones se validaron en la suite de inventario.

## F16: fotos por visibilidad y permisos

Un `IntersectionObserver` inicia la descarga a 200 píxeles del área visible. En navegadores sin esa API se conserva la descarga inmediata. Se mantiene `getBlob`, límite de 5 MiB y object URLs por componente; cada URL se revoca al desmontar o cambiar imagen/sesión.

La caché de memoria admite hasta 20 blobs y 20 MiB, con reemplazo de los menos recientemente utilizados y deduplicación de solicitudes simultáneas. Se vincula a UID y perfil, se vacía al cambiar sesión/permisos y descarta la persistencia de cargas que terminaron en un contexto anterior.

Una reutilización consulta `getMetadata` antes de mostrar el blob para revalidar las reglas de Storage. Se evita transferir de nuevo el cuerpo, pero sigue existiendo una solicitud autorizada de metadata, con su consumo correspondiente. Un rechazo purga la entrada; no se usan URLs públicas. Las fotos montadas y solicitudes en curso tienen memoria adicional al límite de la caché; 20 MiB no es un tope del heap total.

La prueba de navegador usa el SDK real con respuestas de Storage simuladas: tres fotos fuera del viewport generaron cero solicitudes; al hacer scroll se descargaron tres cuerpos; después de desmontar y remontar hubo tres verificaciones de metadata y cero cuerpos adicionales. Las reglas reales en emuladores comprobaron metadata permitida al propietario, denegada a otra empresa y denegada al revocar `active`.

## F07: runtime tributario preparado

El Dockerfile usa PHP 8.2 FPM, Nginx y Supervisor. Nginx sirve únicamente `public`, envía PHP a `public/index.php`, deniega otros archivos PHP y rutas ocultas y no registra cuerpos/token. FPM escucha en loopback, usa procesos bajo demanda y un máximo inicial de dos workers, configurable entre 1 y 16. Se habilitan OPcache y mbstring. El límite de workers no demuestra capacidad ni garantiza el consumo de memoria.

El entrypoint valida variables requeridas y valores numéricos, prepara permisos, conserva las migraciones de arranque, genera el caché de configuración con el entorno efectivo y ejecuta `nginx -t`/`php-fpm -t` antes de iniciar Supervisor. Esas comprobaciones están preparadas para el arranque futuro; no se ejecutaron aquí. No se incluyen en la imagen certificados, datos SQLite, `.env` ni cachés PHP generados en desarrollo.

### Coordinación SQLite comprobada

Una prueba con dos procesos PHP y SQLite en archivo reprodujo `database is locked` al reservar documentos diferentes. El driver instalado de Laravel solo utiliza `transaction_mode` para PHP 8.4 o posterior; cambiar esa opción no corrige el caso del runtime PHP 8.2.

`DatabaseTransaction` coordina mediante `flock` las transacciones explícitas del motor cuando usa SQLite en archivo. Mantiene las transacciones, intentos y rollback de Laravel; las anidadas y bases en memoria no vuelven a tomar el bloqueo. Las reservas, secuencias y creación transaccional de resumen/baja/nota de crédito pasan por este punto. Las llamadas SOAP y generación de artefactos quedan fuera del bloqueo.

Después del cambio, dos procesos intentando el mismo documento produjeron un solo envío simulado y un intento; dos documentos diferentes entraron simultáneamente en la espera SOAP simulada. También se comprobó liberación del bloqueo después de una excepción anidada.

El archivo auxiliar está junto a SQLite (`database.sqlite.transaction.lock`) y requiere permisos de escritura. Todos los workers deben usar el mismo archivo y filesystem local con bloqueo de archivos; no borrar/reemplazar ese archivo mientras hay procesos activos. Esto no habilita SQLite compartido entre hosts ni sustituye restricciones SQL, leases, pruebas de contenedor o un respaldo consistente. Escritores externos que no participen en la coordinación requieren revisión antes de operar concurrentemente.

### Límites conservadores

Token y validación de empresa se ejecutan antes del rate limiter nombrado. Se utilizan claves de empresa y una clave global del servicio, evitando depender de la IP de salida de Functions.

| Variable | Valor inicial | Finalidad |
| --- | ---: | --- |
| `PHP_FPM_MAX_CHILDREN` | 2 | Concurrencia máxima del pool |
| `API_FACT_TENANT_REQUESTS_PER_MINUTE` | 60 | Presupuesto por empresa |
| `API_FACT_GLOBAL_REQUESTS_PER_MINUTE` | 60 | Presupuesto agregado del servicio |

El límite global sigue siendo 60. Separar claves no elimina un 429 cuando se agota ese presupuesto compartido. La prueba configura presupuestos pequeños para verificar independencia de empresas, límite global, `Retry-After` y exclusión de solicitudes inválidas. No se aumentó el límite publicado ni se determinó una capacidad segura para Render. El rate limiter usa el cache store configurado; no es un techo facturable ni una garantía distribuida entre servicios.

El cambio sigue el esquema de [despliegue Nginx de Laravel](https://laravel.com/docs/12.x/deployment), la [configuración del pool FPM](https://www.php.net/manual/en/install.fpm.configuration.php) y los [límites nombrados de Laravel](https://laravel.com/docs/12.x/routing#rate-limiting).

## Validación realizada

| Verificación | Resultado |
| --- | --- |
| `npm run test`, Functions | Build y 35 pruebas aprobadas |
| Catálogo, rendimiento frontend, índices, payload fiscal y seguridad frontend | 30 pruebas aprobadas |
| `php vendor/bin/phpunit` | 28 pruebas, 119 aserciones, incluidos procesos concurrentes y base temporal |
| Inventario, Auth/Firestore/Functions locales | 5 pruebas aprobadas: concurrencia, stock, presentaciones, precios, idempotencia, permisos y faltantes |
| Reglas Firestore/Storage locales | 15 pruebas aprobadas, incluida revalidación de metadata tras revocación |
| Typecheck, lint y build web/PWA | Correctos; avisos existentes de chunks grandes e importación mixta de `calendar-push` |
| Navegador: catálogos 50/500/5.000 | Tres escenarios aprobados con ráfagas, reconexión y recarga IndexedDB |
| Navegador: listados y fotos | Un escenario aprobado; SDK real, fotos con red simulada |
| Rutas Laravel y formato de archivos PHP nuevos | Correctos |
| `git diff --check` | Sin errores de whitespace |
| Imagen Docker, Nginx/FPM reales y carga HTTP | **Pendientes: Docker no disponible** |

Total sin contar repeticiones: **113 pruebas unitarias/de integración y cuatro escenarios de navegador**. Emuladores Standard; Functions usó Node 24 del equipo porque Node 22 solicitado no estaba disponible en el ejecutor. Esto no sustituye una prueba del runtime Node 22 publicado.

Tiempos iniciales observados en los escenarios de catálogo: 2.844 ms (50), 1.485 ms (500), 6.891 ms (5.000). Incluyen navegación/arranque y se midieron una vez; no son una comparación controlada contra la etapa anterior. Las ráfagas fueron 50, 500 y 500 cambios, respectivamente.

No se ejecutaron en esta etapa las suites completas de calendario y migración, cuyos flujos no cambiaron. Las pruebas nuevas de rendimiento frontend se incorporaron al runner de emuladores.

## Publicación y comprobaciones pendientes

1. Construir y probar la imagen en un entorno con Docker. Usar credenciales locales de prueba, SQLite vacío aislado y servicios SUNAT simulados. Verificar `/up`, rutas profundas, secretos no accesibles, arranque/parada, dos solicitudes concurrentes, conflictos SQL, memoria y actualización de configuración/certificados.
2. Medir SOAP, generación PDF, cola FPM y 429 para elegir concurrencia y presupuesto global; no subir workers o límites por deducción.
3. Resolver primero la persistencia de Render y el respaldo/restauración de la etapa 1. Cambiar el runtime implica redeploy y no corrige la pérdida de archivos en Render Free.
4. En una publicación autorizada, aplicar conjuntamente backend/frontend y los requisitos pendientes de las etapas anteriores. Los índices existentes cubren los dos listados nuevos; las exenciones de la etapa 2 aún requieren su publicación.
5. Observar escrituras IndexedDB por recuperación, repositorios inactivos, tiempo de búsqueda, propagación de metadatos, transferencias por página, bytes de fotos/metadata, errores SQL, memoria FPM y edad de pendientes SUNAT.

La configuración local y las pruebas están entregadas. La validación del contenedor y su publicación siguen pendientes; tampoco se resuelven por esta etapa la elegibilidad Vercel Hobby, persistencia Render ni contrato DNI registrados en la etapa 1.
