<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Sunat\SunatConfigHelper;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ResolveTenant
{
    public function handle(Request $request, Closure $next): Response
    {
        $tenantId = trim((string) $request->header('X-TENANT-ID'));
        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $tenantId)) {
            return new JsonResponse([
                'ok' => false,
                'message' => 'La empresa solicitante no es válida.',
            ], 400);
        }

        SunatConfigHelper::setTenant($tenantId);

        return $next($request);
    }
}
