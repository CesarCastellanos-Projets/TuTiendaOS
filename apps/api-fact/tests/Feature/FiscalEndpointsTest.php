<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\SunatDocument;
use App\Services\Sunat\FiscalPayloadValidator;
use App\Services\Sunat\SunatConfigHelper;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class FiscalEndpointsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('sunat.api_token', 'test-api-token-with-more-than-32-bytes');
        SunatConfigHelper::setTenant('tenant-test');
        $this->withHeader('X-TENANT-ID', 'tenant-test');
    }

    public function test_invoice_endpoint_rejects_manipulated_totals_before_sunat(): void
    {
        $payload = $this->invoicePayload();
        $payload['totals']['total'] = 1;

        $this->withHeader('X-API-TOKEN', 'test-api-token-with-more-than-32-bytes')
            ->postJson('/api/invoices', $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['totals.total']);

        self::assertDatabaseCount('sunat_documents', 0);
    }

    public function test_summary_request_is_idempotent_while_ticket_is_processing(): void
    {
        $payload = [
            'ref' => 'resumen:2026-09-15:batch-1',
            'fecha' => '2026-09-15',
            'boletas' => [[
                'ref' => 'sale-1',
                'serie' => 'B001',
                'correlativo' => 1,
                'igv_rate' => 18,
                'cliente' => ['tipo' => '-', 'numero' => '', 'nombre' => ''],
                'totals' => ['subtotal' => 10, 'igv' => 1.8, 'total' => 11.8],
            ]],
        ];
        $validator = app(FiscalPayloadValidator::class);
        $canonical = $validator->canonicalizeSummary($payload);
        SunatDocument::query()->create([
            'ref' => $payload['ref'],
            'tipo' => 'resumen',
            'serie' => 'RC',
            'correlativo' => 1,
            'total' => 11.8,
            'estado_sunat' => 'procesando',
            'ticket' => '123456789',
            'payload' => $canonical,
            'payload_hash' => $validator->hash($canonical),
        ]);

        $this->withHeader('X-API-TOKEN', 'test-api-token-with-more-than-32-bytes')
            ->postJson('/api/summaries', $payload)
            ->assertOk()
            ->assertJsonPath('status', 'procesando')
            ->assertJsonPath('document.ticket', '123456789');

        self::assertDatabaseCount('sunat_documents', 1);
    }

    public function test_invoice_that_requires_manual_review_is_not_sent_again(): void
    {
        $payload = $this->invoicePayload();
        $validator = app(FiscalPayloadValidator::class);
        $canonical = $validator->canonicalizeInvoice($payload);
        SunatDocument::query()->create([
            'ref' => $canonical['ref'],
            'tipo' => $canonical['tipo'],
            'serie' => $canonical['serie'],
            'correlativo' => $canonical['correlativo'],
            'total' => $canonical['totals']['total'],
            'estado_sunat' => 'requiere_revision',
            'mensaje_sunat' => 'Se agotaron los reintentos automáticos.',
            'payload' => $canonical,
            'payload_hash' => $validator->hash($canonical),
            'attempts' => 6,
        ]);

        $this->withHeader('X-API-TOKEN', 'test-api-token-with-more-than-32-bytes')
            ->postJson('/api/invoices', $payload)
            ->assertOk()
            ->assertJsonPath('status', 'requiere_revision');

        self::assertDatabaseCount('sunat_documents', 1);
        self::assertSame(6, SunatDocument::query()->firstOrFail()->attempts);
    }

    public function test_same_reference_is_isolated_between_tenants(): void
    {
        SunatConfigHelper::setTenant('tenant-a');
        SunatDocument::query()->create([
            'ref' => 'shared-ref', 'tipo' => 'factura', 'serie' => 'F001',
            'correlativo' => 1, 'total' => 10, 'estado_sunat' => 'aceptado', 'payload' => [],
        ]);
        SunatConfigHelper::setTenant('tenant-b');
        SunatDocument::query()->create([
            'ref' => 'shared-ref', 'tipo' => 'factura', 'serie' => 'F001',
            'correlativo' => 1, 'total' => 20, 'estado_sunat' => 'observado', 'payload' => [],
        ]);

        self::assertSame(20.0, (float) SunatDocument::query()->where('ref', 'shared-ref')->firstOrFail()->total);
        $this->withHeaders([
            'X-API-TOKEN' => 'test-api-token-with-more-than-32-bytes',
            'X-TENANT-ID' => 'tenant-b',
        ])->getJson('/api/documents/shared-ref')
            ->assertOk()
            ->assertJsonPath('status', 'observado');
        SunatConfigHelper::setTenant('tenant-a');
        self::assertSame(10.0, (float) SunatDocument::query()->where('ref', 'shared-ref')->firstOrFail()->total);
        $this->withHeaders([
            'X-API-TOKEN' => 'test-api-token-with-more-than-32-bytes',
            'X-TENANT-ID' => 'tenant-a',
        ])->getJson('/api/documents/shared-ref')
            ->assertOk()
            ->assertJsonPath('status', 'aceptado');
    }

    /** @return array<string, mixed> */
    private function invoicePayload(): array
    {
        return [
            'ref' => 'sale-endpoint',
            'tipo' => 'factura',
            'serie' => 'F001',
            'correlativo' => 1,
            'fecha' => '2026-09-16T10:00:00-05:00',
            'igv_rate' => 18,
            'cliente' => ['tipo' => 'RUC', 'numero' => '20123456789', 'nombre' => 'CLIENTE SAC'],
            'items' => [[
                'codigo' => 'P1', 'descripcion' => 'Producto', 'cantidad' => 1, 'precio' => 118,
            ]],
            'totals' => ['subtotal' => 100, 'igv' => 18, 'total' => 118],
        ];
    }
}
