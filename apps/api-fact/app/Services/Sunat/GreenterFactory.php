<?php

declare(strict_types=1);

namespace App\Services\Sunat;

use DateTimeImmutable;
use DateTimeZone;
use Greenter\Model\Client\Client;
use Greenter\Model\Company\Company;
use Greenter\Model\Sale\Invoice;
use Greenter\Model\Sale\Legend;
use Greenter\Model\Sale\Note;
use Greenter\Model\Sale\SaleDetail;
use Greenter\Model\Summary\Summary;
use Greenter\Model\Summary\SummaryDetail;
use Greenter\Model\Voided\Voided;
use Greenter\Model\Voided\VoidedDetail;
use Greenter\See;
use Greenter\Ws\Services\SunatEndpoints;

final class GreenterFactory
{
    public static function see(): See
    {
        $see = new See;
        $environment = SunatConfigHelper::get('entorno', 'beta');
        $see->setService($environment === 'produccion' ? SunatEndpoints::FE_PRODUCCION : SunatEndpoints::FE_BETA);

        $ruc = (string) SunatConfigHelper::get('ruc', '20000000001');
        $user = (string) SunatConfigHelper::get('sol_user', 'MODDATOS');
        $password = (string) SunatConfigHelper::get('sol_password', 'MODDATOS');
        if (str_starts_with($user, $ruc)) {
            $user = substr($user, strlen($ruc));
        }
        $see->setClaveSOL($ruc, $user, $password);

        $certificatePath = (string) SunatConfigHelper::get('cert_path', SunatConfigHelper::configDirectory().'/certificate.pfx');
        $certificatePassword = (string) SunatConfigHelper::get('cert_password', 'demo');
        if (! file_exists($certificatePath)) {
            SunatConfigHelper::generateDemoCertificate();
            $certificatePath = SunatConfigHelper::configDirectory().'/certificate.pfx';
            $certificatePassword = 'demo';
        }
        $certificate = file_get_contents($certificatePath);
        if ($certificate === false) {
            throw new \RuntimeException('No se pudo leer el certificado digital.');
        }
        $see->setCertificate($certificate, $certificatePassword);

        return $see;
    }

    public static function company(): Company
    {
        return (new Company)
            ->setRuc((string) SunatConfigHelper::get('ruc', config('sunat.ruc', '20000000001')))
            ->setRazonSocial((string) SunatConfigHelper::get('razon_social', config('sunat.razon_social', "D'ENZOZ")))
            ->setNombreComercial("D'ENZOZ");
    }

    /** @param array<string, mixed> $clientData */
    public static function client(array $clientData): Client
    {
        $type = (string) ($clientData['tipo'] ?? '-');
        $number = (string) ($clientData['numero'] ?? '');

        return (new Client)
            ->setTipoDoc($type === 'RUC' ? '6' : '1')
            ->setNumDoc($number !== '' ? $number : '00000000')
            ->setRznSocial((string) (($clientData['nombre'] ?? '') ?: 'CLIENTE VARIOS'));
    }

    /** @param array<string, mixed> $data */
    public static function invoice(array $data): Invoice
    {
        $totals = $data['totals'];
        $invoice = (new Invoice)
            ->setUblVersion('2.1')
            ->setTipoOperacion('0101')
            ->setCompany(self::company())
            ->setClient(self::client($data['cliente']))
            ->setTipoDoc($data['tipo'] === 'factura' ? '01' : '03')
            ->setSerie((string) $data['serie'])
            ->setCorrelativo((string) $data['correlativo'])
            ->setFechaEmision(new DateTimeImmutable((string) $data['fecha'], new DateTimeZone('America/Lima')))
            ->setTipoMoneda('PEN')
            ->setMtoOperGravadas((float) $totals['subtotal'])
            ->setMtoIGV((float) $totals['igv'])
            ->setTotalImpuestos((float) $totals['igv'])
            ->setValorVenta((float) $totals['subtotal'])
            ->setSubTotal((float) $totals['total'])
            ->setMtoImpVenta((float) $totals['total']);

        $details = array_map(
            fn (array $item): SaleDetail => self::saleDetail($item, (float) $data['igv_rate']),
            $data['items']
        );

        return $invoice->setDetails($details)->setLegends([self::legend((float) $totals['total'])]);
    }

