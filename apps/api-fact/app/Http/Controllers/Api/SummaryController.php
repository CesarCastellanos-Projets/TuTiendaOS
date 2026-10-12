<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\DatabaseTransaction;
use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use App\Services\Sunat\FiscalPayloadValidator;
use App\Services\Sunat\GreenterFactory;
use App\Services\Sunat\SunatSender;
use App\Services\Sunat\FiscalSequence;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SummaryController extends Controller
{
    public function store(Request $request, FiscalPayloadValidator $validator, SunatSender $sender): JsonResponse
    {
        $validated = $request->validate([
            'ref' => ['required', 'string', 'max:64'],
            'fecha' => ['required', 'date_format:Y-m-d'],
            'boletas' => ['required', 'array', 'min:1', 'max:200'],
            'boletas.*.ref' => ['required', 'string', 'max:128'],
            'boletas.*.serie' => ['required', 'string', 'max:4'],
            'boletas.*.correlativo' => ['required', 'integer', 'min:1'],
            'boletas.*.igv_rate' => ['required', 'numeric', 'gt:0', 'lte:100'],
            'boletas.*.cliente.tipo' => ['nullable', 'in:-,DNI,RUC,1,6'],
            'boletas.*.cliente.numero' => ['nullable', 'string', 'max:15'],
            'boletas.*.cliente.nombre' => ['nullable', 'string', 'max:120'],
            'boletas.*.totals.subtotal' => ['required', 'numeric', 'min:0'],
            'boletas.*.totals.igv' => ['required', 'numeric', 'min:0'],
            'boletas.*.totals.total' => ['required', 'numeric', 'min:0'],
        ]);
        $data = $validator->canonicalizeSummary($validated);
        $payloadHash = $validator->hash($data);
        $reference = $data['ref'];

        $record = DatabaseTransaction::run(function () use ($data, $payloadHash, $reference, $validator): SunatDocument {
            FiscalSequence::lock('resumen', 'RC');
            $existing = SunatDocument::query()->where('ref', $reference)->lockForUpdate()->first();
            if ($existing) {
                $existingHash = $existing->payload_hash ?? $validator->hash((array) $existing->payload);
                if ($existingHash !== $payloadHash) {
                    throw new HttpResponseException(response()->json([
                        'ok' => false,
                        'message' => 'El resumen del día ya existe con otro contenido.',
                    ], 409));
                }

                return $existing;
            }
            $correlative = FiscalSequence::next('resumen', 'RC');

            return SunatDocument::query()->create([
                'ref' => $reference,
                'tipo' => 'resumen',
                'serie' => 'RC',
                'correlativo' => $correlative,
                'total' => collect($data['boletas'])->sum('totals.total'),
                'estado_sunat' => 'pendiente',
                'mensaje_sunat' => 'Resumen diario listo para envío.',
                'payload' => $data,
                'payload_hash' => $payloadHash,
                'next_retry_at' => now(),
            ]);
        });

        if (in_array($record->estado_sunat, ['aceptado', 'observado', 'rechazado', 'procesando', 'requiere_revision'], true)) {
            return $this->responseFor($record);
        }
        if ($record->attempts > 0 && $record->next_retry_at?->isFuture()) {
            return $this->responseFor($record, 202);
        }

        try {
            $summary = GreenterFactory::summary($record->payload, $record->correlativo);
            $record = $sender->sendAsync(GreenterFactory::see(), $summary, $record);
        } catch (\Throwable $exception) {
            report($exception);
            $record->refresh();
        }

        return $this->responseFor($record, $record->estado_sunat === 'pendiente' ? 502 : 200);
    }

    private function responseFor(SunatDocument $record, int $status = 200): JsonResponse
    {
        return response()->json([
            'ok' => in_array($record->estado_sunat, ['procesando', 'aceptado', 'observado'], true),
            'status' => $record->estado_sunat,
            'message' => $record->mensaje_sunat,
            'document' => [
                'ref' => $record->ref,
                'serie' => $record->serie,
                'correlativo' => $record->correlativo,
                'ticket' => $record->ticket,
            ],
        ], $status);
    }
}
