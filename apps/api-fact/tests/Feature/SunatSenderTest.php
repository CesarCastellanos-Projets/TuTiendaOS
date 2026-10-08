<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\SunatDocument;
use App\Services\Sunat\GreenterFactory;
use App\Services\Sunat\SunatSender;
use Greenter\Model\Response\CdrResponse;
use Greenter\Model\Response\StatusResult;
use Greenter\Model\Response\SummaryResult;
use Greenter\See;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

final class SunatSenderTest extends TestCase
{
    use RefreshDatabase;

    public function test_an_active_lease_and_backoff_prevent_another_send(): void
    {
        $document = SunatDocument::query()->create([
            'ref' => 'summary-leased', 'tipo' => 'resumen', 'serie' => 'RC', 'correlativo' => 1,
            'estado_sunat' => 'pendiente', 'attempts' => 1, 'send_lease_until' => now()->addMinute(),
            'next_retry_at' => now()->subMinute(), 'payload' => [],
        ]);
        $see = Mockery::mock(See::class);
        $see->shouldNotReceive('send');
        $summary = new \Greenter\Model\Summary\Summary;
        $sender = app(SunatSender::class);
        $sender->sendAsync($see, $summary, $document);
        self::assertSame(1, $document->fresh()->attempts);
        $document->update(['send_lease_until' => null, 'next_retry_at' => now()->addMinute()]);
        $sender->sendAsync($see, $summary, $document);
        self::assertSame(1, $document->fresh()->attempts);
    }

    public function test_async_flow_persists_ticket_then_cdr_and_artifacts(): void
    {
        Storage::fake('local');
        $document = SunatDocument::query()->create([
            'ref' => 'resumen:test',
            'tipo' => 'resumen',
            'serie' => 'RC',
            'correlativo' => 1,
            'total' => 11.8,
            'estado_sunat' => 'pendiente',
            'payload' => [
                'fecha' => '2026-09-15',
                'boletas' => [[
                    'ref' => 'sale-1', 'serie' => 'B001', 'correlativo' => 1, 'igv_rate' => 18,
                    'cliente' => ['tipo' => '-', 'numero' => '', 'nombre' => ''],
                    'totals' => ['subtotal' => 10, 'igv' => 1.8, 'total' => 11.8],
                ]],
            ],
        ]);
        $summary = GreenterFactory::summary($document->payload, 1);
        $sendResult = (new SummaryResult)->setSuccess(true)->setTicket('ticket-123');
        $see = Mockery::mock(See::class);
        $see->shouldReceive('send')->once()->with($summary)->andReturn($sendResult);
        $see->shouldReceive('getFactory')->once()->andReturnNull();

        $sender = app(SunatSender::class);
        $document = $sender->sendAsync($see, $summary, $document);

        self::assertSame('procesando', $document->estado_sunat);
        self::assertSame('ticket-123', $document->ticket);
        self::assertSame(1, $document->attempts);
        self::assertNotNull($document->next_retry_at);

        $cdr = (new CdrResponse)
            ->setCode('0')
            ->setDescription('Aceptado')
            ->setNotes([]);
        $status = (new StatusResult)
            ->setCode('0')
            ->setSuccess(true)
            ->setCdrResponse($cdr)
            ->setCdrZip('ZIP-CONTENT');
        $pollSee = Mockery::mock(See::class);
        $pollSee->shouldReceive('getStatus')->once()->with('ticket-123')->andReturn($status);

        $document = $sender->pollTicket($pollSee, $document);

        self::assertSame('aceptado', $document->estado_sunat);
        self::assertSame('0', $document->cdr_code);
        self::assertSame(2, $document->attempts);
        self::assertNotNull($document->processed_at);
        Storage::disk('local')->assertExists($document->cdr_path);
        Storage::disk('local')->assertExists($document->pdf_path);
    }
}
