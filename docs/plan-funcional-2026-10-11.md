# Plan de mejoras funcionales — D’ENZOZ

Fecha: 11 de octubre de 2026. Estado: implementado localmente; validaciones y comportamiento final en [implementacion-funcional-2026-10-11.md](implementacion-funcional-2026-10-11.md). Publicación pendiente.

## Alcance y decisiones confirmadas

Siete etapas, con pruebas al terminar cada una. Se conservarán los cambios locales de rendimiento y calendario ya realizados. No hace falta contratar otro servicio para este alcance.

- Solo los cambios de precio del catálogo avisarán a trabajadores y POS de la misma empresa. Los ajustes de precio de una venta individual no generarán estos avisos.
- Campanita y avisos dentro del sistema. No se añadirán avisos de precios con la app cerrada.
- Avisos de precios: vigencia de cinco horas desde el cambio guardado por el servidor. Al vencer desaparecen de la interfaz; se borran físicamente mediante mantenimiento por lotes.
- Cotizaciones: treinta días desde su creación. Vendidas y eliminadas manualmente desaparecen de ambas vistas al confirmar la operación.
- Horarios: por usuario y días de la semana, zona America/Lima. Administradores sin restricción. Alcance confirmado por el usuario.
- Costos y proveedor: opcionales, editados por admin y consultados por admin y POS con permiso explícito. Trabajador y POS normal no reciben esos datos.
- Para ventas locales habituales, la factura conserva RUC y razón social obligatorios. Boleta sin documento y nota interna admitirán nombre cuando corresponda.

## Hallazgos del código actual

1. `Users.tsx` envía `storeId: null` al crear admin o POS multi-tienda. `createUser` llama a `requireAdmin`, que pasa por `requireActiveProfile`. Este último interpreta ese campo como tienda de operación y rechaza cualquier valor distinto de una cadena válida. Es la causa encontrada del error «Tienda inválida»; habrá que comprobar también la versión publicada.
2. El POS multi-tienda puede cambiar precios de la venta en curso. No modifica el catálogo. Son dos operaciones distintas para los avisos.
3. `createSaleRecord` ya marca la cotización como `facturada`, dentro de la misma transacción de venta. La lista del POS filtra pendientes; el historial del trabajador todavía incluye todos los estados.
4. Existe consulta de otras ubicaciones en cotizaciones del trabajador. Se aprovechará su lógica de disponibilidad para el POS, manteniendo separados los flujos por rol.
5. `discardQuotation` actualmente cambia el estado a descartada, no borra el documento. Además, los recibos de idempotencia de cotizaciones contienen una copia del resultado: la retención debe contemplar esa copia para no conservar innecesariamente los datos del cliente.

## Etapa 1 — Usuarios y permisos

- Corregir la creación de admin y POS multi-tienda, distinguiendo la tienda del usuario que se crea de la tienda de una operación. No relajar la validación de ventas, inventario o transferencias.
- Mantener POS fijo y POS multi-tienda; exponer de forma clara los permisos para ajustar precios de venta, calendario y consultar costos. Consultar costos no otorgará permiso para cambiar precios del catálogo.
- Añadir acciones «Cambiar contraseña», «Desactivar» y «Eliminar cuenta» en Usuarios. El administrador podrá establecer una nueva contraseña sin conocer la anterior; cada usuario podrá cambiar la propia con reautenticación.
- Usar Firebase Auth desde servidor para las acciones administrativas; revocar sesiones tras cambios sensibles. No guardar ni registrar contraseñas en Firestore.
- Eliminar el acceso de la cuenta sin borrar sus ventas, movimientos, cajas ni comprobantes. Conservar identificadores históricos mínimos cuando sean necesarios. Proteger al último administrador y bloquear eliminación de usuarios con caja abierta hasta resolverla.
- Resolver de forma explícita el caso de recrear un correo eliminado: los UID actuales derivan del correo; no debe reactivarse accidentalmente una identidad antigua ni reutilizarse su permiso o recibo de operación.

Validación: creación real en emuladores de POS fijo/multi-tienda y admin, rechazo de permisos desde otra empresa, cambio de contraseña, sesión antigua bloqueada, eliminación reintentable y conservación de registros históricos.

## Etapa 2 — Horarios de acceso con control del servidor

