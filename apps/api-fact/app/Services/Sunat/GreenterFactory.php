<?php

namespace App\Services\Sunat;

use Greenter\Model\Client;
use Greenter\Model\Company\Company;
use Greenter\Model\Sale\Invoice;
use Greenter\Model\Sale\Legend;
use Greenter\Model\Sale\Note;
use Greenter\Model\Sale\SaleDetail;
use Greenter\See;
use Greenter\Ws\Services\SunatEndpoints;

class GreenterFactory
{
    /** See configurado con certificado + credenciales SOL según entorno. */
    public static function see(): See
    {
        $see = new See();
        $entorno = SunatConfigHelper::get('entorno', 'beta');
        $see->setService(
            $entorno === 'produccion'
                ? SunatEndpoints::FE_PRODUCCION
                : SunatEndpoints::FE_BETA
        );

        $ruc = SunatConfigHelper::get('ruc', '20000000001');
        $user = SunatConfigHelper::get('sol_user', 'MODDATOS');
        $password = SunatConfigHelper::get('sol_password', 'MODDATOS');

        if ($entorno === 'produccion' && ! str_starts_with((string) $user, (string) $ruc)) {
            $user = $ruc.$user;
        }
        $see->setClaveSOL($user, $password);

        $certPath = SunatConfigHelper::get('cert_path', storage_path('app/sunat/certificate.pfx'));
        $certPassword = SunatConfigHelper::get('cert_password', 'demo');

        if (! file_exists($certPath)) {
            // Genera certificado demo automáticamente si no existe y estamos en beta
            SunatConfigHelper::generateDemoCertificate();
            $certPath = storage_path('app/sunat/certificate.pfx');
            $certPassword = 'demo';
        }

        $see->setCertificate(
            file_get_contents($certPath),
            $certPassword
        );

        return $see;
    }

    public static function company(): Company
    {
        $company = new Company();
        $company->setRuc(SunatConfigHelper::get('ruc', config('sunat.ruc', '20000000001')))
            ->setRazonSocial(SunatConfigHelper::get('razon_social', config('sunat.razon_social', "D'ENZOZ")))
            ->setNombreComercial("D'ENZOZ");

        return $company;
    }

    public static function client(array $cliente): Client
    {
        $client = new Client();
        $isRuc = ($cliente['tipo'] ?? '-') === 'RUC';
        $client->setTipoDoc($isRuc ? '6' : '1')
            ->setNumDoc($cliente['numero'])
            ->setRznSocial($cliente['nombre'] ?: 'CLIENTE VARIOS');

        return $client;
    }

    /** Construye la Invoice UBL desde el payload JSON de la PWA. */
    public static function invoice(array $data): Invoice
    {
        $invoice = new Invoice();
        $invoice->setUblVersion('2.1')
            ->setCompany(self::company())
            ->setClient(self::client($data['cliente'] ?? []))
            ->setTipoDoc(($data['tipo'] ?? 'boleta') === 'factura' ? '01' : '03')
            ->setSerie($data['serie'])
            ->setCorrelativo((int) $data['correlativo'])
            ->setFechaEmision(new \DateTimeImmutable($data['fecha'] ?? 'now', new \DateTimeZone('America/Lima')))
            ->setTipoMoneda('PEN')
            ->setMtoOperGravadas((float) $data['totals']['subtotal'])
            ->setMtoIGV((float) $data['totals']['igv'])
            ->setTotalImpuestos((float) $data['totals']['igv'])
            ->setMtoImpVenta((float) $data['totals']['total']);

        foreach ($data['items'] as $item) {
            $cantidad = (float) $item['cantidad'];
            $precioConIgv = round((float) $item['precio'], 2);
            $valorUnitario = round($precioConIgv / 1.18, 5);
            $detail = new SaleDetail();
            $detail->setCodProducto(substr((string) ($item['codigo'] ?? ''), 0, 30))
                ->setUnidad('NIU')
                ->setDescripcion((string) $item['descripcion'])
                ->setCantidad($cantidad)
                ->setValorUnitario($valorUnitario)
                ->setPrecioUnitario($precioConIgv)
                ->setTipAfeIgv('10') // catálogo 16: gravado
                ->setIgv(round($cantidad * $valorUnitario * 0.18, 2))
                ->setTotal(round($cantidad * $precioConIgv, 2));
            $invoice->addDetail($detail);
        }

        $legend = new Legend();
        $legend->setCode('1000')
            ->setValue(self::enLetras((float) $data['totals']['total']));
        $invoice->setLegends([$legend]);

        return $invoice;
    }

