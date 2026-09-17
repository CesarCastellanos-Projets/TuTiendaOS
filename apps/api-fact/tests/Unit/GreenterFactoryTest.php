<?php

declare(strict_types=1);

namespace Tests\Unit;

use App\Services\Sunat\GreenterFactory;
use Tests\TestCase;

final class GreenterFactoryTest extends TestCase
{
    public function test_invoice_uses_dynamic_igv_rate_and_current_greenter_fields(): void
    {
        $invoice = GreenterFactory::invoice([
            'tipo' => 'factura',
            'serie' => 'F001',
            'correlativo' => 10,
            'fecha' => '2026-09-16T10:00:00-05:00',
            'igv_rate' => 10,
            'cliente' => ['tipo' => 'RUC', 'numero' => '20123456789', 'nombre' => 'CLIENTE SAC'],
            'items' => [[
                'codigo' => 'P1', 'descripcion' => 'Producto', 'cantidad' => 2, 'precio' => 55, 'total' => 110,
            ]],
            'totals' => ['subtotal' => 100, 'igv' => 10, 'total' => 110],
        ]);

        $detail = $invoice->getDetails()[0];
        self::assertSame(10.0, $detail->getPorcentajeIgv());
        self::assertSame(100.0, $detail->getMtoBaseIgv());
        self::assertSame(10.0, $detail->getIgv());
        self::assertSame(110.0, $invoice->getMtoImpVenta());
    }

    public function test_builds_summary_and_voided_documents(): void
    {
        $summary = GreenterFactory::summary([
            'fecha' => '2026-09-15',
            'boletas' => [[
                'serie' => 'B001', 'correlativo' => 1, 'igv_rate' => 18,
                'cliente' => ['tipo' => '-', 'numero' => '', 'nombre' => ''],
                'totals' => ['subtotal' => 10, 'igv' => 1.8, 'total' => 11.8],
            ]],
        ], 1);
        $voided = GreenterFactory::voided([
            'fecha' => '2026-09-15',
            'documentos' => [[
                'tipo' => 'factura', 'serie' => 'F001', 'correlativo' => 8, 'motivo' => 'ERROR EN DATOS',
            ]],
        ], 1);

        self::assertSame('001', $summary->getCorrelativo());
        self::assertSame(18.0, $summary->getDetails()[0]->getPorcentajeIgv());
        self::assertSame('00001', $voided->getCorrelativo());
        self::assertSame('01', $voided->getDetails()[0]->getTipoDoc());
    }
}
