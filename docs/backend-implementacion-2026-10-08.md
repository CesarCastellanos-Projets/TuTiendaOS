# Backend: cambios y publicación coordinada

Implementación del plan de [auditoría](auditoria-backend-2026-10-08.md), 8 de octubre de 2026. Se conservaron los cambios anteriores del frontend. No se publicaron Functions, reglas, índices ni Laravel; tampoco se migraron datos de producción.

## Cambios por hallazgo

| Hallazgo | Implementación |
| --- | --- |
| A01, reintentos | Recibos de operación con huella del contenido y resultado recuperable. El cliente conserva comandos pendientes por usuario/empresa. Ingresos, ajustes y transferencias repetidos no duplican kardex. |
| A02, presentaciones | Se bloquean cambios de unidad base, factores, identidad y apertura incompatibles con existencias o documentos pendientes. La conversión física es explícita y registra movimiento. |
| A03, analítica | El cobro confirma venta, stock, correlativo y caja. Los agregados pesados se actualizan después mediante reconciliación idempotente, con recuperación y particiones divisibles. |
| A04, almacenes | El administrador puede recibir transferencias a almacenes. Se valida destino activo y cantidades recibidas, manteniendo el control de faltantes. |
| A05, ubicaciones | Guardado/archivo pasan por servidor. El archivo comprueba stock, usuarios, cajas, solicitudes, transferencias pendientes y faltantes sin resolver. Borrado directo denegado. |
| A06, cotizaciones | La venta y el cambio de cotización pendiente a facturada ocurren en la misma transacción. Otra venta no puede consumir la misma cotización. |
| A07, devolución y caja | La anulación conserva el efectivo físico recibido. El administrador registra por separado devolución de productos y reembolso total, con exclusión de duplicados, kardex y ajuste de caja. No se modifica una caja histórica cerrada. |
| A08–A09, sincronización | Repositorios compartidos por empresa/tienda, cursor de commit del servidor con nanosegundos, páginas de 300, ventana de cambios y recuperación paginada cuando se llena. IndexedDB conserva datos y cursor. Suscribirse mientras el repositorio está actualizado no descarga el catálogo nuevamente. |
| A10, escaneo | El catálogo en memoria resuelve primero el código. La recuperación por código ausente tiene enfriamiento para no consultar en cada tecla. |
| A11, disponibilidad | Las cajas cerradas conservan saldo propio; el equivalente total no se ofrece como saldo suelto. Se filtran inactivos y se recalculan borradores con stock y precios actuales. |
| A12, configuración | Un listener compartido de empresa, liberado después del periodo de gracia. Errores de acceso/red se informan y no se presentan como una empresa demo válida. |
| A13–A14, estadísticas | Panel alimentado por agregados mensuales; ranking etiquetado por unidades base, productos sin ventas identificados y límites de muestras visibles. Ventas anuladas se reconcilian. |
| A15, consultas costosas | Caché con caducidad, deduplicación de solicitudes simultáneas, límites de lecturas/particiones y frecuencia para consultas amplias. No se promete gasto cero. |
| A16, fechas/listas | Fechas comerciales en Lima. Paginación en comprobantes, ventas, transferencias, usuarios, incidencias, ubicaciones y cotizaciones; kardex conserva páginas anteriores al actualizar la primera. |
| A17, usuarios | Aprovisionamiento recuperable entre Auth/perfil/claims. Un reintento no reactiva a un usuario desactivado. Protección del último administrador activo. |
| A18, multitiendas | La tienda activa pertenece a la sesión del equipo; cambiarla no sobrescribe la tienda global del perfil. Las operaciones envían contexto y lo validan en servidor. |
| A19, abuso | App Check preparado, límites selectivos y revalidación transaccional de perfiles/permisos. Activación real de App Check requiere configuración y despliegue gradual. |
| A20, auditoría/reglas | Solicitudes de anulación solo por Function, con actor/fecha del servidor. Origen de incidencias inmutable y resolución abierta → resuelta por administrador. Consultas cliente requieren límite. |
| A21, reintentos fiscales | Conservación de estados, leases, backoff, límites de intentos y recuperación de documentos/resúmenes en procesamiento. Un fallo tributario no revierte una venta confirmada. |
| A22, resumen diario | Lotes estables de hasta 200 boletas, reclamados transaccionalmente. Cola por fecha, cierre de caja y recuperación programada; aceptación se propaga antes de cerrar el trabajo. |
| A23, Laravel | Laravel 12, secuencias con exclusión por empresa/tipo/serie, leases de envío/polling y recuperación de la boleta original consolidada para nota de crédito mediante su resumen aceptado. |
| A24, push | Trabajos duraderos por reposición/dispositivo, lease, reintentos y comprobación de usuario, permisos, dispositivo y solicitud vigentes antes de enviar. |
| A25, operación | Compresión de fotografías, migrador de metadatos con diagnóstico/bloqueo, índices versionados y este procedimiento de publicación/recuperación. Backups, restauración, retención y alertas requieren configurar la infraestructura real. |

