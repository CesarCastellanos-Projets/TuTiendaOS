# Mejoras funcionales implementadas

Estado: siete etapas implementadas y verificadas localmente. No se publicó código, no se hicieron commits/push y no se modificaron datos reales. Se conservaron los cambios previos de rendimiento y calendario.

## Resultado

| Etapa | Comportamiento disponible |
|---|---|
| 1. Usuarios | Creación de POS multitienda sin tienda fija; permisos independientes para precios de venta, calendario y costos. Restablecer contraseñas, cambiar la propia con reautenticación y eliminar cuentas. |
| 2. Horarios | Días por usuario, hora de Perú, último minuto incluido y turnos nocturnos. Admin sin restricción. Comprobación en servidor, transacciones, Firestore, Storage y pantalla de bloqueo. |
| 3. Compras | Avanzado en productos: costo, presentación comprada y proveedor. Documento privado separado; consulta por admin y POS autorizado, a demanda. |
| 4. Avisos | Campanita compartida de precios/calendario en POS; precios para trabajador. Aviso con precios anteriores/nuevos de cada presentación, sin duplicarse al reintentar. Vigencia de cinco horas. |
| 5. Stock | Producto agotado abre tiendas/almacenes; muestra unidades disponibles y cajas cerradas por separado. Paginación por producto y tratamiento explícito de errores/conciliación pendiente. |
| 6. Cotizaciones | Buscadores en trabajador y POS por cliente, teléfono o código; listas de pendientes vigentes. Venta las retira de ambas vistas. Borrado manual del autor/admin, plazo de treinta días, edición con control de versión y sin renovar el vencimiento. |
| 7. Cliente | Nombre manual sin documento en boleta/nota cuando corresponde; factura conserva RUC y razón social. Si falla la búsqueda externa, se solicita razón social manual y no se inventa una. |

## Uso

- **Admin → Usuarios → Permisos y cuenta:** configurar horarios, permisos, restablecer contraseña o eliminar. La creación también permite escoger permisos del POS. Solo el administrador puede cambiar contraseñas mediante la función del sistema; su contraseña propia se cambia desde su fila con reautenticación. El menú de cuenta de todos los roles solo ofrece cerrar sesión.
- **Productos → Nuevo/Editar → Avanzado:** elegir presentación, costo y proveedor. Para conservar datos existentes sin modificarlos, no es necesario abrir Avanzado.
- **POS:** campanita para precios; pulsar el producto agotado para consultar otras ubicaciones; «Costo y proveedor» aparece con permiso.
- **Cotizaciones:** escribir en «Buscar cotización». Se revisan hasta 100 documentos por llamada dentro de la tienda, pendientes y recientes, utilizando su índice. Si el lote no contiene coincidencias y aún quedan registros, se indica usar Siguiente; no se presenta una búsqueda parcial como agotada. La interfaz recibe como máximo 20 coincidencias por página. Nombres sin distinción de tildes/mayúsculas y teléfonos comparados también por dígitos.
- **Admin → Cotizaciones:** revisar el lote de documentos antiguos vencidos, seleccionar y confirmar su eliminación. Cada lote es de hasta 100; la venta y los comprobantes se conservan.

## Retención y seguridad

- Avisos y cotizaciones nuevas usan vencimiento calculado por servidor. El mantenimiento existente de cinco minutos limpia documentos vencidos en lotes limitados, sujeto a carga, errores y reintentos; no garantiza borrado físico al segundo.
- Cotizaciones antiguas recientes reciben vencimiento en una migración paginada de mantenimiento. Las antiguas ya vencidas se ocultan y requieren revisión explícita desde la pantalla administrativa antes de borrar el histórico.
- Los recibos de cotización nuevos conservan solo el identificador. Al vender, se elimina el detalle de la cotización y se deja referencia mínima; se depuran las copias heredadas. Al borrar/vencer se conserva la marca mínima de operación para impedir recrearla por reintento. No se aplica caducidad global a recibos de ventas/inventario.
- El borrado de cuentas conserva un perfil mínimo desactivado para sus referencias históricas. Bloquea la cuenta propia, la última administradora y usuarios con caja abierta. El correo de una cuenta eliminada no se reutiliza en la misma empresa, porque el UID actual deriva del correo.
- Cambiar contraseñas/desactivar invalida las sesiones anteriores. Un usuario con horario necesita conexión para verificar acceso. Los carritos y cobros pendientes existentes no se borran al bloquear la pantalla.
- Los costos no se incluyen en el catálogo compartido, IndexedDB general, avisos, cotizaciones ni comprobantes.
- El mapa grande de resultados continúa exento de indexación automática. Un índice manual únicamente para `kind` y `result.id` permite localizar la referencia mínima de las copias antiguas. Esta configuración es compatible con las [exenciones de índices de Firestore](https://firebase.google.com/docs/firestore/query-data/index-overview).
- Reglas locales revisadas y probadas, pendientes de publicación conjunta con el backend. La evaluación queda en `auditoria-reglas-funcional-2026-10-11.json`.

## Validación local

- Web: typecheck, lint y build/PWA correctos. Se mantienen los avisos existentes del build sobre tamaño de Firebase y combinación de importaciones de calendar-push.
- Functions: build y 42 pruebas unitarias correctos.
- Emuladores: siete casos nuevos de integración funcional; cuatro casos nuevos de reglas; quince casos existentes de reglas. Se verificaron creación multitienda, contraseña/revocación, permisos de compra, avisos idempotentes y limpieza, búsqueda fuera del primer lote, retención, venta concurrente, borrado frente a venta y cobro tras vencimiento.
- Regresión de inventario: cinco casos de ventas, transferencias, kardex, stock compartido y presentaciones correctos.
- Regresión de calendario: tres casos correctos, incluyendo permisos compartidos y finalización de eventos.
- Contratos frontend/fiscales e índices: once casos correctos; otras once pruebas del repositorio y caché del catálogo también pasan. Se conserva la validación de DNI desde S/700 y factura con RUC.
- Navegador: admin, POS y trabajador; consulta de stock de cajas cerradas, compra privada, avisos, cliente manual, búsquedas, configuración de usuarios y formulario avanzado. Anchos 320, 390, 768 y 1200 px; bloqueo con reloj del navegador modificado.
- Capturas locales: `fixtures/funcional-pos-stock-desktop.png` y `fixtures/funcional-pos-stock-mobile.png`. La franja roja pertenece al emulador de Firebase.

## Publicación pendiente

1. Publicar Functions compatibles y los índices de `firestore.indexes.json`; esperar a que los índices terminen de construirse.
2. Publicar conjuntamente las reglas Firestore y Storage que verifican horarios y revocación.
3. Publicar la web en Vercel.
4. Verificar con cuentas de cada rol en el entorno publicado y revisar el primer mantenimiento. Usar la pantalla administrativa para decidir el alcance del borrado histórico.

Subir a GitHub/Vercel por sí solo no publica Functions, índices ni reglas. Este trabajo no cambió el servicio Laravel ni realizó emisiones reales a SUNAT.
