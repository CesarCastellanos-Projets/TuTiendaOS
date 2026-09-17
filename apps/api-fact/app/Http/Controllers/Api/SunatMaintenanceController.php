<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Sunat\SunatRetryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SunatMaintenanceController extends Controller
{
    public function retryPending(Request $request, SunatRetryService $service): JsonResponse
    {
        $limit = max(1, min((int) $request->input('limit', 5), 10));
        $documents = $service->retryDue($limit);

        return response()->json([
            'ok' => true,
            'processed' => count($documents),
            'documents' => $documents,
        ]);
    }
}
