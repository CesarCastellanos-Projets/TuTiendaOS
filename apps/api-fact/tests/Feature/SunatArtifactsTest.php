<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\SunatDocument;
use App\Services\Sunat\SunatArtifactStore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class SunatArtifactsTest extends TestCase
{
    use RefreshDatabase;

    public function test_persists_cdr_zip_and_pdf_evidence(): void
    {
        Storage::fake('local');
        $document = SunatDocument::query()->create([
            'ref' => 'artifact-sale',
            'tipo' => 'factura',
            'serie' => 'F001',
            'correlativo' => 20,
            'total' => 118,
            'estado_sunat' => 'aceptado',
            'cdr_code' => '0',
            'mensaje_sunat' => 'Aceptado',
            'payload' => [
                'items' => [[
                    'descripcion' => 'Producto', 'cantidad' => 1, 'precio' => 118, 'total' => 118,
                ]],
                'totals' => ['subtotal' => 100, 'igv' => 18, 'total' => 118],
            ],
        ]);
        $store = app(SunatArtifactStore::class);
        $store->storeCdr($document, 'ZIP-CONTENT');
        $store->storePdf($document);
        $document->save();

        self::assertNotNull($document->cdr_path);
        self::assertNotNull($document->pdf_path);
        Storage::disk('local')->assertExists($document->cdr_path);
        Storage::disk('local')->assertExists($document->pdf_path);
        self::assertStringStartsWith('%PDF', Storage::disk('local')->get($document->pdf_path));
    }
}
