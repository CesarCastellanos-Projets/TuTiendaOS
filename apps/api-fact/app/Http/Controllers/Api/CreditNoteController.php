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

final class CreditNoteController extends Controller
{
    public function store(Request $request, FiscalPayloadValidator $validator, SunatSender $sender): JsonResponse
    {
        $data = $request->validate([
            'ref' => ['required', 'string', 'max:64'],
            'serie' => ['required', 'string', 'max:4'],
            'correlativo' => ['required', 'integer', 'min:1'],
            'motivo' => ['nullable', 'string', 'max:250'],
            'original' => ['nullable', 'array'],
            'original_summary_ref' => ['required_with:original', 'string', 'max:64'],
            'original.ref' => ['required_with:original', 'string', 'max:64'],
            'original.tipo' => ['required_with:original', 'in:boleta'],
            'original.serie' => ['required_with:original', 'string', 'max:4'],
            'original.correlativo' => ['required_with:original', 'integer', 'min:1'],
            'original.fecha' => ['required_with:original', 'date'],
            'original.igv_rate' => ['required_with:original', 'numeric', 'gt:0', 'lte:100'],
            'original.cliente.tipo' => ['nullable', 'in:-,DNI,RUC,1,6'],
            'original.cliente.numero' => ['nullable', 'string', 'max:15'],
            'original.cliente.nombre' => ['nullable', 'string', 'max:120'],
            'original.items' => ['required_with:original', 'array', 'min:1', 'max:100'],
            'original.items.*.codigo' => ['nullable', 'string', 'max:30'],
            'original.items.*.descripcion' => ['required', 'string', 'max:250'],
            'original.items.*.cantidad' => ['required', 'numeric', 'gt:0'],
            'original.items.*.precio' => ['required', 'numeric', 'min:0'],
            'original.totals.subtotal' => ['required_with:original', 'numeric', 'min:0'],
            'original.totals.igv' => ['required_with:original', 'numeric', 'min:0'],
            'original.totals.total' => ['required_with:original', 'numeric', 'min:0'],
        ]);

        $original = SunatDocument::query()
            ->where('serie', $data['serie'])
            ->where('correlativo', $data['correlativo'])
            ->whereIn('tipo', ['boleta', 'factura'])
            ->first();

        if (! $original && isset($data['original'])) {
            $invoice = $validator->canonicalizeInvoice($data['original']);
            if ($invoice['serie'] !== $data['serie'] || $invoice['correlativo'] !== $data['correlativo']) {
                return response()->json(['ok' => false, 'message' => 'La identidad original no coincide.'], 409);
            }
            $original = \App\Services\Sunat\ConsolidatedReceipt::restore($invoice, $validator, $data['original_summary_ref']);
        }

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

        $record = DatabaseTransaction::run(function () use ($data, $original, $validator): SunatDocument {
            $series = $original->tipo === 'factura'
                ? (string) config('sunat.serie_nc_factura', 'FC01')
                : (string) config('sunat.serie_nc_boleta', 'BC01');
            FiscalSequence::lock('nota_credito', $series);
            $original = SunatDocument::query()->lockForUpdate()->findOrFail($original->id);
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
            $correlativoNc = FiscalSequence::next('nota_credito', $serieNc);

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
