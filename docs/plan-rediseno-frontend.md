# D’ENZOZ — Auditoría y plan de rediseño del frontend

Fecha: 7 de octubre de 2026. Estado: propuesta pendiente de aprobación.

## 1. Alcance y método

Revisión de las 30 páginas declaradas en el router: 16 de administración, 9 de POS, 4 de trabajador y el inicio de sesión. También se revisaron los tres layouts, estilos globales, configuración de identidad/PWA y componentes compartidos de formularios, modales, inventario, estadísticas, calendario y notificaciones.

La auditoría se basa en el código y las capturas entregadas. No se recorrieron las 30 pantallas en una sesión autenticada ni se midió el rendimiento real del navegador. Las observaciones de estructura son comprobables en el código; las de interacción y tamaños requieren una revisión visual durante la implementación.

En esta etapa solo se crea este documento. Los cambios previos de pagos combinados y el logo agregado por el usuario se conservan.

El rediseño abarcará presentación, navegación, accesibilidad, distribución y estados visuales. Se conservarán las rutas, permisos, contratos, validaciones de negocio y operaciones existentes. Functions, API tributaria, reglas, índices y modelo de datos quedan fuera de este trabajo.

## 2. Hallazgos principales

| Hallazgo | Evidencia y efecto | Tratamiento propuesto |
|---|---|---|
| Navegación duplicada en POS | La hamburguesa siempre se muestra y los enlaces superiores aparecen desde `2xl`. Los mismos destinos ocupan dos lugares. Entre `lg` y `2xl`, esos enlaces superiores desaparecen. | Una navegación principal por tamaño, con accesos secundarios agrupados. |
| Trabajador limitado a móvil en escritorio | El layout aplica `max-w-lg`, espacio inferior y barra inferior fija en todos los tamaños. La hamburguesa repite sus enlaces. | Navegación superior en escritorio, inferior en móvil; anchos según la tarea. |
| Menú administrativo plano | Tiene 16 enlaces, varios truncados, con el mismo peso visual. | Cinco grupos y nombres breves; mantener todas las páginas accesibles. |
| Notificaciones fuera del flujo | En admin las campanas se posicionan absolutamente. Los avisos de calendario, reposición y mensajes generales utilizan posiciones inferiores independientes. | Campanas dentro de la cabecera y una zona visual coordinada de avisos que respete carrito, acciones y navegación móvil. |
| Identidad desconectada del logo | Predominan morado e índigo, iconos genéricos de destellos y favicon anterior. Hay colores escritos directamente en componentes. | Integración completa de marca y sustitución de colores por su función, preservando colores reconocibles de los medios de pago. |
| Exceso de marcos y peso | Tarjetas dentro de tarjetas, sombras reiteradas, muchas mayúsculas, badges y títulos compitiendo. | Superficies más planas, separación por espacio y divisores; una acción principal por tarea. |
| Información operativa pequeña | Hay etiquetas de 10–11 px, nombres truncados en recepción/reposiciones/carrito y controles reducidos en cotizaciones. | Texto crítico legible, nombres con hasta dos líneas y controles táctiles amplios. |
| Tablas poco adaptables | Productos, usuarios, comprobantes y kárdex usan anchos mínimos de 600–760 px. En móvil requieren desplazamiento horizontal. | Filas resumidas con detalle desplegable en móvil; tablas para comparar datos en escritorio. |
| Desplazamiento inconsistente | El layout POS restringe el overflow desde `lg`; algunas páginas tienen desplazamiento propio y otras solo un contenedor estrecho. | Definir el propietario del scroll por pantalla y evitar contenido o acciones inaccesibles en monitores bajos. |
| Formularios largos | El editor de producto acumula identidad, presentaciones, apertura, fracciones y control de stock. Guardar está al final. | Secciones claras, filas de presentación ordenadas y acciones accesibles al desplazarse. |
| Componentes visuales incompletos | Se usa `btn-secondary` sin definición en los estilos revisados. También aparecen clases de entrada/salida sin un sistema de animación definido en la configuración revisada. | Unificar variantes reales de componentes y animaciones explícitas y pequeñas. |
| Modales de varias familias | El modal compartido ya gestiona foco y teclado; otros diálogos de venta y consulta se construyen aparte. | Conservar lo que funciona y extender el mismo comportamiento a los diálogos restantes. |
| Mensajes frágiles | El feedback general dura 3,5 segundos y deduce si es error a partir del texto. | Estados visuales explícitos; errores de formulario junto al campo y errores importantes persistentes. |
| Texto que puede confundir | El botón de sesión dice “Cerrar turno” aunque ejecuta logout. Login incluye promesas técnicas de velocidad/offline. | “Cerrar sesión” para salir, cierre de caja en su pantalla; textos breves que reflejen el comportamiento real. |
| Movimiento constante | Hay puntos verdes pulsantes y no se encontró una política global de movimiento reducido. | Animación puntual para cambios de estado y respeto a las preferencias del dispositivo. |

