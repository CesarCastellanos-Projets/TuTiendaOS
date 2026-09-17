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

final class CreditNoteController extends Controller
{
    public function store(Request $request, FiscalPayloadValidator $validator, SunatSender $sender): JsonResponse
    {
        $data = $request->validate([
            'ref' => ['required', 'string', 'max:64'],
            'serie' => ['required', 'string', 'max:4'],
            'correlativo' => ['required', 'integer', 'min:1'],
            'motivo' => ['nullable', 'string', 'max:250'],
        ]);

        $original = SunatDocument::query()
            ->where('serie', $data['serie'])
            ->where('correlativo', $data['correlativo'])
            ->whereIn('tipo', ['boleta', 'factura'])
            ->first();

        if (! $original) {
            return response()->json([
                'ok' => false,
                'message' => "No existe el comprobante {$data['serie']}-{$data['correlativo']}.",
            ], 404);
        }
        if (! in_array($original->estado_sunat, ['aceptado', 'observado'], true)) {
            return response()->json([
                'ok' => false,
                'message' => 'Solo se puede anular un comprobante aceptado por SUNAT.',
            ], 409);
        }

        $record = DB::transaction(function () use ($data, $original, $validator): SunatDocument {
            $existing = SunatDocument::query()->where('ref', $data['ref'])->lockForUpdate()->first();
            if ($existing) {
                if ($existing->tipo !== 'nota_credito' || $existing->original_document_id !== $original->id) {
                    throw new HttpResponseException(response()->json([
                        'ok' => false,
                        'message' => 'La referencia ya pertenece a otro documento fiscal.',
                    ], 409));
                }

                return $existing;
            }

            $existingForOriginal = SunatDocument::query()
                ->where('original_document_id', $original->id)
                ->lockForUpdate()
                ->first();
            if ($existingForOriginal) {
                throw new HttpResponseException(response()->json([
                    'ok' => false,
                    'message' => 'El comprobante ya tiene una nota de crédito asociada.',
                ], 409));
            }

            $serieNc = $original->tipo === 'factura'
                ? (string) config('sunat.serie_nc_factura', 'FC01')
                : (string) config('sunat.serie_nc_boleta', 'BC01');
            $correlativoNc = (int) (SunatDocument::query()
                ->where('tipo', 'nota_credito')
                ->where('serie', $serieNc)
                ->lockForUpdate()
                ->max('correlativo') ?? 0) + 1;

            $payload = [
                'igv_rate' => $original->payload['igv_rate'] ?? 18,
                'afectado_tipo' => $original->tipo === 'factura' ? '01' : '03',
                'afectado_serie' => $original->serie,
                'afectado_correlativo' => $original->correlativo,
                'motivo_codigo' => '01',
                'motivo_texto' => $data['motivo'] ?? 'ANULACION DE LA OPERACION',
                'items' => $original->payload['items'] ?? [],
                'totals' => $original->payload['totals'] ?? null,
            ];

            return SunatDocument::query()->create([
                'original_document_id' => $original->id,
                'ref' => $data['ref'],
                'tipo' => 'nota_credito',
                'serie' => $serieNc,
                'correlativo' => $correlativoNc,
                'cliente_tipo' => $original->cliente_tipo,
                'cliente_numero' => $original->cliente_numero,
                'cliente_nombre' => $original->cliente_nombre,
                'total' => $original->total,
                'estado_sunat' => 'pendiente',
                'mensaje_sunat' => $data['motivo'] ?? 'Anulación de la operación',
                'payload' => $payload,
                'payload_hash' => $validator->hash($payload),
                'next_retry_at' => now(),
            ]);
        });

        if (in_array($record->estado_sunat, ['aceptado', 'observado', 'rechazado', 'requiere_revision'], true)) {
            return $this->responseFor($record);
        }

        try {
            $note = GreenterFactory::creditNote(
                $data,
                $original,
                (int) $record->correlativo,
                (string) $record->serie
            );
            $record = $sender->send(GreenterFactory::see(), $note, $record);
        } catch (\Throwable $exception) {
            report($exception);
            $record->refresh();

            return response()->json([
                'ok' => false,
                'status' => 'pendiente',
                'message' => 'Error generando la nota de crédito; se reintentará.',
                'document' => $this->documentIdentity($record),
            ], 502);
        }

        return $this->responseFor($record);
    }

    private function responseFor(SunatDocument $record): JsonResponse
    {
        return response()->json([
            'ok' => in_array($record->estado_sunat, ['aceptado', 'observado'], true),
            'status' => $record->estado_sunat,
            'message' => $record->mensaje_sunat,
            'document' => $this->documentIdentity($record),
        ]);
    }

    /** @return array{ref: string, serie: string, correlativo: int} */
    private function documentIdentity(SunatDocument $record): array
    {
        return [
            'ref' => (string) $record->ref,
            'serie' => (string) $record->serie,
            'correlativo' => (int) $record->correlativo,
        ];
    }
}
