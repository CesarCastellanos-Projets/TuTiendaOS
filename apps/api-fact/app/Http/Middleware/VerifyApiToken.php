<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = (string) $request->header('X-API-TOKEN');
        $configured = (string) config('sunat.api_token');
        $isValid = $configured !== '' && $token !== '' && hash_equals($configured, $token);

        if (! $isValid) {
            return response()->json([
                'ok' => false,
                'message' => 'Token inválido',
            ], 401);
        }

        return $next($request);
    }
}
