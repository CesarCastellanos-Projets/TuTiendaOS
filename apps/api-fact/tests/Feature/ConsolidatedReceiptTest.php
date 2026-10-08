<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\SunatDocument;
use App\Services\Sunat\ConsolidatedReceipt;
use App\Services\Sunat\FiscalPayloadValidator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ConsolidatedReceiptTest extends TestCase
{
    use RefreshDatabase;

    private function invoice(): array
    {
        return app(FiscalPayloadValidator::class)->canonicalizeInvoice([
            'ref' => 'consolidated-sale', 'tipo' => 'boleta', 'serie' => 'B001', 'correlativo' => 1,
            'fecha' => '2026-10-08T12:00:00-05:00', 'igv_rate' => 18,
            'items' => [['codigo' => 'P1', 'descripcion' => 'Producto', 'cantidad' => 1, 'precio' => 1.18]],
            'totals' => ['subtotal' => 1, 'igv' => 0.18, 'total' => 1.18],
        ]);
    }

    public function test_restores_only_proven_accepted_receipts_and_is_idempotent(): void
    {
        $invoice = $this->invoice();
        SunatDocument::query()->create(['ref' => 'summary-accepted', 'tipo' => 'resumen', 'serie' => 'RC', 'correlativo' => 1,
            'estado_sunat' => 'aceptado', 'payload' => ['boletas' => [$invoice]]]);
        $first = ConsolidatedReceipt::restore($invoice, app(FiscalPayloadValidator::class), 'summary-accepted');
        $second = ConsolidatedReceipt::restore($invoice, app(FiscalPayloadValidator::class), 'summary-accepted');
        self::assertSame($first->id, $second->id);
        self::assertSame('aceptado', $first->estado_sunat);
        self::assertEquals($invoice['items'], $first->payload['items']);
        self::assertDatabaseCount('sunat_documents', 2);
    }

    public function test_pending_summaries_and_different_totals_are_not_acceptance_proof(): void
    {
        $invoice = $this->invoice();
        $summary = SunatDocument::query()->create(['ref' => 'summary-pending', 'tipo' => 'resumen', 'serie' => 'RC', 'correlativo' => 1,
            'estado_sunat' => 'pendiente', 'payload' => ['boletas' => [$invoice]]]);
        self::assertNull(ConsolidatedReceipt::restore($invoice, app(FiscalPayloadValidator::class), 'summary-pending'));
        $summary->update(['estado_sunat' => 'aceptado']);
        $invoice['totals']['total'] = 2.36;
        self::assertNull(ConsolidatedReceipt::restore($invoice, app(FiscalPayloadValidator::class), 'summary-pending'));
        self::assertDatabaseCount('sunat_documents', 1);
    }

    public function test_another_tenants_summary_cannot_restore_a_receipt(): void
    {
        config()->set('sunat.tenant_id', 'tenant-a');
        $invoice = $this->invoice();
        SunatDocument::query()->create(['ref' => 'summary-a', 'tipo' => 'resumen', 'serie' => 'RC', 'correlativo' => 1,
            'estado_sunat' => 'aceptado', 'payload' => ['boletas' => [$invoice]]]);
        config()->set('sunat.tenant_id', 'tenant-b');
        self::assertNull(ConsolidatedReceipt::restore($invoice, app(FiscalPayloadValidator::class), 'summary-a'));
    }
}