## 3. Dirección visual

### Identidad

Una herramienta de tienda reconocible por su monograma coral, tipografía precisa y áreas de trabajo claras. Los importes, cantidades y acciones deben poder localizarse de un vistazo.

El logo recibido es un PNG de 220 × 220 px con transparencia. Su color opaco más frecuente es `#F35A38`. No requiere retirar un fondo blanco. Se conservará su proporción y se prepararán variantes de tamaño y margen adecuadas para cabecera, favicon e instalación PWA. Si se necesita un original de mayor resolución, se indicará; no se inventarán detalles al ampliarlo.

### Paleta propuesta

| Uso | Color | Aplicación |
|---|---|---|
| Coral de marca | `#F35A38` | Logo, pequeños acentos, indicador de sección activa. |
| Coral profundo | `#B93E24` | Botón principal y enlaces destacados con contraste suficiente. |
| Grafito | `#202A31` | Texto principal, cifras y zonas de énfasis. |
| Gris de lectura | `#63717C` | Información secundaria que debe seguir siendo legible. |
| Fondo | `#F4F6F8` | Área general de trabajo. |
| Superficie | `#FFFFFF` | Formularios, listas y paneles de trabajo. |

Los estados mantienen verde, ámbar y rojo con icono y texto. Yape, Plin y otros métodos conservan su identidad cuando ayuda a reconocerlos. El coral brillante se usa como marca: su contraste calculado contra blanco es 3,32:1; para botones con texto blanco se propone el coral profundo, con 5,56:1.

### Tipografía y componentes

- Propuesta: IBM Plex Sans para interfaz, títulos y lectura; IBM Plex Mono en códigos e importes puntuales. Fuentes locales, pesos necesarios y alternativas del sistema mientras cargan.
- Números tabulares para alinear cantidades y dinero. Textos de producto en tipografía normal.
- Texto principal de 14–16 px; títulos contenidos; evitar mayúsculas extensas y etiquetas críticas de 10 px.
- Escala de espacios consistente. Bordes discretos, esquinas moderadas y sombras reservadas para elementos elevados.
- Iconos de una sola familia, acompañados de nombres breves donde puedan ser ambiguos. Cada botón solo con icono tendrá nombre accesible.
- Rasgo propio: una línea coral discreta marca la operación o sección activa; grafito y cifras alineadas dan continuidad entre catálogo, carrito y documentos.
- La marca ocupará cabecera, acceso e iconos de aplicación. En tickets y PDF se respetará el logo configurado y su formato monocromático cuando corresponda.

### Movimiento

Transiciones breves de 120–180 ms para abrir paneles, cambiar selección y confirmar acciones. Priorizar opacidad y transformaciones; evitar animar toda la cuadrícula al buscar o cambios de altura que desplacen productos. Los importes deben responder inmediatamente. Se desactiva el movimiento decorativo con la preferencia de movimiento reducido. El diseño no necesita 3D para cumplir esta dirección.

## 4. Navegación y dispositivos

