<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use Illuminate\Http\Request;

class SummaryController extends Controller
{
    /**
     * Resumen diario de boletas (obligatorio para consolidar ventas < S/5
     * y boletas del día). Se programa vía comando al cierre de cada día.
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'fecha' => 'required|date_format:Y-m-d',
            'boletas' => 'required|array|min:1',
            'boletas.*.serie' => 'required|string|max:4',
            'boletas.*.correlativo' => 'required|integer|min:1',
            'boletas.*.total' => 'required|numeric|min:0',
        ]);

        $record = SunatDocument::create([
            'ref' => $data['fecha'],
            'tipo' => 'resumen',
            'serie' => 'RC',
            'correlativo' => (SunatDocument::where('tipo', 'resumen')->max('correlativo') ?? 0) + 1,
            'total' => collect($data['boletas'])->sum('total'),
            'estado_sunat' => 'pendiente',
            'mensaje_sunat' => 'Resumen diario en cola de envío',
            'payload' => ['fecha_generacion' => now()->format('Y-m-d'), 'boletas' => $data['boletas']],
        ]);

        return response()->json([
            'ok' => true,
            'status' => 'pendiente',
            'message' => "Resumen {$record->serie}-{$record->correlativo} registrado.",
        ]);
    }
}
