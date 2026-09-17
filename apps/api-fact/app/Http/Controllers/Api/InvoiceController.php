<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use App\Services\Sunat\FiscalPayloadValidator;
use App\Services\Sunat\GreenterFactory;
use App\Services\Sunat\SunatSender;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class InvoiceController extends Controller
{
    public function store(Request $request, FiscalPayloadValidator $validator, SunatSender $sender): JsonResponse
    {
        $validated = $request->validate([
            'ref' => ['required', 'string', 'max:64'],
            'tipo' => ['required', 'in:boleta,factura'],
            'serie' => ['required', 'string', 'max:4'],
            'correlativo' => ['required', 'integer', 'min:1'],
            'fecha' => ['nullable', 'date'],
            'igv_rate' => ['required', 'numeric', 'gt:0', 'lte:100'],
            'cliente.tipo' => ['nullable', 'in:-,DNI,RUC,1,6'],
            'cliente.numero' => ['nullable', 'string', 'max:15'],
            'cliente.nombre' => ['nullable', 'string', 'max:120'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.codigo' => ['nullable', 'string', 'max:30'],
            'items.*.descripcion' => ['required', 'string', 'max:250'],
            'items.*.cantidad' => ['required', 'numeric', 'gt:0'],
            'items.*.precio' => ['required', 'numeric', 'min:0'],
            'totals.subtotal' => ['required', 'numeric', 'min:0'],
            'totals.igv' => ['required', 'numeric', 'min:0'],
            'totals.total' => ['required', 'numeric', 'min:0'],
        ]);
        $data = $validator->canonicalizeInvoice($validated);
        $payloadHash = $validator->hash($data);

        $record = SunatDocument::query()->where('ref', $data['ref'])->first();
        if ($record && (
            $record->tipo !== $data['tipo']
            || $record->serie !== $data['serie']
            || $record->correlativo !== $data['correlativo']
            || ($record->payload_hash ?? $validator->hash((array) $record->payload)) !== $payloadHash
        )) {
            return response()->json(['ok' => false, 'message' => 'La referencia ya pertenece a otro contenido fiscal.'], 409);
        }

        $record ??= SunatDocument::query()->create([
            'ref' => $data['ref'],
            'tipo' => $data['tipo'],
            'serie' => $data['serie'],
            'correlativo' => $data['correlativo'],
            'cliente_tipo' => $data['cliente']['tipo'],
            'cliente_numero' => $data['cliente']['numero'] ?: null,
            'cliente_nombre' => $data['cliente']['nombre'] ?: null,
            'total' => $data['totals']['total'],
            'estado_sunat' => 'pendiente',
            'payload' => $data,
            'payload_hash' => $payloadHash,
            'next_retry_at' => now(),
        ]);

        if (in_array($record->estado_sunat, ['aceptado', 'observado', 'rechazado', 'requiere_revision'], true)) {
            return $this->responseFor($record);
        }

        try {
            $record = $sender->send(GreenterFactory::see(), GreenterFactory::invoice($data), $record);
        } catch (\Throwable $exception) {
            report($exception);
            $record->refresh();
        }

        return $this->responseFor($record, $record->estado_sunat === 'pendiente' ? 502 : 200);
    }

    private function responseFor(SunatDocument $record, int $status = 200): JsonResponse
    {
        return response()->json([
            'ok' => in_array($record->estado_sunat, ['aceptado', 'observado'], true),
            'status' => $record->estado_sunat,
            'message' => $record->mensaje_sunat,
            'document' => [
                'ref' => $record->ref,
                'serie' => $record->serie,
                'correlativo' => $record->correlativo,
                'hasXml' => $record->xml_path !== null,
                'hasCdr' => $record->cdr_path !== null,
                'hasPdf' => $record->pdf_path !== null,
            ],
        ], $status);
    }
}
