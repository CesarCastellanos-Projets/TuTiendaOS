<?php

declare(strict_types=1);

namespace App\Services;

use Closure;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class DatabaseTransaction
{
    public static function run(Closure $work, int $attempts = 1): mixed
    {
        $connection = DB::connection();
        $database = $connection->getDatabaseName();
        if ($connection->getDriverName() !== 'sqlite' || $database === ':memory:' || $connection->transactionLevel() > 0) {
            return $connection->transaction($work, $attempts);
        }
        // SQLite en PHP 8.2 no permite elegir BEGIN IMMEDIATE mediante PDO; se evita competir al ascender de lectura a escritura.
        $lock = fopen($database.'.transaction.lock', 'c');
        if ($lock === false) {
            throw new RuntimeException('No se pudo reservar la transacción local.');
        }
        try {
            if (! flock($lock, LOCK_EX)) {
                throw new RuntimeException('No se pudo reservar la transacción local.');
            }

            return $connection->transaction($work, $attempts);
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
}
