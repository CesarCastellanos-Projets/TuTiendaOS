<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'service' => "D'ENZOZ motor tributario",
    'entorno' => config('sunat.entorno'),
    'status' => 'ok'
]));
