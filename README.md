# D'ENZOZ — Sistema de gestión y facturación

SaaS para bodega/variety store peruana ("todo por un sol"): POS, inventario multi-almacén, roles (Admin / POS / Trabajador) y facturación electrónica SUNAT vía microservicio Laravel + Greenter.

## Arquitectura

```
apps/web          PWA React 19 + Vite + TS estricto + Tailwind v4
                  ├─ /admin    Dashboard, inventario, transferencias, SUNAT, usuarios
                  ├─ /pos      Venta, caja, historial, reposición
                  └─ /w        Trabajador: consulta de precios, incidencias
functions         Cloud Functions v2 (Node 20): operaciones de venta/inventario,
                  usuarios, consultas DNI/RUC y proxy privado hacia SUNAT
apps/api-fact     Microservicio Laravel 11 + Greenter (XML UBL, firma, CDR)
firebase.json     Hosting, Firestore, Storage, reglas e índices
```

- **Comercial** en Firebase (Auth + Firestore + Storage). Reglas en `firestore.rules`.
- **Tributario** aislado en Laravel: la PWA llama Functions autenticadas y solo Functions conoce el token del microservicio. Si SUNAT cae, la venta sigue; el comprobante queda `pendiente` y Functions lo reintenta cada 10 minutos.

## Setup

### 1. PWA

```bash
cd apps/web
npm install
cp .env.example .env   # credenciales Firebase (consola > Configuración del proyecto)
npm run dev
```

### 2. Cloud Functions

```bash
cd functions
npm install
npm run build
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```

Configura los secretos antes del despliegue (el valor de `API_FACT_TOKEN` debe ser el mismo en Laravel):

```bash
firebase functions:secrets:set APISPERU_TOKEN
firebase functions:secrets:set API_FACT_TOKEN
firebase deploy --only functions,firestore:rules,firestore:indexes,storage
```

Durante el despliegue, define `API_FACT_URL` con la URL HTTPS del microservicio.

### 3. Microservicio tributario

```bash
cd apps/api-fact
composer install
cp .env.example .env   # certificado .pfx, credenciales SOL, endpoint beta/producción
php artisan serve
```

En producción, SQLite, configuración y artefactos SUNAT deben vivir en un volumen persistente. Por ejemplo, monta `/var/data/denzoz` y configura `DB_DATABASE=/var/data/denzoz/database.sqlite`, `SUNAT_STORAGE_ROOT=/var/data/denzoz/artifacts`, `SUNAT_CONFIG_DIR=/var/data/denzoz/config` y `SUNAT_CERT_PATH=/var/data/denzoz/config/certificate.pfx`.

Ver `docs/arquitectura.md` para el flujo completo de comprobantes y `docs/modelo-datos.md` para las colecciones Firestore.

## Migración a múltiples empresas

El script copia el modelo raíz heredado hacia `tenants/{tenantId}` y no elimina el origen. Primero revise el conteo en modo dry-run:

```bash
cd tools
TENANT_ID=denzoz npm run migrate:tenants
TENANT_ID=denzoz npm run migrate:tenants -- --apply
```

Orden de despliegue recomendado: (1) ejecutar la copia y verificar conteos, (2) desplegar Functions e índices, (3) desplegar reglas y PWA, (4) validar ventas/SUNAT y solo después planificar la eliminación de colecciones heredadas. Los usuarios deben volver a iniciar sesión para recibir los nuevos claims `tenantId` y `role`.

## Contención de credenciales

La clave `tools/service-account.json` y los archivos de ejecución de Laravel no se versionan. Si una clave llegó al historial Git, quitar el archivo del último commit no la revoca: elimina esa clave en Google Cloud IAM, crea otra solo si es necesaria y coordina una reescritura del historial antes de volver a publicar el repositorio.

Las reglas pueden probarse localmente con Java 21+ instalado:

```bash
npx firebase-tools emulators:exec --project demo-denzoz-rules --only firestore "npm --prefix tools run test:rules"
```

La atomicidad de transferencias y cancelaciones se prueba con Auth, Firestore y Functions Emulator:

```bash
npx firebase-tools emulators:exec --project demo-denzoz-ops --only auth,firestore,functions "npm --prefix tools run test:functions"
```

Las invariantes de identidad de comprobantes y notas de crédito se validan en Laravel:

```bash
cd apps/api-fact
composer test
```
# D-enzozSaaS
# TuTiendaOS
