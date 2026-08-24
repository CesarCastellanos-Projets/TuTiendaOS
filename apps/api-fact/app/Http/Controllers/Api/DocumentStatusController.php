<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SunatDocument;

class DocumentStatusController extends Controller
{
    public function show(string $ref)
    {
        $document = SunatDocument::where('ref', $ref)->latest()->first();

        if (! $document) {
            return response()->json(['ok' => false, 'message' => 'No encontrado'], 404);
        }

        return response()->json([
            'ok' => true,
            'tipo' => $document->tipo,
            'serie' => $document->serie,
            'correlativo' => $document->correlativo,
            'status' => $document->estado_sunat,
            'message' => $document->mensaje_sunat,
            'xml_url' => $document->xml_path ? \Storage::url($document->xml_path) : null,
            'cdr_url' => $document->cdr_path ? \Storage::url($document->cdr_path) : null,
        ]);
    }
}