## Comportamiento de stock

- 50 sueltos + 50 cajas cerradas de 30 = **1,550 equivalentes**, disponibles como 50 sueltos y 50 cajas. Vender unidades no abre esas cajas.
- Una presentación que comparte stock puede venderse fraccionada únicamente si su configuración lo permite; la cantidad equivalente debe respetar la unidad base. `UN` exige enteros.
- Con 950 hojas compartidas, 0.5 millar descuenta 500 y cobra medio precio de millar. Un millar completo no está disponible.
- Cotizar no reserva ni descuenta stock. El borrador sigue cambios del catálogo; cotización guardada y PDF son fotografías. Cobrar vuelve a validar saldo y precio.
- Un POS sin permiso de modificar precios recibe aviso si el precio cambió y debe revisar el nuevo total antes de cobrar. El servidor vuelve a verificarlo.
- En KG, LT y otras unidades medibles configuradas, una presentación abierta puede consumir fracciones de la unidad base con hasta tres decimales. Esto no habilita fracciones de `UN` ni de empaques cerrados.

## Verificación local

**Resultado final:** 60 pruebas JavaScript (17 unitarias de Functions y 43 de integración/reglas/utilidades/índices), 20 pruebas PHP con 73 aserciones y tres escenarios de caché en navegador pasan. Typecheck, lint y build web, y compilación de Functions pasan. Las auditorías de dependencias de producción npm/Composer reportan cero vulnerabilidades conocidas al momento de ejecutarse. Las suites se ejecutaron por grupos; los últimos ajustes de unidades medibles y presupuesto del scheduler se comprobaron con 17 unitarias y 21 pruebas adicionales. [Evidencia resumida](backend-validacion-2026-10-08.json).

Las pruebas usan exclusivamente `demo-denzoz-ops`, emuladores y servicios fiscales/push simulados. Ninguna prueba entrega FCM real ni envía documentos a SUNAT.

Comandos desde las carpetas indicadas:

```powershell
# functions, Node 22
npm test

# apps/web
npm run typecheck
npm run lint
npm run build

# apps/api-fact, PHP 8.2 con SQLite disponible
php vendor/bin/phpunit
php composer.phar audit --locked --no-dev

# raíz, con Auth/Firestore/Functions/Storage locales iniciados
node tools/run-emulator-tests.mjs

# raíz, Vite en 127.0.0.1:5188 con VITE_USE_EMULATORS=1
# Requiere Python Playwright y Edge instalado.
python tools/cache-browser.test.py
```

El runner configura los hosts de los emuladores. La prueba de navegador y el migrador también verifican explícitamente su destino. No ejecutar simultáneamente el runner que limpia la base demo y la prueba de navegador.

Iniciar los emuladores desde la raíz con `firebase emulators:start --project demo-denzoz-ops --only auth,firestore,functions,storage`. Para el Vite de prueba, establecer `VITE_USE_EMULATORS=1` y `VITE_FIREBASE_PROJECT_ID=demo-denzoz-ops`, y ejecutar desde `apps/web`: `npm run dev -- --host 127.0.0.1 --port 5188 --strictPort`. Usar una terminal de prueba separada para no conservar esas variables al generar el frontend publicado.