Los siguientes rangos son puntos de partida; se ajustarán por espacio disponible, altura, teclado y orientación.

| Área | Escritorio amplio, desde 1280 px | Tablet y anchos intermedios | Móvil |
|---|---|---|---|
| Admin | Sidebar de unos 224 px con grupos, cabecera contextual y cuenta. | Sidebar compacta cuando haya espacio; drawer cuando comprometa el contenido. | Drawer como navegación global; acciones dentro de cada página. |
| POS | Navegación lateral compacta con icono y nombre breve; cabecera con tienda y cuenta; catálogo y carrito simultáneos. | Dos paneles cuando quepan sin comprimir controles; en vertical, cambio explícito entre catálogo y carrito. | Navegación inferior breve; catálogo/carrito por vistas y resumen de venta accesible. |
| Trabajador | Navegación superior de 3 o 4 tareas; resultados y detalle pueden compartir espacio. | Distribución según orientación y tarea. | Barra inferior de 3 o 4 tareas; cuenta en cabecera. |

En POS móvil, la barra de venta y la navegación deben ocupar zonas distintas o coordinar su presencia según la vista. Ninguna debe tapar el botón de cobro. En trabajador, “Ingresos” aparece únicamente con los permisos actuales. En POS multitiendas permanecen aprobación, permisos y calendario conforme al acceso existente.

### Agrupación administrativa

1. **Resumen:** Inicio, Estadísticas.
2. **Mercadería:** Productos, Ingresos, Transferencias, Reposiciones, Ajustes, Kárdex, Tiendas y almacenes.
3. **Operación:** Comprobantes, Incidencias, Calendario.
4. **Equipo:** Usuarios, Permisos.
5. **Configuración:** Tickets, SUNAT.

El menú de cuenta reúne acciones de sesión. La tienda activa se mantiene visible en POS y trabajador; cambiarla conserva los controles existentes para no mezclar operaciones.

## 5. Revisión y propuesta por página

### Acceso — 1 página

| Página | Observación | Propuesta |
|---|---|---|
| Inicio de sesión | Panel promocional extenso, destellos y estética índigo; el formulario compite con mensajes técnicos. | Logo real, acceso directo y mensaje corto. Composición de marca contenida en escritorio y formulario único en móvil. Mantener validaciones y accesos de demo donde correspondan. |

### Administración — 16 páginas

