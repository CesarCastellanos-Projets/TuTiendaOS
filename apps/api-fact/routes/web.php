<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'service' => "D'ENZOZ motor tributario",
        'entorno' => config('sunat.entorno', 'beta'),
        'status' => 'online',
        'timestamp' => date('c')
    ]);
});
