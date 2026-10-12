<?php

declare(strict_types=1);

use App\Models\SunatDocument;
use App\Services\Sunat\SunatSender;
use Greenter\Model\Response\SummaryResult;
use Greenter\Model\Summary\Summary;
use Greenter\See;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';
[$script, $directory, $id, $worker] = $argv;
if (getenv('APP_ENV') !== 'testing' || ! str_starts_with(realpath($directory), realpath(sys_get_temp_dir()).DIRECTORY_SEPARATOR.'denzoz-api-parallel-')) {
    throw new RuntimeException('La prueba solo admite una base temporal aislada.');
}
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
config()->set('database.connections.sqlite.database', $directory.'/test.sqlite');
config()->set('sunat.tenant_id', 'parallel-local');
DB::purge('sqlite');
$record = SunatDocument::query()->findOrFail((int) $id);
$see = Mockery::mock(See::class);
$see->shouldReceive('send')->andReturnUsing(function () use ($directory, $worker): SummaryResult {
    file_put_contents($directory.'/sends.log', json_encode(['worker' => $worker, 'event' => 'start', 'time' => microtime(true)])."\n", FILE_APPEND | LOCK_EX);
    usleep(600000);
    file_put_contents($directory.'/sends.log', json_encode(['worker' => $worker, 'event' => 'end', 'time' => microtime(true)])."\n", FILE_APPEND | LOCK_EX);

    return (new SummaryResult)->setSuccess(true)->setTicket('local-ticket-'.$worker);
});
$see->shouldReceive('getFactory')->andReturnNull();
touch($directory.'/ready-'.$worker);
$deadline = microtime(true) + 10;
while (! file_exists($directory.'/go')) {
    if (microtime(true) > $deadline) {
        throw new RuntimeException('No se abrió la barrera local.');
    }
    usleep(10000);
}
$result = app(SunatSender::class)->sendAsync($see, new Summary, $record);
echo json_encode(['id' => $result->id, 'attempts' => $result->attempts, 'status' => $result->estado_sunat]);
Mockery::close();
