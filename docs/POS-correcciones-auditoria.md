# Correcciones de la auditoría del POS

Fecha: 30 de septiembre de 2026. Alcance autorizado: hallazgos 2 en adelante. Los accesos demo del hallazgo 1 se conservaron.

## Reajuste posterior del stock

Por solicitud posterior, el stock separado de empaques se sustituyó por stock compartido en unidad base para todos los productos. Las presentaciones definen equivalencias y precios. La verificación y el alcance vigentes de ese reajuste se describen en [Stock compartido entre presentaciones](stock-compartido-presentaciones.md). El resto de este informe documenta las correcciones de la auditoría original.

## Cambios

| Hallazgo | Corrección |
|---|---|
| 2. Impresión | Ancho limitado a 58/80 mm tanto al generar HTML como en Firestore Rules. Campos opcionales de configuración acotados. Logos PNG/JPG/WEBP limitados a 200 KB para respetar el tamaño del documento. |
| 3. Escrituras directas | Catálogo, reservas de códigos, stocks, movimientos, cajas, cotizaciones y reposiciones se escriben mediante Functions. Se bloquearon las escrituras del cliente, incluso del administrador. |
| 4. Migraciones | Retiradas las dos rutas que inventaban empaques. La migración administrativa conserva el equivalente existente, pagina lecturas, valida duplicados y saldos, respalda antes de aplicar, usa precondiciones de versión y mantiene un bloqueo durante la aplicación. |
| 5. Precios | El precio base procede del catálogo vigente. El POS usa ese mismo precio al buscar, escanear y recuperar el carrito. |
| 6. Cobros repetidos | Identificador persistente por borrador; venta y solicitud con identidad estable por empresa/usuario. Una repetición devuelve la misma venta. Las respuestas perdidas se recuperan después de recargar. La cancelación de solicitudes que no llegaron al servidor impide que una llamada tardía cobre después. |
| 7. Caja y pago | Caja obligatoria para POS; apertura única mediante transacción; cierre en servidor, bloqueo de ventas durante el cierre y resumen persistido. Reimpresión del desglose real. Validación de montos, banco y tipo de documento antes de escribir stock. |
| 8. Recepción parcial | Estado `recibido` con cantidades recibidas/faltantes. Conciliación administrativa: devolución física al origen o merma en tránsito. La merma de tránsito no vuelve a descontar el origen. |
| Listas de mapas | Cotizaciones y reposiciones validan cada producto, presentación, cantidad y precio en Functions; nombres, precios y totales se reconstruyen del catálogo. Unidades personalizadas también se validan en servidor. |
| Privacidad | Carrito con versión, usuario y vencimiento de 24 horas; no persiste DNI/RUC/nombre del cliente. Limpieza del formato anterior. Fotos nuevas por empresa/tienda/autor, sin enlaces públicos en los documentos; lectura autenticada y MIME/tamaño acotados. |
| Consultas | DNI/RUC solo para admin/POS, con límite por usuario de 10/minuto y 100/día y caché de 30 días. |
| Lecturas y POS | Stock completo por páginas de 300, caché Dexie y sincronización incremental. Grilla de 60 productos por bloque y categorías reales. Disponibilidad base compartida para incluir apertura automática de empaques. El cambio de tienda reinicia el flujo y recupera el borrador de esa tienda. |
| Kardex | Fechas en hora de Perú, páginas con cursor de documento, exportación del rango completo y protección contra fórmulas CSV. El corte de exportación usa el último movimiento del servidor. |
| Integridad adicional | Factores e identidades de presentaciones existentes se conservan para no reinterpretar stock/transferencias. Las mermas no pueden aumentar stock. Cantidades corruptas y empaques desconocidos provocan un error de conciliación. Leer la configuración dejó de borrar credenciales heredadas. |

## Validación

- Functions: build y 7 pruebas del modelo de stock.
- Emuladores: 4 escenarios de inventario/cobro, 1 de migración de stock, 11 de Firestore/Storage Rules.
- Pruebas de impresión/CSV/disponibilidad: 3. Payload tributario: 3.
- Web: lint, typecheck y build de producción.
- Prueba de navegador: catálogo de 305 productos, precio vigente, apertura de caja, privacidad del borrador y recuperación de una venta tras perder la respuesta y recargar.

