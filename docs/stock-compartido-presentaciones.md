# Stock por unidades y cajas cerradas

Actualizado el 30 de septiembre de 2026. Este modelo reemplaza la simplificación anterior de stock completamente compartido.

## Configuración

- **Abrir para vender unidades:** habilita el saldo compartido del producto. Ingresar una presentación suma su equivalente en unidades a este saldo.
- **Permitir venta fraccionada:** exige apertura habilitada y un paso que equivalga a unidades completas. Medio millar consume 500 hojas y cobra la mitad del precio del millar.
- Sin apertura, cada presentación mantiene un conteo entero de cajas cerradas por su ID. No aporta unidades a ventas sueltas ni a otras presentaciones, aunque tengan el mismo factor.
- UN, PAQ, CJA y demás unidades contables no admiten media unidad. KG, LT, L, M, GR, G y ML mantienen hasta tres decimales.

Ejemplo: 10 plumones sueltos + 2 cajas cerradas de 12 = 34 unidades equivalentes. Se pueden vender hasta 10 sueltos y 2 cajas, por separado. Vender 11 sueltos o media caja se rechaza. Con apertura habilitada, 1050 hojas menos 100 dejan 950; vender 0.5 millar deja 450.

## Operaciones

| Área | Comportamiento |
|---|---|
| POS, lector y selector | Disponibilidad por presentación; el carrito comparte demanda solo entre presentaciones que se pueden abrir. |
| Cotizaciones | Simulan los mismos saldos y validaciones; no reservan inventario. |
| Ingresos y reposiciones | Unidades y cajas cerradas en líneas distintas; las abiertas suman equivalentes al saldo compartido. |
| Transferencias, recepción, cancelación y devolución de faltantes | Conservan la presentación y afectan el saldo correspondiente de cada ubicación. Recepción nunca mayor a lo enviado. |
| Ajustes y merma | La cantidad final modifica solo el saldo de la presentación elegida. El ajuste de unidades no borra cajas cerradas. |
| Reclasificación | Conteo final de cajas cerradas: separa o devuelve sus equivalentes al saldo suelto, sin cambiar el total. Solo admin, transacción y movimiento de conversión. |
| Kardex y documentos | Conservan presentación, cantidad y equivalente. La reclasificación tiene variación total cero. |

## Datos anteriores

`stockModelVersion: 4` guarda `baseQuantity` (saldo compartido), `presentationQuantities` (cajas cerradas por ID) y `quantity` (total equivalente).

La versión 2 conserva las cajas no abribles. Los empaques abribles se incorporan al saldo común al operar. Los datos inconsistentes se rechazan.

La versión 3 perdió el desglose físico: si el producto tiene cajas cerradas y saldo positivo, se bloquean operaciones hasta que el administrador use **Ajustes → Reclasificar**. No se calcula el número de cajas dividiendo el total. Por ejemplo, con 34 registrados, indicar 2 cajas de 12 deja 10 sueltos; si físicamente no hay cajas, indicar cero confirma que el saldo es suelto. Con varias presentaciones cerradas se debe registrar cada conteo antes de reanudar ventas.

La migración conserva los conteos cerrados, mantiene los saldos ambiguos de versión 3 sin modificarlos y avisa que requieren conteo. No se ejecutó una migración masiva sobre datos reales.

Cambiar la opción de apertura autoriza compartir el contenido; no reconstruye automáticamente cajas al desactivarla. Antes de cambiar la configuración, completar los traslados pendientes que usen esa presentación.