- Formulario en Usuarios para días y rangos horarios; opción «Sin restricción». Contemplar rangos que crucen medianoche.
- Definir el final de rango por minuto: si se configura 08:00–10:05, se permite hasta 10:05:59 y se bloquea desde 10:06:00, hora de Perú.
- Validación en Functions y en reglas de Firestore/Storage usando tiempo del servidor. Aplicar también en las comprobaciones de perfil dentro de transacciones. La hora del dispositivo solo podrá afectar una indicación visual.
- La aplicación mostrará «Fuera de tu horario de acceso», detendrá listeners y ocultará las vistas operativas al vencer la autorización. Revalidará al volver a primer plano y exigirá conexión para autorizar acceso por horario.
- Mantener una vía mínima para consultar el estado de acceso y cerrar sesión. Las tareas automáticas de SUNAT, recuperación y limpieza seguirán funcionando.
- Conservar cobros ya confirmados y solicitudes pendientes de recuperación. El corte horario no debe borrar un carrito ni una operación de cobro de resultado desconocido.
- Límite: el servidor puede impedir nuevas lecturas y operaciones; no puede recuperar información que alguien ya descargó o capturó. Los datos privados de compras no se incluirán en el caché general.

Validación: antes/durante/después del rango, manipulación de fecha y zona del equipo, peticiones directas, pestaña en segundo plano, desconexión, turno nocturno y cambio de horario con sesión abierta.

## Etapa 3 — Productos: información avanzada de compra

- Sección plegable «Avanzado» al crear y editar un producto como admin.
- Campos opcionales: costo de compra, presentación a la que corresponde ese costo y proveedor. Ejemplo: S/120 por docena equivale a S/10 por unidad; la pantalla debe indicar ambas cantidades sin confundir compra y venta.
- Guardar en documento privado independiente del catálogo compartido. Las reglas de Firestore no ocultan campos individuales dentro de un documento que el usuario puede leer.
- Admin escribe; admin y POS autorizado consultan bajo demanda. POS normal y trabajador reciben rechazo incluso mediante peticiones directas.
- No cambiar stock ni crear automáticamente movimientos de compra: este detalle es información comercial, no un módulo de compras o valoración contable.

Validación: guardado junto con producto, documentos privados inaccesibles a roles no autorizados, ausencia en IndexedDB general, PDF de cotización y comprobantes; retiro de permiso con sesión abierta.

## Etapa 4 — Avisos de cambios de precios

- Una campanita para notificaciones del sistema, con sección de precios accesible a todo POS y trabajador. Calendario sigue dependiendo de su permiso, aunque se comparta la campanita del POS.
- Un aviso por actualización guardada, con producto y presentaciones modificadas. Mostrar precio anterior y nuevo, por ejemplo: «Cuaderno: unidad S/4.50 → S/5.00; docena S/48.00 → S/54.00».
- Crear el aviso de forma idempotente en la operación de guardado del catálogo. Cambiar descripción, costo o proveedor no generará un aviso de precio. Crear un producto tampoco se considerará un cambio de precio existente.
- Preferir un aviso compartido por empresa en vez de copiar cada cambio a todos sus usuarios. Paginar el feed; registrar lectura local por usuario/dispositivo si no se necesita sincronizarla entre dispositivos.
- Cinco horas de vigencia calculadas por servidor. No extenderlas al abrir o marcar leído. Nunca incluir costo o proveedor en el aviso.
- Reutilizar mantenimiento programado para borrar avisos vencidos en lotes limitados, con reintentos y presupuesto de tiempo. La desaparición de la interfaz ocurre al vencer; el borrado físico será en una ejecución posterior, con objetivo de la siguiente pasada de cinco minutos si hay capacidad.
- Los avisos de precios serán internos; no requieren ampliar el registro de dispositivos ni los permisos de notificaciones externas de calendario y reposiciones.

Validación: cambio de unidad y varias presentaciones, precios sin modificación, reintentos, dos empresas, usuario sin calendario, vencimiento, borrado sin la app abierta y retiro de permisos.

## Etapa 5 — POS: localizar productos agotados

- Los productos agotados seguirán sin poder añadirse al carrito; su tarjeta permitirá abrir «Ver stock en otras ubicaciones».
- Mostrar tiendas y almacenes, nombre, disponibilidad real y presentaciones. Distinguir unidades disponibles de cajas cerradas; no confundir stock total con la cantidad vendible en una presentación.
- Consultar únicamente el producto elegido, con paginación y nombres de ubicación ya denormalizados. No leer inventario de todos los productos al abrir la pantalla.
- Mostrar «Sin stock en ninguna ubicación» solo tras completar la consulta; un error o una página parcial debe indicarse como tal.
- Consulta informativa: no concede venta desde otra tienda ni transferencia automática.

