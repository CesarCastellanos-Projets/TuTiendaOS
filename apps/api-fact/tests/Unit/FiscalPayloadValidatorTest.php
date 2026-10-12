<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Sunat\FiscalPayloadValidator;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

final class FiscalPayloadValidatorTest extends TestCase
{
    public function test_recalculates_totals_with_the_requested_igv_rate(): void
    {
        $payload = $this->invoicePayload();
        $canonical = app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload);

        self::assertSame(100.0, $canonical['totals']['subtotal']);
        self::assertSame(10.0, $canonical['totals']['igv']);
        self::assertSame(110.0, $canonical['totals']['total']);
        self::assertSame(10.0, $canonical['igv_rate']);
    }

    public function test_rejects_totals_manipulated_by_the_caller(): void
    {
        $payload = $this->invoicePayload();
        $payload['totals']['total'] = 1;

        $this->expectException(ValidationException::class);
        app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload);
    }

    public function test_invoice_requires_valid_ruc_and_business_name(): void
    {
        $payload = $this->invoicePayload();
        $payload['cliente'] = ['tipo' => 'DNI', 'numero' => '12345678', 'nombre' => 'Persona'];

        $this->expectException(ValidationException::class);
        app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload);
    }

    public function test_high_value_receipt_requires_dni(): void
    {
        config()->set('sunat.min_boleta_dni', 100);
        $payload = $this->invoicePayload();
        $payload['tipo'] = 'boleta';
        $payload['serie'] = 'B001';
        $payload['cliente'] = ['tipo' => '-', 'numero' => '', 'nombre' => ''];

        $this->expectException(ValidationException::class);
        app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload);
    }

    public function test_receipt_dni_boundary_is_inclusive(): void
    {
        config()->set('sunat.min_boleta_dni', 700);
        $payload = $this->receiptPayload(699.99);
        self::assertSame(699.99, app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload)['totals']['total']);

        $this->expectException(ValidationException::class);
        app(FiscalPayloadValidator::class)->canonicalizeInvoice($this->receiptPayload(700));
    }

    public function test_current_contract_uses_the_api_threshold_for_an_anonymous_800_receipt(): void
    {
        $payload = $this->receiptPayload(800);
        config()->set('sunat.min_boleta_dni', 1000);
        self::assertSame(800.0, app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload)['totals']['total']);

        config()->set('sunat.min_boleta_dni', 700);
        $this->expectException(ValidationException::class);
        app(FiscalPayloadValidator::class)->canonicalizeInvoice($payload);
    }

    /** @return array<string, mixed> */
    private function receiptPayload(float $total): array
    {
        $payload = $this->invoicePayload();
        $payload['tipo'] = 'boleta';
        $payload['serie'] = 'B001';
        $payload['cliente'] = ['tipo' => '-', 'numero' => '', 'nombre' => ''];
        $payload['igv_rate'] = 18;
        $payload['items'][0]['cantidad'] = 1;
        $payload['items'][0]['precio'] = $total;
        $subtotal = round($total / 1.18, 2);
        $payload['totals'] = ['subtotal' => $subtotal, 'igv' => round($total - $subtotal, 2), 'total' => $total];

        return $payload;
    }

    /** @return array<string, mixed> */
    private function invoicePayload(): array
    {
        return [
            'ref' => 'sale-validated',
            'tipo' => 'factura',
            'serie' => 'F001',
            'correlativo' => 1,
            'fecha' => '2026-09-16T10:00:00-05:00',
            'igv_rate' => 10,
            'cliente' => ['tipo' => 'RUC', 'numero' => '20123456789', 'nombre' => 'CLIENTE SAC'],
            'items' => [[
                'codigo' => 'P1',
                'descripcion' => 'Producto',
                'cantidad' => 2,
                'precio' => 55,
            ]],
            'totals' => ['subtotal' => 100, 'igv' => 10, 'total' => 110],
        ];
    }
}