La suite reproduce concurrencia en envíos, cancelaciones, recepciones, aperturas, cobros y conciliaciones. Comprueba que un cobro repetido descuenta stock una sola vez, que rechazar datos inválidos deja el stock intacto y que el cierre conserva pagos en efectivo y Yape por separado. Las solicitudes rechazadas definitivamente quedan canceladas en el servidor; corregir el borrador genera otro identificador y una llamada tardía no puede reactivar el anterior.

Tras la recuperación en navegador se verificaron los datos del emulador: una sola venta de S/ 7, un solo movimiento de venta y stock de 10 a 9.

Se detectó una prueba antigua que exigía rechazar fracciones base, mientras la implementación ya permitía tres decimales. Se corrigió esa expectativa conservando las pruebas que rechazan pasos de empaque inválidos.

Java 21 y Playwright se usaron desde carpetas temporales; no se instalaron globalmente. El emulador usó Node 24 del equipo; el despliegue de Functions sigue configurado para Node 20. Vite mantiene el aviso del chunk Firebase superior a 500 KB.

## Reproducción

Desde `functions`: `npm test`.

Desde `apps/web`: `npm run lint`, `npm run typecheck`, `npm run build`.

Desde la raíz, con Java 21 en PATH:

```powershell
npx firebase-tools emulators:exec --project demo-denzoz-ops --only auth,firestore,functions,storage "node tools/run-emulator-tests.mjs"
```

Las pruebas de reglas y Functions usan el mismo proyecto demo y se ejecutan secuencialmente: Storage Rules consulta los perfiles de ese proyecto. La suite limpia solamente los datos de los emuladores locales. No debe ejecutarse contra producción.

Para el navegador, preparar con `tools/seed-ui-emulator.mjs`, arrancar Vite con `VITE_USE_EMULATORS=1`, `VITE_FIREBASE_PROJECT_ID=demo-denzoz-ops` y bucket demo, y ejecutar `tools/pos-smoke.py` con Python/Playwright. El script verifica el proyecto demo antes de introducir datos.

## Aplicación pendiente al entorno real

1. Desplegar Functions, reglas, índices y web en una ventana coordinada; el cliente anterior carece del identificador de cobro y ya no podrá escribir cajas directamente. Actualizar las pestañas/PWA del POS.
2. Revisar el dry-run de `tools/migrate-presentation-stock.mjs` con proyecto y tenant explícitos. Aplicar solo con operación detenida y `--apply --maintenance-confirmed`. Si una aplicación falla, el bloqueo permanece: conservar el respaldo, conciliar el motivo y reanudar con `--resume-maintenance`. Los stocks heredados ambiguos requieren conteo físico; no se pueden deducir empaques a partir de un total de unidades.
3. Para fotos antiguas: revisar el dry-run de `tools/migrate-incident-photos.mjs` y aplicar con `--apply` para copiar a la ruta privada, revocar tokens antiguos y reemplazar `photoUrl` por `photoPath`. No se ejecutó esta migración contra la nube; las URLs ya distribuidas siguen siendo un pendiente real hasta revocar sus tokens. Configurar el CORS del bucket para lectura autenticada desde los dominios publicados; `tools/storage-cors.json` contiene los dominios Firebase actuales y debe ampliarse si se usa un dominio propio.
4. Los cierres antiguos sin desglose no se reimprimen con cifras inventadas. Requieren reconstrucción y conciliación administrativa si se necesita un nuevo documento verificable. Las transferencias antiguas recibidas con faltantes pueden conciliarse desde su tarjeta.

No se desplegó, no se ejecutaron migraciones sobre datos reales y no se enviaron cambios a GitHub. La edición Standard de Firestore se confirmó con una consulta de configuración de solo lectura.

## Evaluación de las reglas

```json
{
  "score": 4,
  "scope": "Reglas y escenarios locales, excluyendo accesos demo",
  "verified": ["aislamiento entre empresas", "perfiles privados", "inventario solo servidor", "cajas solo servidor", "rechazo de esquemas críticos desde cliente", "protección de ancho de ticket", "fotos por tienda y autor"],
  "pending": ["despliegue e índices reales", "revocación de URLs antiguas", "revisión con datos heredados y usuarios reales"]
}
```

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for tenant isolation, bounded document schemas, and server-only inventory writes. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

Las librerías de servidor omiten Firestore Rules; por eso cada Function vuelve a validar permisos y entradas. [Documentación oficial de Firebase](https://firebase.google.com/docs/firestore/security/rules-fields).
