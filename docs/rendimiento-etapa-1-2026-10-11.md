# Etapa 1 — rendimiento, costos y continuidad

Fecha: 11 de octubre de 2026. Implementación local autorizada después de la auditoría.

## Estado

| Hallazgo | Resultado de esta etapa | Pendiente |
| --- | --- | --- |
| F03 — avisos de reposición vencidos | Corregido y probado localmente | Publicación de Functions y observación de la cola real |
| F04 — empresas excluidas del mantenimiento SUNAT | Corregido y probado localmente | Publicación de Functions y observación del cursor real |
| F19 — umbral DNI diferente entre servicios | Contrato revisado; incompatibilidad reproducida en pruebas | Definir y aprobar un contrato fiscal común antes de modificarlo |
| F01 — hosting comercial en Vercel Hobby | Restricción del plan verificada en documentación oficial | Selección del hosting apto para uso comercial y posterior despliegue |
| F02 — persistencia tributaria | Usuario confirma Render gratuito; rutas locales revisadas | Verificar configuración efectiva, respaldar datos y habilitar persistencia durable |

No se desplegaron servicios, cambiaron planes, ejecutaron migraciones de producción ni consultaron datos productivos. La etapa queda implementada en su parte de código; infraestructura y contrato fiscal conservan los pendientes indicados.

## F03: retirar avisos vencidos de la cola

Archivo: `functions/src/replenishment-notifications.ts`.

La transacción cambia un trabajo vencido de `pending` a `cancelled` y libera `leaseUntil`. Antes retornaba sin modificarlo, por lo que el scheduler volvía a encontrar el mismo trabajo cada cinco minutos. Un lote de 50 trabajos vencidos podía impedir el avance hacia trabajos posteriores.

Se conserva el estado `cancelled` ya existente. Un envío con lease activo conserva su reserva; un estado terminal no se modifica. El vencimiento se evalúa antes del backoff, sin consultar dispositivo, usuario ni solicitud. Para trabajos vigentes se mantienen autorización, destinatario, intentos, entrega y backoff.

Prueba del handler real con Firestore y FCM sustituidos en memoria: 50 trabajos vencidos producen 100 lecturas de documentos simuladas, 50 escrituras de cancelación y cero envíos. El siguiente ciclo entrega el trabajo vigente que estaba detrás; un tercer ciclo no recupera esos trabajos terminales.

Estimación de costo: sin la corrección, 50 documentos de consulta más 50 lecturas transaccionales, repetidos 288 veces al día, representan 28.800 lecturas diarias en ese escenario. Ahora esos trabajos se retiran una sola vez, con una escritura por trabajo. Continúan las invocaciones programadas y el mínimo facturable de las consultas vacías. Los contadores de la prueba no representan una medición de facturación ni incluyen reintentos internos de Firestore.

No hay eliminación automática ni cambio de TTL. Los trabajos vencidos existentes se retirarán gradualmente por el scheduler, en lotes de hasta 50, una vez publicada la corrección y cuando sean elegibles para la consulta de reintento.

## F04: rotación sobre todas las empresas

Archivo: `functions/src/tax.ts`.

La lista completa de empresas participa en `roundRobin`; el límite de 100 se aplica después de rotarla. El cursor se guarda respecto de la longitud completa y avanza por las empresas intentadas, incluso si una falla. Se mantienen el presupuesto temporal, la reserva de tiempo, los cinco documentos por llamada, los timeouts y la periodicidad del scheduler.

Pruebas del handler real con consultas y HTTP sustituidos en memoria:

- 250 empresas se recorren en tres ejecuciones de 100 llamadas: empresas 0–99, 100–199 y 200–249 seguidas de 0–49. Cursor final: 50.
- Al consumir el presupuesto, la siguiente ejecución continúa desde el cursor guardado.
- Una respuesta fallida no detiene la rotación de las demás empresas.
- Una lista vacía no llama a la API ni escribe un cursor inválido.

La corrección elimina la exclusión sistemática de las empresas posteriores a la número 100. No promete menor trabajo tributario: al atender empresas previamente omitidas pueden aumentar las llamadas útiles. El mantenimiento todavía comparte presupuesto con las colas anteriores; si estas lo agotan, esta sección no llega a ejecutarse. El crecimiento del documento global de empresas queda fuera de esta corrección puntual.

## F19: contrato DNI revisado, sin cambio de política

`functions/src/operations.ts` captura `company.minBoletaSinDni` en la venta. `functions/src/fiscal.ts` lo usa al construir el comprobante, pero el payload no lo transmite. `apps/api-fact/app/Services/Sunat/FiscalPayloadValidator.php` valida con `sunat.min_boleta_dni`, proveniente de `SUNAT_MIN_BOLETA_DNI` y con valor predeterminado 700.

| Caso sin DNI | Functions | Laravel |
| --- | --- | --- |
| S/699,99, umbral 700 en ambos | Acepta | Acepta |
| S/700, umbral 700 en ambos | Rechaza | Rechaza |
| S/800, venta con umbral 1.000 y API con 700 | Acepta | Rechaza |
| S/800, ambos con umbral 1.000 | Acepta | Acepta |