La prueba de navegador cubre 50/500/5,000 stocks, múltiples suscriptores, ráfagas de hasta 500 documentos con el mismo commit, desconexión/reconexión y recuperación desde IndexedDB después de recargar. Los tiempos locales incluyen carga inicial de módulos y emuladores: no son un p95 de producción ni una promesa de respuesta.

## Orden de publicación

Esta versión cambia contratos y reglas. No actualizar solamente las reglas mientras continúan clientes antiguos escribiendo directamente ubicaciones o solicitudes de anulación.

1. **Preparar una ventana de mantenimiento.** Confirmar ID de empresa, proyecto, volumen y versión de frontend. Cerrar operaciones en curso y evitar clientes antiguos durante la transición. Conservar versiones publicadas y lockfiles.
2. **Respaldar y comprobar restauración.** Exportar Firestore y respaldar SQL del microservicio. Registrar ubicación, fecha y verificación del respaldo; el argumento `--backup-uri` del script no prueba que el respaldo exista o sea restaurable.
3. **Laravel primero.** Instalar desde `composer.lock`, ejecutar `php artisan migrate --force`, limpiar/recrear cachés según el entorno y reiniciar workers si se usan. Comprobar conexión, configuración por empresa y autenticación entre Functions/API sin imprimir secretos. La migración agrega secuencias y leases; no recrea tablas comerciales.
4. **Índices.** Publicar `firestore.indexes.json` y esperar que los índices nuevos estén `READY`. La prueba estática comprueba presencia, no disponibilidad en nube; el emulador no reemplaza esa comprobación.
5. **Functions en Node 22.** Publicar las funciones nuevas y modificadas desde el lockfile. Mantener App Check sin enforcement hasta registrar/verificar clientes compatibles. Comprobar que los jobs programados estén habilitados.
6. **Metadatos por empresa.** Ejecutar diagnóstico, revisar y aplicar durante mantenimiento con respaldo. Las Functions nuevas respetan el bloqueo `meta/inventory_maintenance`. El script prepara cursores, índices auxiliares y colas; no cambia cantidades ni decide cómo abrir cajas antiguas.
7. **Reglas y frontend coordinados.** Publicar Firestore/Storage y frontend compatibles, recargar los clientes y verificar la versión activa del service worker. Comprobar dominio de producción de Vercel, no solo una URL de preview.
8. **Prueba operativa autorizada.** Ingreso, transferencia/recepción, venta, cotización, cierre, anulación/compensación, reposición y permisos temporales por rol. Usar productos y documentos de prueba identificables; comprobar kardex, caja y analítica.
9. **Medir una jornada.** Lecturas/escrituras, tiempos frío/caliente, contención, errores y profundidad de colas. Activar App Check gradualmente después de comprobar métricas de clientes legítimos.

Ejemplos de comandos de preparación, sustituyendo los valores indicados:

```powershell
firebase deploy --project denzozsaas --only firestore:indexes
firebase deploy --project denzozsaas --only functions

# Sin --apply: consulta y reporta diferencias; no modifica documentos.
node tools/prepare-backend-metadata.mjs --project denzozsaas --tenant ID_EMPRESA

# Solo después del respaldo y dentro de la ventana acordada.
node tools/prepare-backend-metadata.mjs --project denzozsaas --tenant ID_EMPRESA --apply --backup-uri gs://BUCKET/RUTA_EXPORTACION

firebase deploy --project denzozsaas --only "firestore:rules,storage"
```

No ejecutar una migración genérica de cantidades sobre datos ambiguos. Este preparador es distinto del migrador histórico de presentaciones.

### Recuperación y colas

