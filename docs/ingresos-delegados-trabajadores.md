# Ingreso de mercadería por trabajadores

## Uso

1. El admin entra a **Permisos de Trabajadores** y selecciona una tienda. El POS multitiendas elige su tienda activa en el menú y entra a **Permisos de Trabajadores**.
2. Selecciona uno o ambos permisos de un trabajador existente: **Registrar ingresos de mercadería** y **Crear productos nuevos**. Pulsa **Guardar permisos**.
3. El trabajador ve **Ingresos** sin cerrar sesión. El destino queda fijado a su tienda asignada.
4. Para productos existentes, busca el nombre o escanea el código, selecciona la presentación, registra cantidades y confirma el ingreso. Puede agregar una referencia de guía o proveedor.
5. Para un producto nuevo, pulsa **Crear producto nuevo**, define sus datos y presentaciones, y guarda. Después lo busca para registrar las cantidades recibidas.
6. Al terminar, el encargado pulsa **Retirar ambos permisos**, o desmarca solo el que corresponda y guarda.

Crear un producto agrega una definición al catálogo de la empresa, sin stock en otras tiendas. Registrar el ingreso agrega stock únicamente en la tienda asignada. No requiere una aprobación adicional después de conceder el permiso.

## Stock y permisos

- Cajas sin apertura conservan stock separado por presentación. Las presentaciones que permiten apertura comparten el saldo suelto. El total equivalente sigue incluyendo ambos.
- Las unidades indivisibles y las cajas cerradas admiten cantidades enteras; las unidades de medida y presentaciones abiertas mantienen las validaciones del modelo de stock existente.
- El trabajador puede crear productos y precios iniciales, pero no editar productos existentes, cambiar precios de catálogo existentes, administrar usuarios o delegar permisos.
- El permiso solo sirve para el trabajador activo, su empresa y su tienda actual. Si se le asigna otra tienda, el permiso anterior no habilita ese nuevo destino: deben concederse permisos para esa ubicación.
- Las Functions vuelven a leer perfil y permiso en la transacción. Una revocación confirmada impide que una operación pendiente confirme después con el permiso anterior. Una operación ya confirmada conserva su stock e historial.
- Un ingreso nuevo y sus movimientos se guardan juntos. El identificador evita sumar stock de nuevo al reintentar la misma solicitud. La pantalla conserva la solicitud original y bloquea cambios cuando no sabe si Firebase la confirmó. Los formularios no confirman operaciones sin conexión.
- El formulario de producto nuevo funciona de la misma manera con su identificador de creación. Los códigos se validan contra el registro de códigos existente.

## Historial y consumo

Los encargados consultan los ingresos de la tienda y el historial de permisos desde la misma pantalla. Los trabajadores ven sus propios ingresos. Cada cambio de permisos registra autor, trabajador, tienda, fecha, permisos anteriores y nuevos; cada producto nuevo registra autor y tienda de origen en `worker_product_creations` (solo servidor).

Se reutilizan el catálogo IndexedDB, la sincronización incremental y el listener del perfil del trabajador. Los listados se solicitan al entrar, cambiar de tienda, actualizar o paginar; no hacen polling. Trabajadores: páginas de 25; tiendas: 25; historiales: 10. Cada ingreso agrega un documento de cabecera a las escrituras de stock y kárdex existentes. Cada cambio de permisos escribe el perfil y una entrada de auditoría.

No se requiere migración: los usuarios sin `inventoryAccess` comienzan sin estos permisos.

## Publicación manual

Desde la raíz del proyecto:

```powershell
npm --prefix functions run build
npx -y firebase-tools deploy --project denzozsaas --only "firestore:rules,firestore:indexes"
```

Espera a que los índices nuevos estén **READY** en Firebase antes de habilitar el flujo. Luego publica las Functions modificadas y nuevas:

```powershell
npx -y firebase-tools deploy --project denzozsaas --only "functions:listWorkerInventoryAccess,functions:setWorkerInventoryAccess,functions:recordStockIngress,functions:saveCatalogProduct"
```

Publica la web mediante el flujo habitual de Git/Vercel. Las reglas deben incluir `inventoryAccess`: si queda la versión anterior, otros cambios de perfiles realizados por el admin pueden fallar tras conceder permisos.

## Revisión estática de seguridad

```json
{
  "score": 5,
  "summary": "Revisión estática del alcance nuevo: permisos escritos solo por servidor, autorización por empresa y tienda vigente, mutaciones transaccionales y lecturas acotadas. No constituye verificación con emuladores ni producción.",
  "findings": []
}
```

Las reglas actualizadas son un prototipo y requieren revisión y verificación antes de compartir ampliamente la aplicación.
