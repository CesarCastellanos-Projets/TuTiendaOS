# Calendario compartido y mejoras del POS

Implementación local del 30 de septiembre de 2026. No se publicaron cambios ni se enviaron a GitHub.

## POS y stock

- La tarjeta completa selecciona el producto. Varias presentaciones abren una ventana; una sola se agrega directamente.
- La ventana muestra precios, factores, fracciones permitidas y la cantidad que se agregará. Considera el saldo común y la demanda de todas las líneas del carrito. Presentaciones sin precio o saldo suficiente quedan deshabilitadas.
- Con 950 hojas se puede agregar 0,5 millar, si está habilitado, consumir 500 hojas y cobrar medio precio de millar.
- Los códigos exactos del lector o cámara seleccionan su presentación sin abrir la ventana. Las lecturas se procesan en orden. Se conserva la identificación exacta por código e ID, incluidos IDs heredados.
- La reposición nueva pide una cantidad total en unidades base por producto. Los documentos anteriores mantienen sus factores y presentaciones; no se reinterpretan sus cantidades.
- La captura de teclado funciona en la pantalla de ventas, con la app activa. Respeta campos de cantidad, precio, cliente, pago, ventanas y cobros pendientes. El lector debe actuar como teclado y finalizar con Enter. Se distingue una secuencia rápida y se comprueba el código; escribir rápido un nombre conserva sus letras.
- Flechas seleccionan sugerencias, Enter confirma y Escape limpia o cierra. Las ventanas mantienen el foco y lo devuelven al cerrar.
- La búsqueda local normaliza tildes, mayúsculas y espacios, admite palabras en diferente orden, letras omitidas y transpuestas. Prioriza códigos exactos. No corrige códigos por similitud. El índice se comparte con consulta y cotizaciones del trabajador; la reposición también utiliza coincidencias aproximadas. No agrega lecturas de Firestore por tecla.

## Calendario

- Rutas `/admin/calendario` y `/pos/calendario`, con componentes por rol y una vista compartida.
- Eventos comunes para toda la empresa; acceso para admin y POS autorizados. Los trabajadores y POS sin permiso no pueden leerlos ni modificarlos.
- Permiso `canManageCalendar`, independiente de cambiar precios o elegir tienda. Se configura al crear POS y se puede activar o retirar desde Usuarios. Los POS multi-tienda anteriores conservan acceso cuando el campo aún no existe; `false` lo revoca.
- La sesión escucha cambios del perfil: retirar el permiso bloquea el calendario abierto. Servidor y reglas consultan el perfil vigente; claims antiguos no conceden acceso.
- Pagos, tareas, vencimientos y otros; título, descripción, fecha, hora opcional, estados y repetición diaria, semanal o mensual.
- Fechas en horario de Perú. Sin hora se usan las 9:00 a. m. para los avisos. La repetición mensual conserva el día original: 31 de enero → último día de febrero → 31 de marzo.
- Completar una repetición programa la próxima fecha futura. Para detener la serie, editar y cambiar a completado o cancelado.
- Cambios con versión para impedir sobrescrituras entre usuarios. Reintentar una creación, edición o finalización confirmada no duplica la operación.
- Consultas por mes y páginas de 50 eventos; bandeja con los últimos 50 avisos vigentes. Los indicadores del mes se calculan sobre los eventos cargados; hay que cargar más cuando se supera esa cantidad.

## Recordatorios

- Avisos configurables entre 0 y 30 días antes, hasta seis plazos. Los vencidos pendientes recuerdan una vez al día.
- `sendCalendarReminders` se ejecuta cada cinco minutos en el servidor. Selecciona lotes de hasta 100 eventos y entregas, y pagina los destinatarios por empresa.
- Cada usuario tiene su propia bandeja. Leer o posponer un aviso no completa el evento para los demás. Posponer recuerda en una hora.
- Identificadores deterministas, transacciones y reservas temporales controlan ejecuciones concurrentes. Editar, completar o cancelar invalida los avisos anteriores; el envío vuelve a comprobar evento, versión, usuario activo y permiso.
- Push con Firebase Cloud Messaging y el mismo service worker de la PWA. Se conservan precache, navegación offline y caché de fuentes. Hosting excluye el worker del caché inmutable de archivos con hash.
- El aviso del sistema operativo es genérico; los detalles se leen tras autenticarse. Pulsarlo abre el calendario, conservando el destino al pasar por el inicio de sesión.
- Máximo cinco dispositivos por usuario; registro renovado al entrar y cada doce horas con la app abierta. Expira tras 180 días sin renovación; se retiran tokens inválidos. Cerrar sesión intenta retirar el registro y elimina la suscripción local.
- Reintentos limitados para fallas transitorias. El transporte push no permite prometer entrega exacta ni recepción si el sistema operativo o navegador la impide. La bandeja interna conserva los avisos.

