# Arquitectura

## Vista general

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  PWA (React + Firebase)     │ HTTPS  │  Motor tributario (Laravel)  │
│  ├─ Admin  /admin           │Functions│ ├─ Greenter: XML UBL + firma│
│  ├─ POS    /pos             │ token  │  ├─ SUNAT beta/producción    │
│  └─ Trabajador /w           │◀────── │  ├─ CDR → estado             │
│  Firestore · Auth · Storage │ estado │  └─ PDF (dompdf)             │
└─────────────────────────────┘        └──────────────────────────────┘
        │            │
   Cloud Functions  APIS.net.pe (DNI/RUC, cacheado por tenant)
   createUser,
   lookupClient
```

## Flujo de una venta

1. POS escanea (pistola USB = teclado, o cámara ZXing) → consulta el repositorio compartido: IndexedDB primero y sincronización delta por `updatedAt`.
2. Cliente: boleta por defecto. Factura exige RUC + razón social; DNI obligatorio si total ≥ umbral (`company.minBoletaSinDni`, default S/700). Lookup vía `lookupClient` (server-side).
3. Cobro: transacción Firestore — decrementa `product_stocks` (falla si stock insuficiente), escribe `sales` con items embebidos, incrementa correlativo en `counters`.
4. SUNAT **asíncrono y soft-fail**: una Function obtiene la venta registrada, recalcula importes y llama al microservicio. Si falla/timeout → `pendiente`; el scheduler reintenta con backoff acotado. La venta nunca se bloquea.
5. Ventas < S/5 sin comprobante exigido → `consolidated: true`; el cierre diario genera boleta de resumen (`POST /api/summaries`).

## Anulaciones

POS marca la venta con `anulationRequest{reason, by}` → Admin revisa en Comprobantes → autoriza → Laravel emite **nota de crédito** Greenter vinculada → `status: anulada`.

## Resumen diario (SUNAT)

Las boletas consolidadas se consultan desde Firestore por fecha; el navegador solo envía la fecha. Laravel genera y envía el resumen, guarda el ticket y consulta posteriormente el CDR.

## Microservicio tributario (apps/api-fact)

- Laravel 11 (slim) + `greenter/greenter`.
- Auth de servicio: `X-API-TOKEN`; aislamiento obligatorio mediante `X-TENANT-ID`. Sin sesiones.
- Endpoints:
  - `POST /api/invoices` — boleta/factura individual
  - `POST /api/credit-notes` — nota de crédito
  - `POST /api/summaries` — resumen diario
  - `POST /api/voided` — comunicación de baja
  - `GET /api/documents/{id}` — estado, ticket y disponibilidad de XML/CDR/PDF
- Guarda configuración, XML, CDR ZIP y PDF bajo un directorio por tenant; SQLite aplica alcance global por `tenant_id`.
- Entorno configurable `SUNAT_ENV=beta|produccion`; certificado .pfx en storage (fuera del repo).

## Offline / PWA

- Service worker (vite-plugin-pwa) cachea app shell; catálogo en IndexedDB.
- Venta sin internet: se guarda localmente como pendiente de sincronizar (cola Dexie) — el stock se concilia al reconectar.

## Costos Firebase

Ver `docs/modelo-datos.md`: paginación, denormalización, caché, alertas de presupuesto en GCP.
