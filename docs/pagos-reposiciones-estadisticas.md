# Pagos combinados, reposiciones y estadísticas

## Uso

- POS: activar **Combinar métodos de pago**, indicar el importe aplicado de cada método y completar el saldo restante. El efectivo recibido puede ser mayor que su parte; únicamente esa diferencia produce vuelto. La suma aplicada debe cubrir exactamente la venta. Los pagos digitales se registran después de que el cajero comprueba el abono.
- Caja, cierre Z, historial, ticket y exportación de comprobantes conservan el desglose. Las cajas nuevas acumulan sus importes dentro de la transacción de venta; las cajas antiguas usan una consulta paginada como respaldo.
- Admin y POS multitiendas: **Reposiciones pendientes** muestra solicitudes de la empresa en tiempo real. **Atender con transferencia** descuenta del almacén central y crea un traslado pendiente. La tienda destino recibe las cantidades como antes. Dos aprobaciones simultáneas producen un solo traslado.
- Admin: **Estadísticas** permite periodos diarios, semanales, mensuales y anuales y hasta diez tiendas por consulta. POS: **Estadísticas de hoy** consulta únicamente la tienda activa. En multitiendas, cambiar la tienda actualiza ese resumen.
- Las horas muestran comprobantes emitidos, no personas que ingresaron al local. El ranking ordena por frecuencia de ventas que contienen el producto, con desempate por importe; muestra también unidades equivalentes e ingresos. Los productos del catálogo sin ventas aparecen separados y pueden no haber estado disponibles en esa tienda.
- Las anulaciones fiscales aceptadas descuentan el resumen de ventas una sola vez. Un cierre de caja ya iniciado conserva su fotografía de ingresos al cierre.

## Historial y actualización

Las ventas nuevas generan resúmenes automáticamente. El administrador integra las anteriores desde **Integrar siguientes 100 ventas anteriores**, repitiendo hasta completar el historial. Una reserva temporal evita ejecutar dos bloques simultáneos; reintentar un bloque no duplica cifras. Hasta entonces la pantalla avisa que la cobertura es parcial.

Las estadísticas se guardan en IndexedDB durante cinco minutos para periodos que incluyen hoy y 24 horas para periodos anteriores. **Actualizar** fuerza una consulta; sin conexión se puede consultar un periodo ya guardado. No existe una consulta periódica de todas las ventas. La hora y los días se calculan en la zona de Perú.

## Consumo de Firestore

Los resúmenes se guardan por tienda y mes. Los productos se reparten en 32 documentos por mes, con los días dentro del documento y sin índices sobre los mapas grandes. Una venta actualiza el resumen mensual, los grupos que contienen sus productos y el contador de su caja, en la misma transacción que la venta.

Si una venta toca `b` grupos de productos, las estadísticas agregan `1 + b` lecturas y escrituras; el contador de caja añade una escritura. Con un solo grupo son dos lecturas y tres escrituras adicionales, antes de considerar reintentos por concurrencia. Los documentos de resumen tienen un límite preventivo de tamaño; si se alcanza, será necesario ampliar la partición.

Una consulta de una tienda y un mes lee un resumen mensual y hasta 32 grupos de productos, más perfil, tienda y cobertura. Una consulta de diez tiendas y trece meses puede leer hasta 4290 documentos de resumen, más esas verificaciones. Los periodos máximos no deben refrescarse continuamente. La campana y la lista de reposiciones comparten una única suscripción de hasta 25 pendientes; las páginas adicionales se solicitan al pulsar **Cargar más**.

El límite gratuito depende del consumo de toda la aplicación: 50 000 lecturas y 20 000 escrituras diarias para la base elegible. No es posible garantizar quedar dentro sin conocer ventas, productos por venta, usuarios, reconexiones y consultas. Las cuotas de Functions y almacenamiento también se contabilizan por separado. Referencias: [precios](https://firebase.google.com/docs/firestore/pricing), [cuotas](https://firebase.google.com/docs/firestore/quotas), [agregación al escribir](https://firebase.google.com/docs/firestore/solutions/aggregation).

## Publicación

Publicar juntos el backend, las reglas y los índices antes de promover la nueva web a producción:

```powershell
npm --prefix functions run build
npx firebase-tools deploy --project denzozsaas --only functions,firestore:rules,firestore:indexes
npm --prefix apps/web run build
```

Después publicar la web en Vercel y comprobar que el dominio principal apunta al despliegue actualizado. Se conserva el mecanismo de recuperación de ventas y los documentos históricos siguen siendo compatibles.

Los avisos con la aplicación cerrada requieren `VITE_FIREBASE_VAPID_KEY` en el build publicado, HTTPS, service worker actualizado y permiso de notificaciones concedido. Reutilizan el registro de dispositivos del calendario; los usuarios que ya tenían ese registro deben abrir la nueva versión para registrar su permiso de reposiciones. El registro se renueva cada doce horas como máximo y admite hasta cinco dispositivos por usuario. Los envíos recorren los dispositivos en páginas de cien y comprueban que el perfil siga activo y pertenezca a la empresa. La recepción externa de FCM requiere comprobación en un dispositivo publicado; el emulador solo permite comprobar los avisos internos.

## Verificación local

- Compilación de Functions, build web, typecheck y lint. Pasan 15 pruebas existentes de Functions y 12 de seguridad frontend y comprobantes fiscales, además de las 14 de reglas.
- Simulación de pagos parciales efectivo/Yape con vuelto, pagos insuficientes, repetidos, exceso digital y decimales inválidos.
- Reintento de venta, ventas concurrentes, anulaciones repetidas, cierre de caja congelado y carga del historial sin duplicación.
- Restricciones de estadísticas para POS y aprobación concurrente por admin/multitiendas; revocación de acceso multitiendas.
- Las 14 pruebas existentes de reglas pasan. Comprobación adicional de lectura multitiendas con perfil y claim, aislamiento entre empresas y escrituras de aprobación y estadísticas exclusivas del servidor.
- Comprobación del POS en navegador: cobro combinado, vuelto, venta completada, estadísticas y ausencia de desbordamiento horizontal a 375 px.
- Comprobación simultánea en navegador de los avisos en admin y multitiendas, aprobación desde multitiendas, traslado pendiente en recepciones, filtros mensuales de varias tiendas, integración del historial y cambio de tienda en las estadísticas del POS.

No se enviaron ventas fiscales, mensajes a clientes ni cambios a producción durante estas verificaciones.

## Auditoría de las reglas modificadas

```json
{
  "score": 5,
  "summary": "Los cambios de reposición exigen empresa y perfil activo; el POS multitiendas requiere además un claim emitido por el servidor. Los pagos, inventario, aprobaciones y resúmenes permanecen escritos por Functions.",
  "findings": []
}
```

La puntuación describe las reglas modificadas y sus verificaciones locales; no constituye una auditoría integral de todos los servicios externos.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for tenant isolation, server-only financial and inventory writes, and verified replenishment approval permissions. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