    /** @param array<string, mixed> $data */
    public static function creditNote(array $data, object $original, int $correlative, string $series): Note
    {
        $payload = $original->payload;
        $totals = $payload['totals'];
        $rate = (float) ($payload['igv_rate'] ?? 18);
        $note = (new Note)
            ->setUblVersion('2.1')
            ->setTipoDoc('07')
            ->setSerie($series)
            ->setCorrelativo((string) $correlative)
            ->setFechaEmision(new DateTimeImmutable('now', new DateTimeZone('America/Lima')))
            ->setCompany(self::company())
            ->setClient(self::client([
                'tipo' => $original->cliente_tipo,
                'numero' => $original->cliente_numero,
                'nombre' => $original->cliente_nombre,
            ]))
            ->setTipDocAfectado($original->tipo === 'factura' ? '01' : '03')
            ->setNumDocfectado("{$original->serie}-{$original->correlativo}")
            ->setCodMotivo('01')
            ->setDesMotivo((string) ($data['motivo'] ?? 'ANULACION DE LA OPERACION'))
            ->setTipoMoneda('PEN')
            ->setMtoOperGravadas((float) $totals['subtotal'])
            ->setMtoIGV((float) $totals['igv'])
            ->setTotalImpuestos((float) $totals['igv'])
            ->setValorVenta((float) $totals['subtotal'])
            ->setSubTotal((float) $totals['total'])
            ->setMtoImpVenta((float) $totals['total']);

        $details = array_map(
            fn (array $item): SaleDetail => self::saleDetail($item, $rate),
            $payload['items']
        );

        return $note->setDetails($details)->setLegends([self::legend((float) $totals['total'])]);
    }

    /** @param array<string, mixed> $data */
    public static function summary(array $data, int $correlative): Summary
    {
        $details = [];
        foreach ($data['boletas'] as $receipt) {
            $client = $receipt['cliente'];
            $totals = $receipt['totals'];
            $details[] = (new SummaryDetail)
                ->setTipoDoc('03')
                ->setSerieNro($receipt['serie'].'-'.$receipt['correlativo'])
                ->setEstado('1')
                ->setClienteTipo($client['tipo'] === 'RUC' ? '6' : '1')
                ->setClienteNro($client['numero'] !== '' ? $client['numero'] : '00000000')
                ->setTotal((float) $totals['total'])
                ->setMtoOperGravadas((float) $totals['subtotal'])
                ->setMtoIGV((float) $totals['igv'])
                ->setPorcentajeIgv((float) $receipt['igv_rate']);
        }

        return (new Summary)
            ->setFecGeneracion(new DateTimeImmutable((string) $data['fecha'], new DateTimeZone('America/Lima')))
            ->setFecResumen(new DateTimeImmutable('now', new DateTimeZone('America/Lima')))
            ->setCorrelativo(str_pad((string) $correlative, 3, '0', STR_PAD_LEFT))
            ->setCompany(self::company())
            ->setDetails($details);
    }

    /** @param array<string, mixed> $data */
    public static function voided(array $data, int $correlative): Voided
    {
        $details = [];
        foreach ($data['documentos'] as $document) {
            $details[] = (new VoidedDetail)
                ->setTipoDoc($document['tipo'] === 'factura' ? '01' : '03')
                ->setSerie((string) $document['serie'])
                ->setCorrelativo((string) $document['correlativo'])
                ->setDesMotivoBaja((string) $document['motivo']);
        }

        return (new Voided)
            ->setCorrelativo(str_pad((string) $correlative, 5, '0', STR_PAD_LEFT))
            ->setFecGeneracion(new DateTimeImmutable((string) $data['fecha'], new DateTimeZone('America/Lima')))
            ->setFecComunicacion(new DateTimeImmutable('now', new DateTimeZone('America/Lima')))
            ->setCompany(self::company())
            ->setDetails($details);
    }

