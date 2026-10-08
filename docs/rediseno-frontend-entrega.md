# Entrega del rediseño de D’ENZOZ

Fecha: 8 de octubre de 2026.

## Implementado

- Identidad coral basada en el logo de la empresa, superficies claras, texto grafito y fuentes IBM Plex locales. Logo incorporado en el acceso, cabeceras, favicon e icono de la aplicación instalada.
- Base compartida de botones, campos, tablas, estados, avisos y diálogos. Animaciones cortas con respeto a la preferencia de movimiento reducido.
- Administración con navegación agrupada y opción de contraerla. En pantallas pequeñas, menú lateral bajo demanda.
- POS con navegación lateral en monitor; en móvil, accesos inferiores y vistas de catálogo/carrito con total y cobro siempre disponibles. Tienda visible una sola vez, nombres legibles y cobro fuera de la zona desplazable de pagos.
- Trabajador con navegación superior en escritorio e inferior en móvil/tablet vertical. Consulta de productos en panel lateral en escritorio y diálogo en móvil.
- Cotizaciones con editor de dos columnas en escritorio, orden de tareas adaptado al móvil y controles de cantidad más grandes.
- Formularios de mercadería y ajustes adaptados; nombres completos en ingresos, recepciones y reposiciones. Tablas de productos, usuarios, kárdex, comprobantes y resumen por tienda se convierten en fichas en móvil.
- Panel administrativo con indicadores jerarquizados, accesos a operaciones y nueva tipografía. Estadísticas, calendario, permisos, incidencias, caja, tickets y SUNAT comparten la base visual; agenda primero en tamaños pequeños.
- Diálogos con foco contenido, Escape, restauración de foco cuando el elemento sigue montado y bloqueo del desplazamiento del fondo.

## Alcance técnico

No se modificaron Functions, reglas Firestore ni el microservicio tributario. Se conservaron rutas, permisos, operaciones y consultas existentes. No se agregaron consultas, listeners o polling para el rediseño.

Los cambios previos de pagos combinados ya presentes en el árbol de trabajo se conservaron. El cliente continúa registrando efectivo recibido, importe aplicado y vuelto por separado.

No se añadieron bibliotecas de animación o UI. Las fuentes locales suman 60.420 bytes. Continúan las rutas diferidas y la carga separada de escáner/PDF. El precache contiene los assets de marca y las fuentes.

## Comprobaciones realizadas

- Typecheck y lint correctos.
- Build web y service worker correctos.
- Comparación del bloque de estilos de impresión térmica con HEAD: idéntico.
- Revisión visual con datos existentes de demostración: acceso, panel admin, catálogo y formulario de producto, venta, pagos combinados, consulta y cotizaciones.
- Anchos revisados visualmente: 360, 390, 1024, 1366 y 1440 px. Comprobaciones de navegación y ancho sin desbordamiento en cotizaciones.
- Pago combinado en borrador: venta de S/3,50, Yape S/1 y efectivo recibido S/5 -> efectivo aplicado S/2,50 y vuelto S/2,50. No se cobró la venta.
- Captura de teclado desde el carrito móvil: una tecla revela el catálogo, entra en la búsqueda y conserva los ítems del borrador.
- Consulta de producto conserva unidad base, equivalencia y disponibilidad de cajas cerradas. Cierre con Escape revisado.

## Límites de la revisión

No se emitieron ventas, ingresos ni transferencias de prueba contra los datos existentes. No se cambió ningún permiso durante la revisión. La impresión física, el teclado virtual de dispositivos reales, las notificaciones con la app cerrada y la actualización de una PWA instalada requieren una revisión en esos dispositivos. No se ejecutó una prueba visual exhaustiva de todas las combinaciones de datos y permisos.

Vite mantiene avisos sobre el tamaño del chunk de Firebase y la mezcla de imports del módulo de notificaciones. El build termina correctamente; no se cambió la estrategia de esos módulos dentro del rediseño.

Los cambios están locales. No se realizó publicación, commit ni push.
