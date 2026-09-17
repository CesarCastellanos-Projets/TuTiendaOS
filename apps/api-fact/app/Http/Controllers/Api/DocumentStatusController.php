<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use Illuminate\Http\JsonResponse;

final class DocumentStatusController extends Controller
{
    public function show(string $document): JsonResponse
    {
        $record = SunatDocument::query()->where('ref', $document)->first();

        if (! $record) {
            return response()->json(['ok' => false, 'message' => 'No encontrado'], 404);
        }

        return response()->json([
            'ok' => true,
            'tipo' => $record->tipo,
            'serie' => $record->serie,
            'correlativo' => $record->correlativo,
            'status' => $record->estado_sunat,
            'message' => $record->mensaje_sunat,
            'ticket' => $record->ticket,
            'cdr_code' => $record->cdr_code,
            'attempts' => $record->attempts,
            'last_attempt_at' => $record->last_attempt_at?->toIso8601String(),
            'next_retry_at' => $record->next_retry_at?->toIso8601String(),
            'sent_at' => $record->sent_at?->toIso8601String(),
            'processed_at' => $record->processed_at?->toIso8601String(),
            'artifacts' => [
                'xml' => $record->xml_path !== null,
                'cdr' => $record->cdr_path !== null,
                'pdf' => $record->pdf_path !== null,
            ],
        ]);
    }
}