    /** @param array<string, mixed> $item */
    private static function saleDetail(array $item, float $ratePercent): SaleDetail
    {
        $quantity = (float) $item['cantidad'];
        $grossUnitPrice = round((float) $item['precio'], 2);
        $grossTotal = round($quantity * $grossUnitPrice, 2);
        $netUnitPrice = round($grossUnitPrice / (1 + ($ratePercent / 100)), 5);
        $netTotal = round($grossTotal / (1 + ($ratePercent / 100)), 2);
        $igv = round($grossTotal - $netTotal, 2);

        return (new SaleDetail)
            ->setCodProducto(substr((string) ($item['codigo'] ?? ''), 0, 30))
            ->setUnidad('NIU')
            ->setDescripcion((string) $item['descripcion'])
            ->setCantidad($quantity)
            ->setMtoValorUnitario($netUnitPrice)
            ->setMtoPrecioUnitario($grossUnitPrice)
            ->setMtoBaseIgv($netTotal)
            ->setPorcentajeIgv($ratePercent)
            ->setTipAfeIgv('10')
            ->setIgv($igv)
            ->setTotalImpuestos($igv)
            ->setMtoValorVenta($netTotal);
    }

    private static function legend(float $amount): Legend
    {
        return (new Legend)->setCode('1000')->setValue(self::enLetras($amount));
    }

    public static function enLetras(float $amount): string
    {
        $amount = round($amount, 2);
        $integer = (int) floor($amount);
        $cents = (int) round(($amount - $integer) * 100);
        $words = self::integerWords($integer);

        return "SON {$words} CON ".str_pad((string) $cents, 2, '0', STR_PAD_LEFT).'/100 SOLES';
    }

    private static function integerWords(int $value): string
    {
        $units = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
            'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
        $tens = [2 => 'VEINTE', 3 => 'TREINTA', 4 => 'CUARENTA', 5 => 'CINCUENTA', 6 => 'SESENTA', 7 => 'SETENTA', 8 => 'OCHENTA', 9 => 'NOVENTA'];
        $hundreds = [2 => 'DOSCIENTOS', 3 => 'TRESCIENTOS', 4 => 'CUATROCIENTOS', 5 => 'QUINIENTOS', 6 => 'SEISCIENTOS', 7 => 'SETECIENTOS', 8 => 'OCHOCIENTOS', 9 => 'NOVECIENTOS'];

        if ($value === 0) {
            return 'CERO';
        }
        if ($value < 20) {
            return $units[$value];
        }
        if ($value < 100) {
            $ten = intdiv($value, 10);
            $unit = $value % 10;
            if ($ten === 2 && $unit > 0) {
                return 'VEINTI'.$units[$unit];
            }

            return $tens[$ten].($unit > 0 ? ' Y '.$units[$unit] : '');
        }
        if ($value < 1000) {
            if ($value === 100) {
                return 'CIEN';
            }
            $hundred = intdiv($value, 100);
            $remainder = $value % 100;
            $prefix = $hundred === 1 ? 'CIENTO' : $hundreds[$hundred];

            return $prefix.($remainder > 0 ? ' '.self::integerWords($remainder) : '');
        }
        if ($value < 1_000_000) {
            $thousands = intdiv($value, 1000);
            $remainder = $value % 1000;
            $prefix = $thousands === 1 ? 'MIL' : self::integerWords($thousands).' MIL';

            return $prefix.($remainder > 0 ? ' '.self::integerWords($remainder) : '');
        }

        $millions = intdiv($value, 1_000_000);
        $remainder = $value % 1_000_000;
        $prefix = $millions === 1 ? 'UN MILLON' : self::integerWords($millions).' MILLONES';

        return $prefix.($remainder > 0 ? ' '.self::integerWords($remainder) : '');
    }
}