| Página | Observación | Propuesta |
|---|---|---|
| Panel del día | Cuatro KPIs y varias tarjetas con peso parecido. | Resumen diario jerarquizado y acceso a pendientes con los datos ya disponibles. Sin métricas inventadas ni nuevas consultas. |
| Estadísticas | Filtros extensos, chips de tiendas y explicación repetida; gráficos con etiquetas pequeñas. | Barra de filtros compacta, selección de tiendas resumida y detalles al desplegar. Ventas, frecuencia y cobros claramente diferenciados; conservar advertencia de historial incompleto. |
| Productos y catálogo | Tabla ancha y editor largo; presentaciones pequeñas y stock explicado en párrafos. | Lista legible y detalle por producto. Editor por secciones: datos, presentaciones y control. Cada presentación muestra contenido, precio y reglas. Guardar siempre accesible; conservar todos los campos. |
| Tiendas y almacenes | Tarjetas y acciones de distinta jerarquía. | Selector claro entre tipos de ubicación, datos esenciales y acciones agrupadas. Eliminación separada visualmente de editar. |
| Ingreso de mercadería | El formulario ya está centrado; resumen equivalente y reglas ocupan bloques separados. | Mantener el centrado. En escritorio, líneas amplias y resumen lateral; en móvil, resumen al final. Destino, cantidad por presentación y equivalente total diferenciados. |
| Transferencias | Detalles largos de productos y estados; formulario denso. | Origen → destino claramente identificados, estado visible y detalle desplegable. Enviado, recibido y faltante alineados. Conservar cancelación y conciliación con explicación de su efecto. |
| Reposiciones | Productos truncados en columnas pequeñas; atender/rechazar compiten en cabecera. | Lista de pendientes con tienda y fecha, detalle legible y acción principal “Atender”. Rechazar como acción secundaria explícita. Aprobación y recepción siguen siendo pasos distintos. |
| Ajustes de inventario | Mezcla ajuste, merma y reclasificación con texto largo. | Selector visual de operación, ayuda específica y resumen de la cantidad que se registra. Mantener advertencias necesarias para reclasificar cajas. |
| Kárdex | Tabla ancha, filtros repartidos y referencia truncada. | Filtros reunidos y filas comparables. Móvil con movimiento resumido y detalle completo; signo, presentación y cantidad visibles. Conservar rango, filtros, exportación y cargar más. |
| Comprobantes | Cabecera cargada de acciones, tabla ancha y mensajes tributarios truncados. | Estado destacado y detalle accesible. Acciones generales agrupadas; reenvío/anulación en contexto. Conservar consolidación y estados de SUNAT. |
| Diseño de tickets | Editor y vista previa ya comparten renderer; varios controles y acciones pueden competir. | Conservar la vista previa fiel. Secciones de marca, formato y textos; guardar/probar en una barra ordenada. Preview lateral en escritorio y vista seleccionable en móvil. |
| SUNAT y facturación | Ya tiene pestañas, pero abundan tarjetas, badges y términos técnicos. | Conservar pestañas y diagnóstico; mostrar primero estado y siguiente acción. Detalle técnico accesible bajo demanda. Formularios de empresa, series, certificado y credenciales claramente separados. |
| Incidencias | Tarjetas uniformes y controles pequeños. | Estado, producto y tienda como primera lectura; evidencia y resolución en detalle. “Resolver” en contexto, manteniendo la independencia del ajuste de inventario. |
| Calendario | Mes y agenda ya están separados; controles y explicaciones ocupan espacio. | Mes limpio y agenda clara, eventos vencidos reconocibles y alta breve. En móvil priorizar agenda con acceso al mes. Conservar recurrencia, recordatorios y completar evento. |
| Usuarios | Tabla ancha; estado y permisos se modifican desde distintas celdas. | Filas con persona, rol, tienda y estado; acciones explícitas y formulario condicionado al rol. Evitar textos internos de Firebase en el flujo de usuario. |
| Permisos de trabajadores | Tarjetas extensas por trabajador y varios botones con variante visual sin definir. | Tienda visible, dos permisos independientes y estado de cambios por guardar. Historial como vista secundaria; retirar permisos con acción clara. |

### POS — 9 páginas

| Página | Observación | Propuesta |
|---|---|---|
| Vender | Catálogo, cliente, comprobante y múltiples áreas de pago compiten; el footer reduce la altura útil del carrito. | Catálogo con nombre, precio y disponibilidad; omitir tienda repetida en cada tarjeta cuando ya esté visible en cabecera. Carrito con nombre legible y cantidades alineadas. Total/cobro siempre accesibles. Pago combinado conserva su modal y resumen compacto. Información adicional del medio de pago se despliega en contexto. |
| Recepciones | Productos truncados y controles de conteo comprimidos; scroll dentro del modal. | Filas con enviado/recibido, unidad o caja claramente indicada y diferencias visibles. Confirmación accesible; conservar cantidades máximas y pasos válidos. |
| Caja | Columna estrecha también en escritorio; mucha información resumida en texto pequeño. | Estado de turno claro, resumen de caja y conteo físico en áreas diferenciadas. Efectivo esperado, contado y diferencia reconocibles. Mantener impresión del cierre y reintentos pendientes. |
| Mis ventas | Tarjetas clicables con botones internos, diálogos propios y estado fiscal pequeño. | Lista cronológica legible; detalle accesible por teclado, reimpresión y solicitud de anulación en contexto. Unificar presentación de diálogos y nombres de estados. |
| Pedir reposición | Nombre truncado y cantidad/quitar comprimidos en una fila. | Búsqueda y sugerencias compactas; filas adaptables con producto, presentación, saldo y cantidad solicitada. Separar unidades sueltas de cajas cerradas. |
| Estadísticas de hoy | Comparte el módulo admin, con explicaciones que ocupan espacio. | Resumen diario de tienda activa, rankings y horas legibles. Conservar restricción diaria y actualización explícita. |
| Aprobar reposiciones | Comparte la pantalla administrativa. | Misma claridad de revisión dentro del contexto POS multitiendas. Conservar autorización existente y traspaso posterior. |
| Calendario | Comparte workspace y requiere permiso. | Mismo calendario adaptado al espacio POS; avisos discretos que no bloqueen cobro. |
| Permisos de trabajadores | Módulo compartido con tienda activa. | Cuenta y tienda claramente visibles, permisos independientes y acceso al historial. Conservar guardas y revocación existente. |

