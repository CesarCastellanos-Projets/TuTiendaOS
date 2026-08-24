# D'ENZOZ — Sistema de gestión y facturación

SaaS para bodega/variety store peruana ("todo por un sol"): POS, inventario multi-almacén, roles (Admin / POS / Trabajador) y facturación electrónica SUNAT vía microservicio Laravel + Greenter.

## Arquitectura

```
apps/web          PWA React 19 + Vite + TS estricto + Tailwind v4
                  ├─ /admin    Dashboard, inventario, transferencias, SUNAT, usuarios
                  ├─ /pos      Venta, caja, historial, reposición
                  └─ /w        Trabajador: consulta de precios, incidencias
functions         Cloud Functions v2 (Node 20): createUser, lookupClient (DNI/RUC)
apps/api-fact     Microservicio Laravel 11 + Greenter (XML UBL, firma, CDR)
firebase.json     Hosting, Firestore, Storage, reglas e índices
```

- **Comercial** en Firebase (Auth + Firestore + Storage). Reglas en `firestore.rules`.
- **Tributario** aislado en Laravel: la PWA le habla por REST (`src/services/sunat.ts`). Si SUNAT cae, la venta sigue; el comprobante queda `pendiente` y se reenvía.

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

Requiere `APISPERU_TOKEN` (apis.net.pe) como secret:
`firebase functions:secrets:set APISPERU_TOKEN`

### 3. Microservicio tributario

```bash
cd apps/api-fact
composer install
cp .env.example .env   # certificado .pfx, credenciales SOL, endpoint beta/producción
php artisan serve
```

Ver `docs/arquitectura.md` para el flujo completo de comprobantes y `docs/modelo-datos.md` para las colecciones Firestore.
# D-enzozSaaS
