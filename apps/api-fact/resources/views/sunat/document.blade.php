<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: DejaVu Sans, sans-serif; color: #172033; font-size: 11px; }
        h1 { font-size: 18px; margin: 0 0 6px; }
        h2 { font-size: 13px; margin: 18px 0 6px; }
        .muted { color: #64748b; }
        .grid { width: 100%; border-collapse: collapse; margin-top: 12px; }
        .grid th, .grid td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; }
        .grid th { background: #f1f5f9; }
        .right { text-align: right !important; }
        .status { display: inline-block; padding: 4px 8px; background: #e2e8f0; font-weight: bold; }
    </style>
</head>
<body>
    @php($payload = $document->payload ?? [])
    @php($totals = $payload['totals'] ?? [])
    <h1>{{ strtoupper(str_replace('_', ' ', $document->tipo)) }} ELECTRÓNICA</h1>
    <div><strong>{{ $document->serie }}-{{ $document->correlativo }}</strong></div>
    <div class="muted">Referencia interna: {{ $document->ref }}</div>
    <p><span class="status">SUNAT: {{ strtoupper($document->estado_sunat) }}</span></p>

    @if($document->cliente_numero || $document->cliente_nombre)
        <h2>Cliente</h2>
        <div>{{ $document->cliente_tipo }} {{ $document->cliente_numero }} · {{ $document->cliente_nombre }}</div>
    @endif

    @if(!empty($payload['items']))
        <h2>Detalle</h2>
        <table class="grid">
            <thead><tr><th>Descripción</th><th class="right">Cantidad</th><th class="right">P. unitario</th><th class="right">Total</th></tr></thead>
            <tbody>
            @foreach($payload['items'] as $item)
                <tr>
                    <td>{{ $item['descripcion'] ?? '' }}</td>
                    <td class="right">{{ number_format((float) ($item['cantidad'] ?? 0), 3) }}</td>
                    <td class="right">S/ {{ number_format((float) ($item['precio'] ?? 0), 2) }}</td>
                    <td class="right">S/ {{ number_format((float) ($item['total'] ?? (($item['cantidad'] ?? 0) * ($item['precio'] ?? 0))), 2) }}</td>
                </tr>
            @endforeach
            </tbody>
        </table>
    @endif

    <table class="grid">
        <tr><th>Subtotal</th><td class="right">S/ {{ number_format((float) ($totals['subtotal'] ?? 0), 2) }}</td></tr>
        <tr><th>IGV</th><td class="right">S/ {{ number_format((float) ($totals['igv'] ?? 0), 2) }}</td></tr>
        <tr><th>Total</th><td class="right"><strong>S/ {{ number_format((float) ($totals['total'] ?? $document->total), 2) }}</strong></td></tr>
    </table>

    <h2>Trazabilidad</h2>
    <div>Ticket: {{ $document->ticket ?: 'No aplica' }}</div>
    <div>CDR: {{ $document->cdr_code ?: 'Pendiente' }}</div>
    <div>{{ $document->mensaje_sunat }}</div>
</body>
</html>
