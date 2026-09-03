<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use App\Services\Sunat\GreenterFactory;
use App\Services\Sunat\SunatSender;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class InvoiceController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'ref' => 'required|string|max:64',
            'tipo' => 'required|in:boleta,factura',
            'serie' => 'required|string|max:4',
            'correlativo' => 'required|integer|min:1',
            'fecha' => 'nullable|date',
            'cliente.tipo' => 'nullable|in:-,DNI,RUC,1,6',
            'cliente.numero' => 'nullable|string|max:15',
            'cliente.nombre' => 'nullable|string|max:120',
            'items' => 'required|array|min:1|max:200',
            'items.*.codigo' => 'nullable|string|max:30',
            'items.*.descripcion' => 'required|string|max:250',
            'items.*.cantidad' => 'required|numeric|min:0.01',
            'items.*.precio' => 'required|numeric|min:0',
            'totals.subtotal' => 'required|numeric|min:0',
            'totals.igv' => 'required|numeric|min:0',
            'totals.total' => 'required|numeric|min:0',
        ]);

        $record = SunatDocument::updateOrCreate(
            ['ref' => $data['ref']],
            [
                'tipo' => $data['tipo'],
                'serie' => $data['serie'],
                'correlativo' => $data['correlativo'],
                'cliente_tipo' => $data['cliente']['tipo'] ?? '-',
                'cliente_numero' => $data['cliente']['numero'] ?? null,
                'cliente_nombre' => $data['cliente']['nombre'] ?? null,
                'total' => $data['totals']['total'],
                'estado_sunat' => 'pendiente',
                'payload' => $data,
            ]
        );

        try {
            $invoice = GreenterFactory::invoice($data);
            $record = SunatSender::send(GreenterFactory::see(), $invoice, $record);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'ok' => false,
                'status' => 'pendiente',
                'message' => 'Error generando el comprobante; se reintentará.',
            ], 502);
        }

        return response()->json([
            'ok' => true,
            'status' => $record->estado_sunat,
            'message' => $record->mensaje_sunat,
        ]);
    }
}
