<?php

use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\VerifyApiToken;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Routing\Middleware\ThrottleRequests;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up'
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->prependToPriorityList(ThrottleRequests::class, ResolveTenant::class);
        $middleware->prependToPriorityList(ResolveTenant::class, VerifyApiToken::class);
        $middleware->alias([
            'api.token' => VerifyApiToken::class,
            'tenant' => ResolveTenant::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
