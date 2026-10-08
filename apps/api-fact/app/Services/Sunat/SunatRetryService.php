<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use App\Models\SunatDocument;
use Illuminate\Support\Facades\DB;
use Throwable;

final class SunatRetryService
{
    public function __construct(private readonly SunatSender $sender) {}

    /** @return list<array{ref: string, type: string, status: string, message: string|null, saleRefs: list<string>}> */
    public function retryDue(int $limit = 5): array
    {
        $documents = SunatDocument::query()
            ->whereIn('tipo', ['resumen', 'baja'])
            ->whereIn('estado_sunat', ['pendiente', 'procesando'])
            ->whereNotNull('next_retry_at')
            ->where('next_retry_at', '<=', now())
            ->orderBy('next_retry_at')
            ->limit(max(1, min($limit, 10)))
            ->get();

        $results = [];
        foreach ($documents as $candidate) {
            $document = $this->claim($candidate->id);
            if (! $document) {
                continue;
            }

            try {
                if ($document->ticket && $document->estado_sunat === 'procesando') {
                    $document = $this->sender->pollTicket(GreenterFactory::see(), $document);
                } elseif ($document->tipo === 'resumen') {
                    $summary = GreenterFactory::summary($document->payload, $document->correlativo);
                    $document = $this->sender->sendAsync(GreenterFactory::see(), $summary, $document);
                } else {
                    $voided = GreenterFactory::voided($document->payload, $document->correlativo);
                    $document = $this->sender->sendAsync(GreenterFactory::see(), $voided, $document);
                }
            } catch (Throwable $exception) {
                report($exception);
                $document->refresh();
            }

            $results[] = $this->result($document);
        }

        return $results;
    }

    private function claim(int $id): ?SunatDocument
    {
        return DB::transaction(function () use ($id): ?SunatDocument {
            $document = SunatDocument::query()->lockForUpdate()->find($id);
            if (! $document || ! in_array($document->estado_sunat, ['pendiente', 'procesando'], true)) {
                return null;
            }
            if (! $document->next_retry_at || $document->next_retry_at->isFuture()) {
                return null;
            }

            return $document;
        });
    }

    /** @return array{ref: string, type: string, status: string, message: string|null, saleRefs: list<string>} */
    private function result(SunatDocument $document): array
    {
        $saleRefs = [];
        if (in_array($document->tipo, ['resumen', 'baja'], true)) {
            $items = $document->tipo === 'resumen'
                ? ($document->payload['boletas'] ?? [])
                : ($document->payload['documentos'] ?? []);
            foreach ($items as $receipt) {
                if (isset($receipt['ref']) && is_string($receipt['ref'])) {
                    $saleRefs[] = $receipt['ref'];
                }
            }
        }

        return [
            'ref' => (string) $document->ref,
            'type' => (string) $document->tipo,
            'status' => (string) $document->estado_sunat,
            'message' => $document->mensaje_sunat,
            'saleRefs' => $saleRefs,
        ];
    }
}
