<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use App\Services\DatabaseTransaction;
use App\Models\SunatDocument;
use Greenter\Model\DocumentInterface;
use Greenter\Model\Response\BillResult;
use Greenter\Model\Response\CdrResponse;
use Greenter\Model\Response\StatusResult;
use Greenter\Model\Response\SummaryResult;
use Greenter\See;
use Throwable;

final class SunatSender
{
    /** @var list<int> */
    private const BACKOFF_MINUTES = [1, 5, 15, 60, 360];

    public function __construct(private readonly SunatArtifactStore $artifacts) {}

    public function send(See $see, DocumentInterface $document, SunatDocument $record): SunatDocument
    {
        if (! $this->beginAttempt($record)) return $record;
        try {
            $result = $see->send($document);
            $this->storeXml($see, $record);
            if (! $result instanceof BillResult || ! $result->isSuccess()) {
                return $this->scheduleRetry($record, $result?->getError()?->getMessage() ?? 'SUNAT no respondió el envío.');
            }

            $record->sent_at ??= now();

            return $this->applyCdr($record, $result->getCdrResponse(), $result->getCdrZip());
        } catch (Throwable $exception) {
            $this->storeXml($see, $record);
            $this->scheduleRetry($record, 'No se pudo completar el envío a SUNAT.');
            throw $exception;
        }
    }

    public function sendAsync(See $see, DocumentInterface $document, SunatDocument $record): SunatDocument
    {
        if (! $this->beginAttempt($record)) return $record;
        try {
            $result = $see->send($document);
            $this->storeXml($see, $record);
            if (! $result instanceof SummaryResult || ! $result->isSuccess() || ! $result->getTicket()) {
                return $this->scheduleRetry($record, $result?->getError()?->getMessage() ?? 'SUNAT no devolvió un ticket.');
            }

            $record->forceFill([
                'send_lease_until' => null,
                'ticket' => $result->getTicket(),
                'estado_sunat' => 'procesando',
                'mensaje_sunat' => 'Documento enviado; CDR pendiente de consulta.',
                'sent_at' => $record->sent_at ?? now(),
                'next_retry_at' => now()->addMinute(),
            ])->save();

            return $record;
        } catch (Throwable $exception) {
            $this->storeXml($see, $record);
            $this->scheduleRetry($record, 'No se pudo enviar el documento asíncrono a SUNAT.');
            throw $exception;
        }
    }

    public function pollTicket(See $see, SunatDocument $record): SunatDocument
    {
        if (! $record->ticket) {
            return $this->scheduleRetry($record, 'El documento no tiene ticket SUNAT.');
        }

        if (! $this->beginAttempt($record, false)) return $record;
        try {
            $result = $see->getStatus($record->ticket);
            if ($result->getCode() === '98') {
                return $this->scheduleRetry($record, 'SUNAT continúa procesando el documento.', 'procesando');
            }
            if (! $result instanceof StatusResult || ! $result->isSuccess()) {
                return $this->scheduleRetry($record, $result->getError()?->getMessage() ?? 'No se pudo consultar el ticket SUNAT.', 'procesando');
            }

            return $this->applyCdr($record, $result->getCdrResponse(), $result->getCdrZip());
        } catch (Throwable $exception) {
            $this->scheduleRetry($record, 'No se pudo consultar el ticket SUNAT.', 'procesando');
            throw $exception;
        }
    }

    private function beginAttempt(SunatDocument $record, bool $respectBackoff = true): bool
    {
        return DatabaseTransaction::run(function () use ($record, $respectBackoff): bool {
            $current = SunatDocument::query()->lockForUpdate()->findOrFail($record->id);
            if (in_array($current->estado_sunat, ['aceptado', 'observado', 'rechazado', 'requiere_revision'], true)
                || $current->send_lease_until?->isFuture()
                || ($respectBackoff && $current->attempts > 0 && $current->next_retry_at?->isFuture())) {
                $record->setRawAttributes($current->getAttributes(), true);
                return false;
            }
            $current->forceFill([
                'attempts' => $current->attempts + 1,
                'last_attempt_at' => now(),
                'next_retry_at' => now()->addMinutes(5),
                'send_lease_until' => now()->addMinutes(5),
            ])->save();
            $record->setRawAttributes($current->getAttributes(), true);
            return true;
        }, 3);
    }

    private function applyCdr(SunatDocument $record, ?CdrResponse $cdr, ?string $cdrZip): SunatDocument
    {
        if (! $cdr) {
            return $this->scheduleRetry($record, 'SUNAT respondió sin CDR.');
        }

        $code = (int) $cdr->getCode();
        $notes = array_values(array_filter($cdr->getNotes() ?? []));
        $status = match (true) {
            $code === 0 && $notes === [] => 'aceptado',
            $code === 0 || $code >= 4000 => 'observado',
            $code >= 2000 && $code <= 3999 => 'rechazado',
            default => 'requiere_revision',
        };
        $message = trim(implode(' ', array_filter([$cdr->getDescription(), ...$notes])));
        $record->forceFill([
            'send_lease_until' => null,
            'estado_sunat' => $status,
            'mensaje_sunat' => mb_substr($message !== '' ? $message : 'CDR recibido.', 0, 2000),
            'cdr_code' => (string) $cdr->getCode(),
            'next_retry_at' => null,
            'processed_at' => now(),
        ]);

        try {
            $this->artifacts->storeCdr($record, $cdrZip);
            $this->artifacts->storePdf($record);
        } catch (Throwable $exception) {
            report($exception);
        }
        $record->save();

        return $record;
    }

    private function scheduleRetry(SunatDocument $record, string $message, string $retryStatus = 'pendiente'): SunatDocument
    {
        $maxAttempts = max(1, (int) config('sunat.retry_max_attempts', 6));
        if ($record->attempts >= $maxAttempts) {
            $record->forceFill([
                'send_lease_until' => null,
                'estado_sunat' => 'requiere_revision',
                'mensaje_sunat' => mb_substr($message, 0, 2000),
                'next_retry_at' => null,
            ])->save();

            return $record;
        }

        $backoffIndex = min(max($record->attempts - 1, 0), count(self::BACKOFF_MINUTES) - 1);
        $record->forceFill([
            'send_lease_until' => null,
            'estado_sunat' => $retryStatus,
            'mensaje_sunat' => mb_substr($message, 0, 2000),
            'next_retry_at' => now()->addMinutes(self::BACKOFF_MINUTES[$backoffIndex]),
        ])->save();

        return $record;
    }

    private function storeXml(See $see, SunatDocument $record): void
    {
        try {
            $this->artifacts->storeXml($see, $record);
            $record->save();
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
