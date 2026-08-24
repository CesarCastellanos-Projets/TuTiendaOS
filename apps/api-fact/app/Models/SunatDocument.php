<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SunatDocument extends Model
{
    protected $fillable = [
        'ref', 'tipo', 'serie', 'correlativo', 'cliente_tipo', 'cliente_numero',
        'cliente_nombre', 'total', 'estado_sunat', 'mensaje_sunat',
        'xml_path', 'cdr_path', 'pdf_path', 'payload',
    ];

    protected $casts = [
        'payload' => 'array',
        'correlativo' => 'integer',
        'total' => 'decimal:2',
    ];
}