- Si el preparador termina normalmente, libera su bloqueo. Si el proceso muere, revisar el documento de mantenimiento, los cambios parciales y el dueño antes de liberarlo manualmente. El script es repetible; conservar bloqueo mientras se resuelve la incidencia.
- Para errores de analítica, revisar `statisticsError`, `statisticsAttempts` y `statisticsPending`. La reconciliación aplica el estado actual de la venta, no un evento viejo. Tras corregir la causa, reactivar de forma controlada la cola con `statisticsPending: true` y `statisticsNextRetryAt: 0`; no sumar importes manualmente.
- Para errores fiscales, revisar estado del documento tanto en Laravel como en Firestore, identidad/ref, ticket y CDR. No generar otro correlativo ni otra referencia para reintentar la misma obligación. Los errores agotados requieren intervención; no reenviar documentos aceptados.
- Los resúmenes en procesamiento se consultan por su referencia estable. Si un resumen fue aceptado pero falló la propagación, aplicar su resultado a las boletas originales antes de marcarlo terminado.
- Para push, revisar trabajo, lease, intentos, permisos y token. Puede haber entrega repetida si el proveedor aceptó y se perdió la respuesta; el service worker usa etiqueta para reducir avisos repetidos. No se promete entrega exactamente una vez.
- Evitar rollback aislado del frontend: el cliente antiguo puede ser incompatible con reglas nuevas. Conservar la ventana de mantenimiento y restaurar versiones coordinadas. Restaurar datos solo después de revisar transacciones realizadas desde el respaldo.

## Costos, retención y pendientes reales

Se reducen recargas de catálogo, listeners duplicados y lecturas repetidas de estadísticas. Los agregados asíncronos añaden escrituras y jobs; la latencia y el costo total deben medirse con el volumen real. Un reporte anual amplio puede consumir miles de lecturas aun con caché. La cuota gratuita no se puede garantizar para cualquier cantidad de tiendas/ventas.

- Definir presupuesto y alertas para Firestore, Functions/Cloud Run, Storage, Scheduler, logs y host tributario. No habilitar instancias mínimas por defecto.
- Revisar colas agotadas, duración de trabajos y capacidad de los schedulers al crecer el número de empresas. La recuperación es acotada por ejecución.
- El scheduler tributario deja margen antes de su timeout y rota el cursor de empresas atendidas. Un backlog sostenido puede consumir el presupuesto antes de llegar a fases posteriores; monitorear la antigüedad de cada cola y separar/ampliar capacidad si el volumen lo exige.
- Los bloqueos SQL se probaron con SQLite local. Validar también concurrencia y planes de consulta en el motor SQL real antes de fijar objetivos de carga.
- Definir retención aprobada antes de borrar fotos, avisos, tokens y jobs. Los trabajos push incluyen vencimiento; no se activó TTL en producción. La compresión reduce tamaño, pero una interrupción aún puede dejar una foto huérfana. No borrar archivos solo por antigüedad sin comprobar referencias.
- Los recibos de operación sostienen la idempotencia. No aplicarles TTL o borrarlos junto con jobs de notificación: permitiría reutilizar una clave antigua y repetir una operación comercial.
- Activar y probar políticas de respaldo, protección contra borrado y, si se acepta su costo, PITR. No se modificó esa infraestructura desde esta tarea.
- App Check está preparado, aún no configurado/enforced en producción. Las marcas temporales de incidencias siguen siendo números del cliente; el actor y el origen están protegidos. Para auditoría temporal estricta, trasladar ese flujo a servidor.
- Verificar notificaciones con app cerrada en equipos reales y homologación tributaria en el entorno autorizado. Las simulaciones no certifican impresoras, navegador instalado, sistema operativo ni SUNAT.
- La compensación implementada es total y requiere venta anulada. Devoluciones/reembolsos parciales y una política de reversión de notas de venta sin documento fiscal necesitan un flujo definido. No se envían notas de crédito SUNAT para una nota de venta no fiscal.
- Reembolsos históricos anteriores al nuevo registro de efectivo requieren conciliación; no se presupone que el dinero haya salido de una caja cerrada.

La evaluación específica de reglas está en [backend-reglas-evaluacion-2026-10-08.json](backend-reglas-evaluacion-2026-10-08.json). Su puntuación no califica todo el sistema.
