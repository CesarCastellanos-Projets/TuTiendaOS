<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->header('X-API-TOKEN');

        if (! $token || ! hash_equals((string) config('sunat.api_token'), $token)) {
            return response()->json([
                'ok' => false,
                'message' => 'Token inválido',
            ], 401);
        }

        return $next($request);
    }
}
