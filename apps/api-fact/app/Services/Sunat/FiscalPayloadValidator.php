<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use Illuminate\Validation\ValidationException;

final class FiscalPayloadValidator
{
    private const TOLERANCE = 0.01;

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function canonicalizeInvoice(array $data): array
    {
        $ratePercent = $this->ratePercent($data['igv_rate'] ?? null);
        $items = [];
        $total = 0.0;

        foreach ($data['items'] as $index => $item) {
            $quantity = (float) $item['cantidad'];
            $price = round((float) $item['precio'], 2);
            $lineTotal = $this->round2($quantity * $price);
            $total = $this->round2($total + $lineTotal);
            $items[] = [
                'codigo' => isset($item['codigo']) ? (string) $item['codigo'] : '',
                'descripcion' => trim((string) $item['descripcion']),
                'cantidad' => $quantity,
                'precio' => $price,
                'total' => $lineTotal,
            ];

            if ($quantity <= 0 || $price < 0 || $items[$index]['descripcion'] === '') {
                $this->fail('items', 'Los productos contienen cantidades, precios o descripciones inválidas.');
            }
        }

        $subtotal = $this->round2($total / (1 + ($ratePercent / 100)));
        $igv = $this->round2($total - $subtotal);
        $provided = $data['totals'];
        $this->assertMoney((float) $provided['total'], $total, 'totals.total');
        $this->assertMoney((float) $provided['subtotal'], $subtotal, 'totals.subtotal');
        $this->assertMoney((float) $provided['igv'], $igv, 'totals.igv');

        $client = $this->canonicalClient($data['cliente'] ?? []);
        if ($data['tipo'] === 'factura' && ($client['tipo'] !== 'RUC' || ! preg_match('/^\d{11}$/', $client['numero']) || $client['nombre'] === '')) {
            $this->fail('cliente', 'La factura requiere RUC válido y razón social.');
        }
        $minimumDni = (float) config('sunat.min_boleta_dni', 700);
        if ($data['tipo'] === 'boleta' && $total >= $minimumDni && ($client['tipo'] !== 'DNI' || ! preg_match('/^\d{8}$/', $client['numero']))) {
            $this->fail('cliente.numero', "La boleta requiere DNI para importes desde S/ {$minimumDni}.");
        }

        return [
            'ref' => (string) $data['ref'],
            'tipo' => (string) $data['tipo'],
            'serie' => (string) $data['serie'],
            'correlativo' => (int) $data['correlativo'],
            'fecha' => isset($data['fecha']) ? (string) $data['fecha'] : now('America/Lima')->toIso8601String(),
            'igv_rate' => $ratePercent,
            'cliente' => $client,
            'items' => $items,
            'totals' => compact('subtotal', 'igv', 'total'),
        ];
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function canonicalizeSummary(array $data): array
    {
        $seen = [];
        $boletas = [];
        foreach ($data['boletas'] as $boleta) {
            $identity = (string) $boleta['serie'].'-'.(int) $boleta['correlativo'];
            if (isset($seen[$identity])) {
                $this->fail('boletas', 'El resumen contiene comprobantes duplicados.');
            }
            $seen[$identity] = true;
            $rate = $this->ratePercent($boleta['igv_rate'] ?? null);
            $total = $this->round2((float) $boleta['totals']['total']);
            $subtotal = $this->round2((float) $boleta['totals']['subtotal']);
            $igv = $this->round2((float) $boleta['totals']['igv']);
            $this->assertMoney($subtotal + $igv, $total, 'boletas.totals.total');
            $this->assertMoney($this->round2($total / (1 + ($rate / 100))), $subtotal, 'boletas.totals.subtotal');
            $boletas[] = [
                'ref' => (string) $boleta['ref'],
                'serie' => (string) $boleta['serie'],
                'correlativo' => (int) $boleta['correlativo'],
                'cliente' => $this->canonicalClient($boleta['cliente'] ?? []),
                'igv_rate' => $rate,
                'totals' => compact('subtotal', 'igv', 'total'),
            ];
        }

        return [
            'ref' => (string) $data['ref'],
            'fecha' => (string) $data['fecha'],
            'boletas' => $boletas,
        ];
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function canonicalizeVoided(array $data): array
    {
        $seen = [];
        $documents = [];
        foreach ($data['documentos'] as $document) {
            $identity = (string) $document['tipo'].'-'.(string) $document['serie'].'-'.(int) $document['correlativo'];
            if (isset($seen[$identity])) {
                $this->fail('documentos', 'La comunicación contiene comprobantes duplicados.');
            }
            $seen[$identity] = true;
            $documents[] = [
                'ref' => (string) $document['ref'],
                'tipo' => (string) $document['tipo'],
                'serie' => (string) $document['serie'],
                'correlativo' => (int) $document['correlativo'],
                'motivo' => trim((string) ($document['motivo'] ?? $data['motivo'] ?? 'ERROR EN EL COMPROBANTE')),
            ];
        }

        return [
            'fecha' => (string) $data['fecha'],
            'documentos' => $documents,
        ];
    }

    /** @param array<string, mixed> $payload */
    public function hash(array $payload): string
    {
        return hash('sha256', json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    /** @param array<string, mixed> $client @return array{tipo: string, numero: string, nombre: string} */
    private function canonicalClient(array $client): array
    {
        $rawType = strtoupper(trim((string) ($client['tipo'] ?? '-')));
        $type = match ($rawType) {
            '6', 'RUC' => 'RUC',
            '1', 'DNI' => 'DNI',
            default => '-',
        };

        return [
            'tipo' => $type,
            'numero' => preg_replace('/\D+/', '', (string) ($client['numero'] ?? '')) ?? '',
            'nombre' => trim((string) ($client['nombre'] ?? '')),
        ];
    }

    private function ratePercent(mixed $value): float
    {
        $rate = (float) $value;
        if (! is_numeric($value) || $rate <= 0 || $rate > 100) {
            $this->fail('igv_rate', 'La tasa de IGV no es válida.');
        }

        return round($rate, 4);
    }

    private function assertMoney(float $provided, float $expected, string $field): void
    {
        if (abs($provided - $expected) > self::TOLERANCE) {
            $this->fail($field, 'Los importes no coinciden con el cálculo del servidor.');
        }
    }

    private function round2(float $value): float
    {
        return round($value + PHP_FLOAT_EPSILON, 2);
    }

    private function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => [$message]]);
    }
}
