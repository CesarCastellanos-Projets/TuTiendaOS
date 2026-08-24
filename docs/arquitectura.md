# Arquitectura

## Vista general

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  PWA (React + Firebase)     │ HTTPS  │  Motor tributario (Laravel)  │
│  ├─ Admin  /admin           │──────▶ │  ├─ Greenter: XML UBL + firma│
│  ├─ POS    /pos             │ token  │  ├─ SUNAT beta/producción    │
│  └─ Trabajador /w           │◀────── │  ├─ CDR → estado             │
│  Firestore · Auth · Storage │ estado │  └─ PDF (dompdf)             │
└─────────────────────────────┘        └──────────────────────────────┘
        │            │
   Cloud Functions  APIS.net.pe (DNI/RUC, cacheado en clients/)
   createUser,
   lookupClient
```

## Flujo de una venta

1. POS escanea (pistola USB = teclado, o cámara ZXing) → busca en Dexie/Firestore.
2. Cliente: boleta por defecto. Factura exige RUC + razón social; DNI obligatorio si total ≥ umbral (`company.minBoletaSinDni`, default S/700). Lookup vía `lookupClient` (server-side).
3. Cobro: transacción Firestore — decrementa `product_stocks` (falla si stock insuficiente), escribe `sales` con items embebidos, incrementa correlativo en `counters`.
4. SUNAT **asíncrono y soft-fail**: `services/sunat.ts` llama al microservicio. Si responde OK → `sunatStatus: aceptado|rechazado`; si falla/timeout/offline → `pendiente`. La venta nunca se bloquea.
5. Ventas < S/5 sin comprobante exigido → `consolidated: true`; el cierre diario genera boleta de resumen (`POST /api/summaries`).

## Anulaciones

POS marca la venta con `anulationRequest{reason, by}` → Admin revisa en Comprobantes → autoriza → Laravel emite **nota de crédito** Greenter vinculada → `status: anulada`.

## Resumen diario (SUNAT)

Boletas deben consolidarse: endpoint `POST /api/summaries` con las ventas del día agrupadas. Las ventas < S/5 sin comprobante se agrupan en una boleta única.

## Microservicio tributario (apps/api-fact)

- Laravel 11 (slim) + `greenter/greenter`.
- Auth simple: header `X-API-TOKEN` contra `.env` (un solo tenant). Sin sesiones.
- Endpoints:
  - `POST /api/invoices` — boleta/factura individual
  - `POST /api/credit-notes` — nota de crédito
  - `POST /api/summaries` — resumen diario
  - `POST /api/voided` — comunicación de baja
  - `GET /api/documents/{id}` — estado + CDR + PDF
- Guarda XML/CDR firmados en `storage/app/sunat/{RUC}/...`; en Firestore solo referencias y estado (nunca el XML completo).
- Entorno configurable `SUNAT_ENV=beta|produccion`; certificado .pfx en storage (fuera del repo).

## Offline / PWA

- Service worker (vite-plugin-pwa) cachea app shell; catálogo en IndexedDB.
- Venta sin internet: se guarda localmente como pendiente de sincronizar (cola Dexie) — el stock se concilia al reconectar.

## Costos Firebase

Ver `docs/modelo-datos.md`: paginación, denormalización, caché, alertas de presupuesto en GCP.