Las pruebas caracterizan el contrato actual y la discrepancia; no certifican que los valores de ejemplo sean una política tributaria válida. No se cambiaron umbrales, configuración ni payloads. La resolución requiere una fuente de autoridad común por empresa, tratamiento de ventas históricas y pruebas de compatibilidad e idempotencia. No basta con cambiar un valor global en Laravel, porque las empresas y ventas pueden tener configuraciones distintas.

## Infraestructura: evidencia y propuesta pendiente

El usuario confirma que Render es gratuito y que utiliza la dirección gratuita de Vercel. En la solicitud original indicó Vercel Hobby. La dirección `vercel.app` por sí sola no identifica el plan; no se inspeccionó el panel de facturación.

Vercel limita Hobby al uso personal no comercial. Para el uso comercial del POS, hace falta seleccionar un plan apto o trasladar el frontend. El repositorio ya contiene configuración SPA para Firebase Hosting en `firebase.json`, por lo que esa alternativa puede prepararse sin reescribir la aplicación. La elección, cuotas, dominios autorizados y publicación siguen pendientes. [Documentación oficial de Vercel Hobby](https://vercel.com/docs/plans/hobby).

Render Free no admite discos persistentes y sus archivos locales se pierden con redeploys, reinicios o suspensión por inactividad. Esto es incompatible con depender de SQLite y artefactos fiscales exclusivamente locales. [Limitaciones de Render Free](https://render.com/docs/free).

El Dockerfile usa por defecto SQLite en `/var/www/database/database.sqlite`; los artefactos y la configuración tributaria también usan el filesystem local. Los valores de entorno del servicio desplegado no se han inspeccionado, por lo que no se afirma que sus rutas efectivas sean exactamente esos defaults.

Configuración concreta propuesta si se conserva esta arquitectura en un servicio Render que admita disco persistente:

| Elemento | Valor propuesto |
| --- | --- |
| Ruta montada del disco | `/var/data/denzoz` |
| `DB_DATABASE` | `/var/data/denzoz/database.sqlite` |
| `SUNAT_STORAGE_ROOT` | `/var/data/denzoz/artifacts` |
| `SUNAT_CONFIG_DIR` | `/var/data/denzoz/config` |
| `SUNAT_CERT_PATH` | `/var/data/denzoz/config/certificate.pfx` |

`SunatConfigHelper` utiliza subdirectorios por empresa dentro de `SUNAT_CONFIG_DIR`; también deben conservarse. Solo se preservan los archivos ubicados dentro del montaje. Los discos requieren un servicio de pago y restringen el servicio a una instancia. [Discos persistentes de Render](https://render.com/docs/disks).

Antes de cambiar el plan, agregar un disco o redesplegar la API:

1. Inspeccionar las rutas efectivas sin exponer secretos y respaldar de forma consistente SQLite, artefactos, configuración y certificados existentes. Conservar `APP_KEY` y secretos por el canal seguro existente.
2. Aprobar el costo y destino de persistencia, y planificar la pausa necesaria para trasladar los datos. No apuntar simplemente a una base vacía.
3. Restaurar y comprobar recuentos e identidades de documentos y disponibilidad de XML/CDR/PDF/certificados, sin reenviar comprobantes.
4. En una ventana autorizada, verificar que los mismos datos sobreviven a un reinicio; probar por separado la recuperación del respaldo.

Estos pasos no se ejecutaron. La confirmación de Render Free hace que F02 siga siendo un pendiente crítico de infraestructura, aunque las optimizaciones de Functions estén listas localmente.

## Validación local

| Comando | Directorio | Resultado |
| --- | --- | --- |
| `npm run test` | `functions` | Build TypeScript correcto; 24 pruebas aprobadas, incluidas 7 nuevas del scheduler |
| `node --test tools/fiscal-payload.test.mjs` | raíz | 6 pruebas aprobadas, incluidas 2 nuevas de DNI |
| `php vendor/bin/phpunit` | `apps/api-fact` | 22 pruebas y 77 aserciones aprobadas, incluidas 2 nuevas de DNI |
| `git diff --check` | raíz | Sin errores de whitespace |

Total: 52 pruebas aprobadas. PHP se ejecutó con entorno `testing`, SQLite `:memory:`, caché y sesiones en memoria. `php artisan test` no está registrado en este proyecto; se usó el ejecutor PHPUnit declarado por Composer, sin agregar dependencias.

Las pruebas de scheduler invocan los handlers compilados y reemplazan Firebase/FCM/HTTP antes de cargar el código. Comprueban lógica, lotes y reservas, pero no equivalen a una prueba de índices, concurrencia distribuida o facturación en producción.

Después de una publicación autorizada, verificar en ejecuciones normales que disminuyan los trabajos vencidos en `pending`, avance el cursor más allá de 99 cuando haya suficientes empresas, no aumenten las entregas duplicadas y se mantengan los límites y tiempos esperados. No se requiere migrar documentos ni modificar índices para estas dos correcciones.