La selección de presentaciones conserva el comportamiento actual: una única presentación se agrega directamente; varias abren selector. Precio, contenido y disponibilidad serán la primera lectura del selector. Detalles de apertura/fracciones siguen disponibles sin repetir un párrafo en cada opción.

### Trabajador — 4 páginas

| Página | Observación | Propuesta |
|---|---|---|
| Consultar | En escritorio queda una franja estrecha y gran espacio vacío; detalle en modal propio. | Escritorio con búsqueda/resultados y ficha de producto al lado cuando haya selección. Móvil con búsqueda inmediata y ficha adaptada. Distinguir total equivalente, saldo suelto y cajas disponibles usando los cálculos actuales. |
| Cotizaciones | Archivo y flujo extensos: crear, historial, stock en otras tiendas, guardar, imprimir y compartir; muchas tarjetas y botones con peso similar. | Área de productos y resumen lateral en escritorio. En móvil, resumen compacto y acciones ordenadas. “Guardar cotización” principal; PDF/impresión como salidas claras. Mantener total disponible vs. pedido completo y límites reales de compartir por WhatsApp. |
| Incidencias | Reporte e historial con estilo distinto a consulta. | Crear reporte corto por tipo, descripción y foto; historial con estado. Mantener contexto del producto cuando se abre desde consulta. |
| Ingreso de mercadería | Nuevo producto, ingreso e historial conviven en una columna. | Destino fijo visible, registrar ingreso como tarea principal, alta de producto como acción secundaria autorizada e historial separado. Mostrar creación de producto y registro de cantidades como pasos distintos. |

### Estados y ventanas compartidas

También se incluirán: selección de tienda, caja cerrada, carrito vacío, búsqueda sin resultados, cámara, errores de permisos, formularios pendientes, cobro por confirmar, venta emitida, reimpresión fallida, carga de módulos, falta de configuración y error global. Ninguna pantalla secundaria debe conservar la identidad anterior por descuido.

El error global tendrá un mensaje útil y acceso a detalle técnico, sin exponerlo como primera lectura. La pantalla de configuración conservará sus instrucciones necesarias para quien instala el sistema.

## 6. Rendimiento y costo

- Mantener carga diferida por rutas y por módulos pesados, como escáner y PDF.
- Conservar catálogo local, búsquedas y consultas paginadas existentes.
- No agregar listeners, polling ni lecturas para producir efectos visuales o poblar nuevas métricas.
- Evitar montar dos versiones independientes de una página para móvil/escritorio: una estructura adaptable o vistas que compartan el estado actual.
- Reutilizar datos ya cargados en las nuevas presentaciones; preservar el ciclo de vida de los hooks al mover componentes.
- Logo e iconos locales con dimensiones reservadas; incluir los nuevos assets en el precache donde corresponda. La configuración actual enumera el icono anterior y no incluye PNG en su patrón general de precache.
- Fuentes locales limitadas; iconografía existente; CSS para interacciones sencillas. Evitar bibliotecas de animación o gráficos pesadas si lo existente resuelve la tarea.
- Revisar peso de los bundles, estabilidad de la distribución y respuesta de búsqueda al completar la implementación. No se ha medido una mejora todavía ni puede prometerse una cuota de Firebase a partir del diseño.

