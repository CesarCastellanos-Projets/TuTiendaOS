<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Sunat\SunatConfigHelper;
use Illuminate\Http\Request;

class HealthCheckController extends Controller
{
    /**
     * Diagnóstico completo de conexión con el motor tributario y SUNAT.
     */
    public function check(Request $request)
    {
        $startTime = microtime(true);

        $entorno = SunatConfigHelper::get('entorno', config('sunat.entorno', 'beta'));
        $ruc = SunatConfigHelper::get('ruc', config('sunat.ruc', '20000000001'));
        $solUser = SunatConfigHelper::get('sol_user', config('sunat.sol_user', 'MODDATOS'));
        $certPath = SunatConfigHelper::get('cert_path', config('sunat.cert_path', storage_path('app/sunat/certificate.pfx')));
        $certPass = SunatConfigHelper::get('cert_password', config('sunat.cert_password', 'demo'));

        // En modo beta, si no hay certificado, se genera automáticamente el demo
        if ($entorno === 'beta' && (! $certPath || ! file_exists($certPath))) {
            SunatConfigHelper::generateDemoCertificate();
            $certPath = storage_path('app/sunat/certificate.pfx');
            $certPass = 'demo';
        }

        // 1. Diagnóstico del Certificado Digital
        $certStatus = [
            'configured' => ! empty($certPath),
            'exists' => false,
            'valid' => false,
            'expires_at' => null,
            'days_left' => null,
            'issuer' => null,
            'message' => 'No configurado',
        ];

        if ($certPath && file_exists($certPath)) {
            $certStatus['exists'] = true;
            $pfxContent = @file_get_contents($certPath);
            $certs = [];

            if ($pfxContent && @openssl_pkcs12_read($pfxContent, $certs, (string) $certPass)) {
                $certData = openssl_x509_parse($certs['cert'] ?? '');
                if ($certData) {
                    $validTo = $certData['validTo_time_t'] ?? null;
                    $certStatus['valid'] = $validTo && $validTo > time();
                    $certStatus['expires_at'] = $validTo ? date('Y-m-d H:i:s', $validTo) : null;
                    $certStatus['days_left'] = $validTo ? (int) floor(($validTo - time()) / 86400) : 0;
                    $certStatus['issuer'] = $certData['issuer']['CN'] ?? ($certData['issuer']['O'] ?? 'Desconocido');
                    $certStatus['message'] = $certStatus['valid'] ? 'Certificado digital válido' : 'Certificado digital vencido';
                }
            } else {
                $certStatus['message'] = 'Archivo .pfx encontrado pero la contraseña es incorrecta o el formato no es válido';
            }
        } elseif ($certPath) {
            $certStatus['message'] = "No se encontró el archivo de certificado en: {$certPath}";
        }

        // 2. Diagnóstico de Credenciales SOL
        $solStatus = [
            'configured' => ! empty($ruc) && ! empty($solUser),
            'ruc' => $ruc ?: 'No configurado',
            'user' => $solUser ?: 'No configurado',
            'message' => (! empty($ruc) && ! empty($solUser)) ? 'Credenciales SOL presentes' : 'Faltan RUC o Usuario SOL',
        ];

        // 3. Test de Conectividad con el Endpoint de SUNAT
        $sunatEndpoint = $entorno === 'produccion'
            ? 'https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService'
            : 'https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService';

        $sunatPing = [
            'entorno' => $entorno,
            'endpoint' => $sunatEndpoint,
            'reachable' => false,
            'http_code' => null,
            'latency_ms' => null,
            'message' => 'No probado',
        ];

        try {
            $ch = curl_init($sunatEndpoint.'?wsdl');
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 6,
                CURLOPT_CONNECTTIMEOUT => 4,
                CURLOPT_SSL_VERIFYPEER => false,
                CURLOPT_SSL_VERIFYHOST => false,
                CURLOPT_USERAGENT => 'DENZOZ-SaaS/1.0',
            ]);
            $pingStart = microtime(true);
            curl_exec($ch);
            $pingDuration = round((microtime(true) - $pingStart) * 1000, 2);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $curlError = curl_error($ch);
            curl_close($ch);

            $sunatPing['latency_ms'] = $pingDuration;
            $sunatPing['http_code'] = $httpCode;

            if ($httpCode >= 200 && $httpCode < 600) {
                $sunatPing['reachable'] = true;
                $sunatPing['message'] = "Servidor SUNAT ({$entorno}) respondió en {$pingDuration} ms";
            } else {
                $sunatPing['message'] = $curlError ?: "SUNAT respondió con código HTTP {$httpCode}";
            }
        } catch (\Throwable $e) {
            $sunatPing['message'] = 'Error al conectar con SUNAT: ' . $e->getMessage();
        }

        $totalDurationMs = round((microtime(true) - $startTime) * 1000, 2);
        $overallOk = $solStatus['configured'] && ($certStatus['valid'] || $entorno === 'beta');

        return response()->json([
            'ok' => true,
            'status' => $overallOk ? 'listo' : 'requiere_atencion',
            'timestamp' => date('c'),
            'execution_time_ms' => $totalDurationMs,
            'laravel' => [
                'status' => 'online',
                'php_version' => PHP_VERSION,
                'timezone' => config('app.timezone', 'America/Lima'),
            ],
            'certificate' => $certStatus,
            'sol' => $solStatus,
            'sunat' => $sunatPing,
        ]);
    }
}
