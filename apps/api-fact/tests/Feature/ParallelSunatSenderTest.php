<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Models\SunatDocument;
use App\Services\DatabaseTransaction;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class ParallelSunatSenderTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        parent::setUp();
        $this->directory = sys_get_temp_dir().'/denzoz-api-parallel-'.bin2hex(random_bytes(8));
        mkdir($this->directory);
        touch($this->directory.'/test.sqlite');
        config()->set('database.connections.parallel_test', array_replace(config('database.connections.sqlite'), ['database' => $this->directory.'/test.sqlite']));
        DB::setDefaultConnection('parallel_test');
        config()->set('sunat.tenant_id', 'parallel-local');
        Artisan::call('migrate', ['--database' => 'parallel_test', '--force' => true]);
    }

    protected function tearDown(): void
    {
        DB::purge('parallel_test');
        foreach (glob($this->directory.'/*') as $file) {
            unlink($file);
        }
        rmdir($this->directory);
        parent::tearDown();
    }

    private function document(string $ref, int $sequence): SunatDocument
    {
        return SunatDocument::query()->create(['ref' => $ref, 'tipo' => 'resumen', 'serie' => 'RC', 'correlativo' => $sequence,
            'estado_sunat' => 'pendiente', 'payload' => []]);
    }

    private function runWorkers(array $ids): array
    {
        $workers = [];
        try {
            foreach ($ids as $index => $id) {
                $process = proc_open([PHP_BINARY, base_path('tests/Support/parallel-sender.php'), $this->directory, (string) $id, (string) $index],
                    [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(),
                    array_replace(getenv(), ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $this->directory.'/test.sqlite']));
                self::assertIsResource($process);
                fclose($pipes[0]);
                $workers[] = ['process' => $process, 'pipes' => $pipes];
            }
            $deadline = microtime(true) + 10;
            while (count(glob($this->directory.'/ready-*')) !== count($ids)) {
                if (microtime(true) > $deadline) {
                    self::fail('Los procesos PHP no arrancaron.');
                }
                usleep(10000);
            }
            touch($this->directory.'/go');
            foreach ($workers as $index => $worker) {
                $output = stream_get_contents($worker['pipes'][1]);
                $errors = stream_get_contents($worker['pipes'][2]);
                fclose($worker['pipes'][1]);
                fclose($worker['pipes'][2]);
                $code = proc_close($worker['process']);
                unset($workers[$index]);
                self::assertSame(0, $code, $errors.$output);
                self::assertJson($output, $errors.$output);
                $result = json_decode($output, true, flags: JSON_THROW_ON_ERROR);
                self::assertSame($ids[$index], $result['id'], $output);
                self::assertSame(1, $result['attempts'], $output);
            }

            return array_map(fn (string $line): array => json_decode($line, true, flags: JSON_THROW_ON_ERROR), file($this->directory.'/sends.log', FILE_IGNORE_NEW_LINES));
        } finally {
            foreach ($workers as $worker) {
                proc_terminate($worker['process']);
                foreach ($worker['pipes'] as $pipe) {
                    if (is_resource($pipe)) {
                        fclose($pipe);
                    }
                }
                proc_close($worker['process']);
            }
        }
    }

    public function test_parallel_attempts_send_one_document_only_once(): void
    {
        $document = $this->document('same-document', 1);
        $events = $this->runWorkers([$document->id, $document->id]);
        self::assertCount(2, $events);
        self::assertSame(1, $document->fresh()->attempts);
        self::assertSame('procesando', $document->fresh()->estado_sunat);
    }

    public function test_different_documents_can_wait_on_mocked_sunat_concurrently(): void
    {
        $one = $this->document('first-document', 1);
        $two = $this->document('second-document', 2);
        $events = $this->runWorkers([$one->id, $two->id]);
        self::assertCount(4, $events, json_encode($events));
        self::assertSame('start', $events[0]['event']);
        self::assertSame('start', $events[1]['event']);
        self::assertSame(1, $one->fresh()->attempts);
        self::assertSame(1, $two->fresh()->attempts);
    }

    public function test_failed_nested_transaction_releases_the_file_lock(): void
    {
        try {
            DatabaseTransaction::run(fn () => DatabaseTransaction::run(function (): void {
                throw new \LogicException('Fallo simulado');
            }));
            self::fail('La excepción debe propagarse.');
        } catch (\LogicException $exception) {
            self::assertSame('Fallo simulado', $exception->getMessage());
        }
        self::assertSame(0, DB::connection()->transactionLevel());
        $document = DatabaseTransaction::run(fn () => $this->document('after-failure', 1));
        self::assertNotNull($document->id);
    }
}