## Activación en el proyecto real: pendiente

1. Obtener o generar la clave **pública** Web Push del proyecto Firebase, en Configuración → Cloud Messaging → certificados Web Push. Colocarla en `VITE_FIREBASE_VAPID_KEY` del entorno web y reconstruir.
2. Publicar hosting, Functions, reglas e índices del proyecto correcto. Esperar a que los índices de grupos de colecciones estén listos antes de activar las Functions programadas.
3. Confirmar que el proyecto tenga habilitada Cloud Scheduler y facturación compatible con las Functions programadas. Esta implementación no cambió la facturación ni creó recursos reales.
4. Permitir notificaciones desde el calendario en cada dispositivo, con HTTPS. Si falta configuración, la interfaz lo comunica; no confirma una activación inexistente.
5. Verificar una entrega real FCM con la app cerrada, una edición que invalide un aviso y la revocación del POS autorizado. La prueba sintética local no reemplaza esta comprobación.
6. Configurar TTL sobre `notifications.expiresAt` si se desea eliminar automáticamente los avisos después de 90 días. El campo está preparado; la política real no se habilitó desde este trabajo.

Referencias: [FCM para web](https://firebase.google.com/docs/cloud-messaging/web/get-started), [Functions programadas](https://firebase.google.com/docs/functions/schedule-functions), [headers de Hosting](https://firebase.google.com/docs/hosting/full-config#headers).

## Verificación realizada

44 pruebas automatizadas pasan:

| Grupo | Pruebas |
|---|---:|
| Functions: stock y calendario | 14 |
| Operaciones con emuladores | 5 |
| Calendario con emuladores | 1 |
| Migración con emuladores | 1 |
| Firestore y Storage Rules | 13 |
| Frontend: búsqueda, selector, stock, impresión y CSV | 6 |
| Payload fiscal | 4 |

También pasan lint, typecheck y build web, y build de Functions.

Tres recorridos de navegador verifican:

- Venta y recuperación de respuesta perdida; 1050 → 950 → 450 hojas vendiendo medio millar; consultas y cotizaciones del trabajador.
- Selector, captura desde el primer carácter, lector sobre un filtro anterior, escritura rápida de nombres, protección de otros formularios, calendario compartido, lectura y posposición de avisos, revocación con sesión abierta y anchos de 320 a 1600 píxeles.
- Worker construido, navegación offline, destino de calendario tras login y notificación **push sintética** con las ventanas de la app cerradas.

Los emuladores no envían FCM real. La rutina programada se ejecutó directamente contra ellos. Usaron Node 24 del equipo; el despliegue del proyecto sigue configurado para Node 20. El build mantiene la advertencia previa de tamaño del chunk de Firebase y una advertencia informativa sobre importación compartida del módulo de push.

## Revisión de reglas añadidas

Las colecciones nuevas son de escritura exclusiva del servidor. Los eventos exigen empresa y permiso; cada bandeja exige además propietario. Tokens y entregas internas no son accesibles al cliente. Los esquemas se validan en Functions antes de usar Admin SDK; el permiso nuevo del perfil está acotado a boolean y no puede autoasignarse.

```json
{
  "score": 5,
  "summary": "Las reglas nuevas del calendario cumplen aislamiento por empresa, autorización vigente, bandejas privadas y escrituras de servidor. Verificadas con pruebas adversarias en emuladores; el alcance es el calendario y el campo de permiso añadido.",
  "findings": []
}
```

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for tenant isolation, current calendar permissions, private notification inboxes, and server-only writes. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
