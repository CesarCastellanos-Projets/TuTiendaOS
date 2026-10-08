<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

final class SunatDocument extends Model
{
    protected $fillable = [
        'tenant_id', 'original_document_id', 'ref', 'tipo', 'serie', 'correlativo', 'cliente_tipo', 'cliente_numero',
        'cliente_nombre', 'total', 'estado_sunat', 'mensaje_sunat',
        'xml_path', 'cdr_path', 'pdf_path', 'payload', 'payload_hash',
        'ticket', 'cdr_code', 'attempts', 'last_attempt_at', 'next_retry_at',
        'sent_at', 'processed_at', 'send_lease_until',
    ];

    protected static function booted(): void
    {
        self::addGlobalScope('tenant', function (Builder $builder): void {
            $builder->where($builder->qualifyColumn('tenant_id'), (string) config('sunat.tenant_id', 'denzoz'));
        });
        self::creating(function (self $document): void {
            $document->tenant_id ??= (string) config('sunat.tenant_id', 'denzoz');
        });
    }

    protected $casts = [
        'payload' => 'array',
        'correlativo' => 'integer',
        'total' => 'decimal:2',
        'attempts' => 'integer',
        'last_attempt_at' => 'immutable_datetime',
        'next_retry_at' => 'immutable_datetime',
        'send_lease_until' => 'immutable_datetime',
        'sent_at' => 'immutable_datetime',
        'processed_at' => 'immutable_datetime',
    ];

    public function originalDocument(): BelongsTo
    {
        return $this->belongsTo(self::class, 'original_document_id');
    }

    public function creditNote(): HasOne
    {
        return $this->hasOne(self::class, 'original_document_id');
    }
}
