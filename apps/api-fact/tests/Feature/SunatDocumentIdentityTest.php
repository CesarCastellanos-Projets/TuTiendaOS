<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\SunatDocument;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class SunatDocumentIdentityTest extends TestCase
{
    use RefreshDatabase;

    public function test_credit_note_is_a_separate_document_and_does_not_mutate_original(): void
    {
        $original = SunatDocument::query()->create([
            'ref' => 'sale-1',
            'tipo' => 'boleta',
            'serie' => 'B001',
            'correlativo' => 1,
            'total' => 25.90,
            'estado_sunat' => 'aceptado',
            'mensaje_sunat' => 'Aceptado por SUNAT',
        ]);

        $creditNote = SunatDocument::query()->create([
            'original_document_id' => $original->id,
            'ref' => 'nc-sale-1',
            'tipo' => 'nota_credito',
            'serie' => 'BC01',
            'correlativo' => 1,
            'total' => 25.90,
            'estado_sunat' => 'pendiente',
        ]);

        $original->refresh();

        self::assertNotSame($original->id, $creditNote->id);
        self::assertSame('aceptado', $original->estado_sunat);
        self::assertSame('Aceptado por SUNAT', $original->mensaje_sunat);
        self::assertSame($original->id, $creditNote->originalDocument->id);
        self::assertSame($creditNote->id, $original->creditNote->id);
        self::assertDatabaseCount('sunat_documents', 2);
    }

    public function test_document_reference_is_unique(): void
    {
        SunatDocument::query()->create([
            'ref' => 'sale-unique',
            'tipo' => 'boleta',
            'serie' => 'B001',
            'correlativo' => 1,
        ]);

        $this->expectException(QueryException::class);

        SunatDocument::query()->create([
            'ref' => 'sale-unique',
            'tipo' => 'factura',
            'serie' => 'F001',
            'correlativo' => 1,
        ]);
    }

    public function test_original_document_accepts_only_one_cancellation_credit_note(): void
    {
        $original = SunatDocument::query()->create([
            'ref' => 'sale-2',
            'tipo' => 'factura',
            'serie' => 'F001',
            'correlativo' => 1,
            'estado_sunat' => 'aceptado',
        ]);

        SunatDocument::query()->create([
            'original_document_id' => $original->id,
            'ref' => 'nc-sale-2',
            'tipo' => 'nota_credito',
            'serie' => 'FC01',
            'correlativo' => 1,
        ]);

        $this->expectException(QueryException::class);

        SunatDocument::query()->create([
            'original_document_id' => $original->id,
            'ref' => 'nc-sale-2-retry',
            'tipo' => 'nota_credito',
            'serie' => 'FC01',
            'correlativo' => 2,
        ]);
    }
}
