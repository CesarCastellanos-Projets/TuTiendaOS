<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use App\Models\SunatDocument;
use Illuminate\Http\Exceptions\HttpResponseException;

final class ConsolidatedReceipt
{
    public static function restore(array $invoice, FiscalPayloadValidator $validator, string $summaryRef): ?SunatDocument
    {
        $summaries = SunatDocument::query()->where('tipo', 'resumen')
            ->whereIn('estado_sunat', ['aceptado', 'observado'])
            ->where('ref', $summaryRef)->limit(1)->get();
        $accepted = $summaries->first(function (SunatDocument $summary) use ($invoice): bool {
            foreach ($summary->payload['boletas'] ?? [] as $receipt) {
                if ($receipt['ref'] === $invoice['ref'] && $receipt['serie'] === $invoice['serie']
                    && (int) $receipt['correlativo'] === $invoice['correlativo']
                    && $receipt['totals'] == $invoice['totals']) return true;
            }
            return false;
        });
        if ($accepted) {
            $original = SunatDocument::query()->firstOrCreate(['ref' => $invoice['ref']], [
                'tipo' => 'boleta', 'serie' => $invoice['serie'], 'correlativo' => $invoice['correlativo'],
                'cliente_tipo' => $invoice['cliente']['tipo'], 'cliente_numero' => $invoice['cliente']['numero'] ?: null,
                'cliente_nombre' => $invoice['cliente']['nombre'] ?: null, 'total' => $invoice['totals']['total'],
                'estado_sunat' => $accepted->estado_sunat, 'mensaje_sunat' => 'Aceptada mediante '.$accepted->ref,
                'payload' => $invoice, 'payload_hash' => $validator->hash($invoice), 'next_retry_at' => null,
            ]);
            if ($original->tipo !== 'boleta' || $original->payload_hash !== $validator->hash($invoice)) {
                throw new HttpResponseException(response()->json(['ok' => false, 'message' => 'El contenido fiscal original no coincide.'], 409));
            }
        }
        return $original ?? null;
    }
}
