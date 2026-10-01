# Campos numéricos y cotizaciones PDF — 30/09/2026

## Formularios

`EditableNumberInput` mantiene el texto durante la edición, incluido el vacío, y conserva los manejadores numéricos y validaciones existentes. Al salir del campo vuelve a mostrar el valor normalizado del formulario. No cambia cómo se almacena el inventario.

Aplicado únicamente a campos que convertían o limitaban cada pulsación: cantidades de ProductPicker (ingreso, transferencias y ajustes), reposición POS, recepción POS, cotizaciones, paso fraccionario y tamaños del diseño del ticket. Caja, pago del POS, campos con estado de texto y campos no controlados permanecen sin cambios.

Ingreso de mercadería: contenedor `mx-auto w-full max-w-2xl` para centrar título y formulario dentro del área del administrador.

## PDF

Generación local con jsPDF, cargado cuando se prepara el documento. Incluye el logo de Diseño de tickets, empresa/RUC/dirección/teléfono, fecha, cliente, tienda, presentación, cantidad, precio, total, disponibilidad, observaciones, pie y numeración. Repite encabezados en cotizaciones de varias páginas. No sube el PDF a ningún servidor ni lo guarda públicamente.

El logo puede ser un archivo subido o un enlace accesible para la exportación. Si un servidor externo bloquea CORS, el modal pide subir la imagen en Diseño de tickets; no entrega silenciosamente un PDF sin el logo configurado.

## WhatsApp

- El archivo se prepara antes de pulsar Compartir PDF para conservar la activación del usuario necesaria en Web Share.
- Si el dispositivo admite compartir PDFs, abre su selector de aplicaciones. El usuario elige WhatsApp y el destinatario; no se convierte la cotización en texto.
- Descarga PDF disponible siempre.
- En PC hay accesos explícitos a WhatsApp Web y a `whatsapp://send` para la app instalada. Descargan el PDF; el usuario lo adjunta como documento.
- Web reutiliza la referencia de la ventana abierta desde el sistema y el nombre `denzoz-whatsapp` cuando las políticas del navegador y WhatsApp lo permiten. No puede detectar/reutilizar arbitrariamente pestañas abiertas manualmente ni asegurar si la app de PC está instalada.
- Los teléfonos de 9 dígitos usan Perú (+51); los números internacionales de 10–15 dígitos se conservan. No trunca números extranjeros ni manda mensajes automáticamente.
- Si no hay Web Share en móvil, descarga y abre el enlace de WhatsApp; hay que adjuntar el documento.

## Comprobaciones

Typecheck, lint y build web. Prueba en emuladores con `tools/quotation-pdf-smoke.py`: borrar cero y escribir normalmente, ingreso centrado, PDF con logo, descarga real del archivo, modalidades móvil/PC y reutilización de ventana simulada. Compartir nativo y WhatsApp se simulan: no se enviaron mensajes ni documentos a contactos reales y no se verificó una instalación física de WhatsApp para PC.

Inspección del PDF exportado: logo embebido, cliente con tildes, presentación y total S/40.00. Cotización de 90 líneas: 8 páginas, todas las líneas presentes y total S/2070.00. Primera y última página renderizadas e inspeccionadas. Modal sin desbordamiento en 390, 768 y 1365 px.

Referencias: [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [reutilización de ventanas y límites entre orígenes](https://developer.mozilla.org/en-US/docs/Web/API/Window/open).
