<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use App\Services\Sunat\FiscalPayloadValidator;
use App\Services\Sunat\GreenterFactory;
use App\Services\Sunat\SunatSender;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class VoidedController extends Controller
{
    public function store(Request $request, FiscalPayloadValidator $validator, SunatSender $sender): JsonResponse
    {
        $validated = $request->validate([
            'fecha' => ['required', 'date_format:Y-m-d'],
            'documentos' => ['required', 'array', 'min:1', 'max:100'],
            'documentos.*.ref' => ['required', 'string', 'max:128'],
            'documentos.*.tipo' => ['required', 'in:boleta,factura'],
            'documentos.*.serie' => ['required', 'string', 'max:4'],
            'documentos.*.correlativo' => ['required', 'integer', 'min:1'],
            'documentos.*.motivo' => ['nullable', 'string', 'max:250'],
            'motivo' => ['nullable', 'string', 'max:250'],
        ]);
        $data = $validator->canonicalizeVoided($validated);
        $payloadHash = $validator->hash($data);
        $reference = 'baja:'.$data['fecha'].':'.substr($payloadHash, 0, 16);

        $record = DB::transaction(function () use ($data, $payloadHash, $reference, $validator): SunatDocument {
            $existing = SunatDocument::query()->where('ref', $reference)->lockForUpdate()->first();
            if ($existing) {
                $existingHash = $existing->payload_hash ?? $validator->hash((array) $existing->payload);
                if ($existingHash !== $payloadHash) {
                    throw new HttpResponseException(response()->json([
                        'ok' => false,
                        'message' => 'La referencia de baja ya existe con otro contenido.',
                    ], 409));
                }

                return $existing;
            }
            $correlative = (int) (SunatDocument::query()->where('tipo', 'baja')->lockForUpdate()->max('correlativo') ?? 0) + 1;

            return SunatDocument::query()->create([
                'ref' => $reference,
                'tipo' => 'baja',
                'serie' => 'RA',
                'correlativo' => $correlative,
                'total' => 0,
                'estado_sunat' => 'pendiente',
                'mensaje_sunat' => 'Comunicación de baja lista para envío.',
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
            $voided = GreenterFactory::voided($record->payload, $record->correlativo);
            $record = $sender->sendAsync(GreenterFactory::see(), $voided, $record);
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