    public static function creditNote(array $data, object $original, int $correlativoNc, string $serieNc): Note
    {
        $note = new Note();
        $note->setUblVersion('2.1')
            ->setTipoDoc('07')
            ->setSerie($serieNc)
            ->setCorrelativo($correlativoNc)
            ->setFechaEmision(new \DateTimeImmutable('now', new \DateTimeZone('America/Lima')))
            ->setCompany(self::company())
            ->setClient(self::client([
                'tipo' => $original->cliente_tipo,
                'numero' => $original->cliente_numero,
                'nombre' => $original->cliente_nombre,
            ]))
            ->setTipDocAfectado($original->tipo === 'factura' ? '01' : '03')
            ->setNumDocfectado("{$original->serie}-{$original->correlativo}")
            ->setCodMotivo('01') // 01: Anulación de la operación
            ->setDesMotivo($data['motivo'] ?? 'ANULACION DE LA OPERACION')
            ->setTipoMoneda('PEN')
            ->setMtoOperGravadas((float) ($original->payload['totals']['subtotal'] ?? round($original->total / 1.18, 2)))
            ->setMtoIGV((float) ($original->payload['totals']['igv'] ?? round($original->total - ($original->total / 1.18), 2)))
            ->setTotalImpuestos((float) ($original->payload['totals']['igv'] ?? round($original->total - ($original->total / 1.18), 2)))
            ->setMtoImpVenta((float) $original->total);

        $items = $original->payload['items'] ?? [];
        if (empty($items)) {
            $detail = new SaleDetail();
            $detail->setCodProducto('SERV01')
                ->setUnidad('NIU')
                ->setDescripcion($data['motivo'] ?? 'ANULACION DE COMPROBANTE')
                ->setCantidad(1)
                ->setValorUnitario(round($original->total / 1.18, 5))
                ->setPrecioUnitario((float) $original->total)
                ->setTipAfeIgv('10')
                ->setIgv(round($original->total - ($original->total / 1.18), 2))
                ->setTotal((float) $original->total);
            $note->addDetail($detail);
        } else {
            foreach ($items as $item) {
                $cantidad = (float) ($item['cantidad'] ?? 1);
                $precioConIgv = round((float) ($item['precio'] ?? $original->total), 2);
                $valorUnitario = round($precioConIgv / 1.18, 5);
                $detail = new SaleDetail();
                $detail->setCodProducto(substr((string) ($item['codigo'] ?? ''), 0, 30))
                    ->setUnidad('NIU')
                    ->setDescripcion((string) ($item['descripcion'] ?? 'ANULACION'))
                    ->setCantidad($cantidad)
                    ->setValorUnitario($valorUnitario)
                    ->setPrecioUnitario($precioConIgv)
                    ->setTipAfeIgv('10')
                    ->setIgv(round($cantidad * $valorUnitario * 0.18, 2))
                    ->setTotal(round($cantidad * $precioConIgv, 2));
                $note->addDetail($detail);
            }
        }

        $legend = new Legend();
        $legend->setCode('1000')
            ->setValue(self::enLetras((float) $original->total));
        $note->setLegends([$legend]);

        return $note;
    }

    public static function enLetras(float $monto): string
    {
        $monto = round($monto, 2);
        $entero = (int) floor($monto);
        $centavos = (int) round(($monto - $entero) * 100);

        $unidades = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE',
            'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
        $decenas = ['', '', 'VEINTI', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];

        $texto = '';
        if ($entero === 100) {
            $texto = 'CIEN';
        } elseif ($entero < 20) {
            $texto = $unidades[$entero];
        } elseif ($entero < 30) {
            $texto = 'VEINTI'.strtolower($unidades[$entero % 10]);
        } elseif ($entero < 100) {
            $d = intdiv($entero, 10);
            $u = $entero % 10;
            $texto = $decenas[$d].($u > 0 ? ' Y '.$unidades[$u] : '');
        } else {
            $texto = number_format($entero, 0); // montos mayores: simplificado
        }

        return "SON {$texto} CON {$centavos}/100";
    }
}
