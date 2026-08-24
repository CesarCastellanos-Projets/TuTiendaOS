<?php

use App\Http\Controllers\Api\CreditNoteController;
use App\Http\Controllers\Api\DocumentStatusController;
use App\Http\Controllers\Api\HealthCheckController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\SummaryController;
use App\Http\Controllers\Api\SunatConfigController;
use App\Http\Controllers\Api\VoidedController;
use Illuminate\Support\Facades\Route;

Route::middleware('api.token')->group(function () {
    Route::post('/health-check', [HealthCheckController::class, 'check']);
    Route::post('/config/certificate', [SunatConfigController::class, 'uploadCertificate']);
    Route::post('/config/demo-mode', [SunatConfigController::class, 'useDemoMode']);
    Route::post('/invoices', [InvoiceController::class, 'store']);
    Route::post('/credit-notes', [CreditNoteController::class, 'store']);
    Route::post('/summaries', [SummaryController::class, 'store']);
    Route::post('/voided', [VoidedController::class, 'store']);
    Route::get('/documents/{document}', [DocumentStatusController::class, 'show']);
});
