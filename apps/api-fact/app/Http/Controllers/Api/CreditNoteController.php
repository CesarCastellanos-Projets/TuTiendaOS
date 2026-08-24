<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;
use App\Services\Sunat\GreenterFactory;
use App\Services\Sunat\SunatSender;
use Illuminate\Http\Request;

class CreditNoteController extends Controller
{
    /**
     * Nota de crédito que anula una boleta/factura previa.
     * Greenter: NotaCREDITO tipo 07, motivo catálogo 20 (anulación).
     */
    public function store(Request $request)
    {
        $data = $request->validate([
            'ref' => 'required|string|max:64',
            'serie' => 'required|string|max:4',
            'correlativo' => 'required|integer|min:1',
            'motivo' => 'nullable|string|max:250',
        ]);

        $original = SunatDocument::where('serie', $data['serie'])
            ->where('correlativo', $data['correlativo'])
            ->whereIn('tipo', ['boleta', 'factura'])
            ->first();

        if (! $original) {
            return response()->json([
                'ok' => false,
                'message' => "No existe el comprobante {$data['serie']}-{$data['correlativo']}.",
            ], 404);
        }

        $serieNc = $original->tipo === 'factura' ? config('sunat.serie_nc_factura', 'FC01') : config('sunat.serie_nc_boleta', 'BC01');
        $correlativoNc = (SunatDocument::where('tipo', 'nota_credito')->where('serie', $serieNc)->max('correlativo') ?? 0) + 1;

        $record = SunatDocument::updateOrCreate(
            ['ref' => $data['ref']],
            [
                'tipo' => 'nota_credito',
                'serie' => $serieNc,
                'correlativo' => $correlativoNc,
                'cliente_tipo' => $original->cliente_tipo,
                'cliente_numero' => $original->cliente_numero,
                'cliente_nombre' => $original->cliente_nombre,
                'total' => $original->total,
                'estado_sunat' => 'pendiente',
                'mensaje_sunat' => $data['motivo'] ?? 'Anulación de la operación',
                'payload' => [
                    'afectado_tipo' => $original->tipo === 'factura' ? '01' : '03',
                    'afectado_serie' => $original->serie,
                    'afectado_correlativo' => $original->correlativo,
                    'motivo_codigo' => '01',
                    'motivo_texto' => $data['motivo'] ?? 'ANULACION DE LA OPERACION',
                    'items' => $original->payload['items'] ?? [],
                    'totals' => $original->payload['totals'] ?? null,
                ],
            ]
        );

        try {
            $note = GreenterFactory::creditNote($data, $original, $correlativoNc, $serieNc);
            $record = SunatSender::send(GreenterFactory::see(), $note, $record);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'ok' => false,
                'status' => 'pendiente',
                'message' => 'Error generando la nota de crédito; se reintentará.',
            ], 502);
        }

        return response()->json([
            'ok' => true,
            'status' => $record->estado_sunat,
            'message' => $record->mensaje_sunat,
        ]);
    }
}