Validación: tienda agotada con stock en almacén, varias tiendas, cajas cerradas, cero global, error de conexión y paginación sin falsos mensajes de agotado.

## Etapa 6 — Cotizaciones: búsqueda, venta y retención

- Buscador tanto en historial de trabajador como en la ventana del POS: nombre del cliente, teléfono y código COT. Normalizar mayúsculas/tildes para nombres y dígitos para teléfonos; permitir código completo y búsqueda por su número identificable.
- Búsqueda con índices y páginas acotadas; debe encontrar resultados fuera de la primera página. No descargar todas las cotizaciones para filtrar localmente. Definir búsqueda por comienzo de palabras/datos, sin contratar un motor externo.
- Ambas vistas operativas mostrarán cotizaciones pendientes y vigentes. Al confirmar la venta se ocultan en ambas; cargar al carrito no las elimina.
- Mantener la transición de venta dentro de la transacción existente. Dos POS no podrán vender la misma cotización; si el cobro falla, seguirá pendiente.
- Añadir fecha límite de treinta días desde creación, validada también al cobrar una cotización cargada previamente. Mostrar su vencimiento. Editarla no reinicia automáticamente el plazo.
- Botón «Eliminar cotización»: autor o admin, con confirmación dentro de la aplicación. El borrado debe competir de forma segura con una venta y rechazar la eliminación de una cotización ya vendida.
- Al cumplirse treinta días se elimina físicamente la cotización por lotes. Una cotización vendida queda oculta inmediatamente y conserva su referencia mínima hasta su limpieza; la venta mantiene los datos que necesita.
- Minimizar o depurar las copias de cotizaciones guardadas en recibos de idempotencia al vencer/eliminar, conservando una marca mínima que impida recrearlas por reintento. No aplicar expiración global a los recibos de ventas o inventario.
- Para documentos antiguos, derivar vencimiento de `createdAt` y preparar migración paginada. Antes de borrar físicamente el histórico, producir una lista de alcance para revisión.

Validación: nombre con tildes, teléfono y COT fuera de la primera página; venta visible al trabajador en otra sesión, venta concurrente, eliminación concurrente con cobro, cotización abierta cuando vence y reintento tras borrado sin resurrección.

## Etapa 7 — Identificación del cliente y cierre de integración

- Boleta: agregar campo «Nombre del cliente (opcional)» independiente del DNI. Mantener la validación vigente del sistema para el umbral configurado, actualmente S/700.
- Factura de venta local habitual: RUC y razón social obligatorios. Permitir ingreso manual de razón social cuando falla la búsqueda externa; el nombre no sustituye al RUC.
- Para quien necesita solo un documento con nombre y sin RUC, ofrecer boleta cuando corresponda o nota de venta claramente identificada como comprobante interno. No presentar esta última como factura electrónica válida.
- Propagar el nombre correctamente a venta, impresión, cotización cargada y payload fiscal; no inventar DNI/RUC ni cambiar la política de fallo suave de SUNAT.
- Verificación final de roles, sesiones, alertas, cotización → venta, descuentos, stock, comprobantes y vistas móviles. Ejecutar typecheck, lint y builds web/Functions y pruebas relevantes de Laravel si cambia el payload.
- Publicar posteriormente en orden: backend compatible, reglas/índices necesarios y frontend. Incluir los cambios previos del calendario según el alcance que se decida publicar. Este plan no realiza despliegues.

## Retención y fuentes verificadas

La expiración visible y el borrado físico son procesos distintos. Firebase TTL normalmente borra dentro de las veinticuatro horas siguientes al vencimiento y sus borrados se cobran como operaciones de eliminación. Para acercar la limpieza de avisos a las cinco horas, la propuesta usa mantenimiento periódico acotado; no promete borrado físico al segundo exacto ni ahorro neto garantizado.

- [Firebase: retención con TTL](https://firebase.google.com/docs/firestore/ttl).
- [Firebase: tiempo de solicitud del servidor en reglas](https://firebase.google.com/docs/reference/rules/rules.firestore.Request).
- [SUNAT: tipos de comprobantes y factura a adquirente con RUC](https://cpe.sunat.gob.pe/informacion_general/tipos_comprobantes_pago).
- [SUNAT: boleta de venta electrónica e identificación del adquirente](https://cpe.sunat.gob.pe/tipos_de_comprobantes/boleta).

Las siete etapas se implementaron localmente. Las decisiones finales de busqueda acotada, retencion antigua y publicacion estan documentadas en el informe de implementacion. No se cambiaron datos de produccion.
