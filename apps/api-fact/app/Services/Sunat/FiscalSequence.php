<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use App\Services\DatabaseTransaction;
use App\Models\SunatDocument;
use Illuminate\Support\Facades\DB;

final class FiscalSequence
{
    public static function lock(string $type, string $series): object
    {
        $key = ['tenant_id' => (string) config('sunat.tenant_id', 'denzoz'), 'tipo' => $type, 'serie' => $series];
        DB::table('sunat_sequences')->insertOrIgnore([...$key, 'current' => 0]);

        return DB::table('sunat_sequences')->where($key)->lockForUpdate()->first();
    }

    public static function next(string $type, string $series): int
    {
        return DatabaseTransaction::run(function () use ($type, $series): int {
            $key = ['tenant_id' => (string) config('sunat.tenant_id', 'denzoz'), 'tipo' => $type, 'serie' => $series];
            $counter = self::lock($type, $series);
            $existing = (int) SunatDocument::query()->where('tipo', $type)->where('serie', $series)->max('correlativo');
            $next = max((int) $counter->current, $existing) + 1;
            DB::table('sunat_sequences')->where($key)->update(['current' => $next]);

            return $next;
        }, 3);
    }
}
