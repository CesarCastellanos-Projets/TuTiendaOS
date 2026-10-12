<?php

declare(strict_types=1);

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

final class ApiServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        RateLimiter::for('tributary-api', function (Request $request): array {
            return [
                Limit::perMinute(max(1, (int) config('sunat.global_requests_per_minute', 60)))->by('service'),
                Limit::perMinute(max(1, (int) config('sunat.tenant_requests_per_minute', 60)))
                    ->by('tenant:'.trim((string) $request->header('X-TENANT-ID'))),
            ];
        });
    }
}