## 7. Orden de implementación después de aprobar

1. **Base visual y marca:** tokens, logo, favicon/PWA, tipografía y componentes esenciales; variantes de botón, campos, estados, modales y avisos.
2. **Estructura por rol:** navegación exclusiva por dispositivo, grupos admin, cabeceras, tienda activa, cuenta, scroll y zonas seguras.
3. **Venta y trabajador:** priorizar POS, consulta y cotización como pantallas de uso frecuente. Mantener pagos combinados, scanner, selección de presentaciones e impresión.
4. **Mercadería y equipo:** productos, ingreso, transferencia, recepción, reposición, ajustes, ubicaciones, usuarios, permisos e historiales.
5. **Información y configuración:** panel, estadísticas, kárdex, comprobantes, calendario, incidencias, tickets y SUNAT.
6. **Revisión final:** coherencia de todas las rutas y estados, teclado, tamaños, contraste, movimiento reducido y comprobaciones de compilación/tipos/lint que se acuerden para la implementación.

Las tres primeras pantallas de referencia serán Vender, Panel del día y Consultar. Establecerán el patrón visual y de distribución que luego se extiende al resto. La propuesta abarca todas las páginas enumeradas.

## 8. Criterios de aceptación

- Una navegación principal por rol y tamaño. Barra móvil del trabajador ausente en escritorio.
- Ningún botón de cobro, guardar o confirmar queda cubierto por navegación, notificaciones o teclado.
- Revisión en anchos de referencia de 360, 390, 768, 1024, 1366 y 1920 px, incluyendo monitor de 1366 × 768 y tablet en ambas orientaciones.
- Nombres de productos identificables; datos críticos no dependen solo de color, hover o texto truncado.
- Controles táctiles principales de al menos 44 × 44 px; foco visible, navegación por teclado y comportamiento consistente en diálogos.
- Formatos y validaciones de cantidades, pasos fraccionarios, montos y documentos conservados. Los campos numéricos siguen permitiendo borrar y escribir cómodamente.
- Unidades, cajas cerradas y saldo compartido mantienen su significado en venta, consulta, ingreso, recepción y reposición.
- Pago combinado conserva efectivo recibido, importe aplicado y vuelto; éxito de venta e impresión automática/reimpresión mantienen sus flujos.
- Estadísticas conservan periodos por rol, alcance por tienda y limitaciones del historial. No presentar cantidad de ventas como afluencia real de personas.
- Tickets y PDF conservan formatos y datos fiscales; el diseño de la aplicación no altera el CSS de impresión de forma accidental.
- Nuevos assets de marca disponibles también en la aplicación instalada; actualización PWA sin borrar carrito ni estado de trabajo.
- Sin nuevas lecturas/listeners de Firebase causadas por duplicar layouts o añadir decoración. Sin cambios de backend ni publicación durante esta etapa.

## 9. Archivos de referencia

- [Router y estados globales](C:/Proyectos/Denzoz_Sistema/apps/web/src/App.tsx)
- [Estilos globales](C:/Proyectos/Denzoz_Sistema/apps/web/src/styles/index.css)
- [Layout admin](C:/Proyectos/Denzoz_Sistema/apps/web/src/components/layout/AdminLayout.tsx)
- [Layout POS](C:/Proyectos/Denzoz_Sistema/apps/web/src/components/layout/PosLayout.tsx)
- [Layout trabajador](C:/Proyectos/Denzoz_Sistema/apps/web/src/components/layout/WorkerLayout.tsx)
- [Venta](C:/Proyectos/Denzoz_Sistema/apps/web/src/pages/pos/Sale.tsx)
- [Modal compartido](C:/Proyectos/Denzoz_Sistema/apps/web/src/components/ui/Modal.tsx)
- [Logo recibido](C:/Proyectos/Denzoz_Sistema/apps/web/public/branding/logo_denzoz.png)
- [Identidad de aplicación y PWA](C:/Proyectos/Denzoz_Sistema/apps/web/vite.config.ts)
