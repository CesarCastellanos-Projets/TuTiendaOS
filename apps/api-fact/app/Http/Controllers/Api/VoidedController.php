<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use Illuminate\Http\Request;

class VoidedController extends Controller
{
    /**
     * Comunicación de baja: para boletas/facturas emitidas hace más
     * de 7 días (las recientes van por nota de crédito).
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'fecha' => 'required|date_format:Y-m-d',
            'documentos' => 'required|array|min:1|max:100',
            'documentos.*.tipo' => 'required|in:boleta,factura',
            'documentos.*.serie' => 'required|string|max:4',
            'documentos.*.correlativo' => 'required|integer|min:1',
            'motivo' => 'nullable|string|max:250',
        ]);

        $record = SunatDocument::create([
            'ref' => $data['fecha'].'-baja',
            'tipo' => 'baja',
            'serie' => 'RA',
            'correlativo' => (SunatDocument::where('tipo', 'baja')->max('correlativo') ?? 0) + 1,
            'estado_sunat' => 'pendiente',
            'mensaje_sunat' => $data['motivo'] ?? 'Comunicación de baja en cola',
            'payload' => ['fecha_generacion' => now()->format('Y-m-d'), 'documentos' => $data['documentos']],
        ]);

        return response()->json([
            'ok' => true,
            'status' => 'pendiente',
            'message' => "Baja {$record->serie}-{$record->correlativo} registrada.",
        ]);
    }
}
