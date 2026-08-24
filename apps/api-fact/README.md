# Microservicio tributario (apps/api-fact)

Laravel 11 slim + Greenter. Este esqueleto incluye la estructura propia del
proyecto; el vendor y archivos base de Laravel se instalan con Composer.

## Instalación

```bash
cd apps/api-fact
composer create-project laravel/laravel tmp-laravel   # una sola vez
cp -Rn tmp-laravel/{config,database/seeders,tests} .  # base opcional
rm -rf tmp-laravel
composer install          # instala Laravel + Greenter + DomPDF
cp .env.example .env      # RUC, SOL, certificado, token API
php artisan migrate       # crea sunat_documents (sqlite por defecto)
php artisan storage:link  # para servir XML/CDR/PDF en dev
```

Coloca tu certificado digital en `storage/app/sunat/certificate.pfx`
(queda fuera de git).

## Configurar en la PWA

En **Admin → SUNAT** guarda:
- URL del motor: `http://localhost:8000` (dev) o tu dominio
- Token API: el mismo de `API_FACT_TOKEN`

## Endpoints (header `X-API-TOKEN`)

| Método | Ruta | Uso |
|--------|------|-----|
| POST | `/api/invoices` | Emite boleta/factura, firma XML, envía a SUNAT, devuelve CDR |
| POST | `/api/credit-notes` | Nota de crédito (anulación autorizada) |
| POST | `/api/summaries` | Resumen diario RC (boletas consolidadas < S/5) |
| POST | `/api/voided` | Comunicación de baja RA (>7 días) |
| GET | `/api/documents/{ref}` | Estado + rutas XML/CDR |

## Pendientes para producción

1. Implementar el envío real de `nota_credito`, `resumen` y `baja` con Greenter (`Summary` / `Voided` models) — hoy quedan en cola.
2. Generar PDF del ticket con DomPDF (`barryvdh/laravel-dompdf`) y guardarlo en `pdf_path`.
3. Comando `php artisan sunat:resumenes` al cierre de cada día.
4. Certificado de producción + usuario SOL secundario con prefijo RUC.
5. HTTPS obligatorio detrás de un reverse proxy (Caddy/Nginx).
