<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Sunat\SunatConfigHelper;
use Illuminate\Http\Request;

class SunatConfigController extends Controller
{
    /**
     * Sube y valida el archivo de Certificado Digital (.pfx o .p12) y credenciales SOL.
     */
    public function uploadCertificate(Request $request)
    {
        $request->validate([
            'certificate' => 'required|file|max:5120', // máx 5MB
            'cert_password' => 'required|string',
            'sol_user' => 'nullable|string',
            'sol_password' => 'nullable|string',
            'ruc' => 'nullable|string|digits:11',
            'razon_social' => 'nullable|string',
            'entorno' => 'nullable|in:beta,produccion',
        ]);

        $file = $request->file('certificate');
        $certPassword = $request->input('cert_password');
        $rawContent = file_get_contents($file->getRealPath());

        $certs = [];
        if (! openssl_pkcs12_read($rawContent, $certs, $certPassword)) {
            return response()->json([
                'ok' => false,
                'message' => 'Contraseña del certificado incorrecta o archivo de certificado (.pfx/.p12) dañado.',
            ], 422);
        }

        $parsed = openssl_x509_parse($certs['cert'] ?? '');
        if (! $parsed) {
            return response()->json([
                'ok' => false,
                'message' => 'No se pudo leer la información X.509 del certificado digital.',
            ], 422);
        }

        $validTo = $parsed['validTo_time_t'] ?? null;
        $issuer = $parsed['issuer']['CN'] ?? ($parsed['issuer']['O'] ?? 'Emisor Desconocido');
        $daysLeft = $validTo ? (int) floor(($validTo - time()) / 86400) : null;
        $isExpired = $validTo ? (time() > $validTo) : false;

        $dir = storage_path('app/sunat');
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $pfxPath = $dir.'/certificate.pfx';
        file_put_contents($pfxPath, $rawContent);

        $toSave = [
            'cert_path' => $pfxPath,
            'cert_password' => $certPassword,
            'cert_filename' => $file->getClientOriginalName(),
            'cert_expires_at' => $validTo ? date('Y-m-d H:i:s', $validTo) : null,
            'cert_issuer' => $issuer,
        ];

        if ($request->filled('sol_user')) {
            $toSave['sol_user'] = $request->input('sol_user');
        }
        if ($request->filled('sol_password')) {
            $toSave['sol_password'] = $request->input('sol_password');
        }
        if ($request->filled('ruc')) {
            $toSave['ruc'] = $request->input('ruc');
        }
        if ($request->filled('razon_social')) {
            $toSave['razon_social'] = $request->input('razon_social');
        }
        if ($request->filled('entorno')) {
            $toSave['entorno'] = $request->input('entorno');
        }

        SunatConfigHelper::save($toSave);

        return response()->json([
            'ok' => true,
            'message' => $isExpired ? 'Certificado cargado, pero se encuentra EXPIRADO.' : 'Certificado digital verificado y guardado correctamente.',
            'certificate' => [
                'filename' => $file->getClientOriginalName(),
                'valid' => ! $isExpired,
                'is_expired' => $isExpired,
                'expires_at' => $validTo ? date('Y-m-d H:i:s', $validTo) : null,
                'days_left' => $daysLeft,
                'issuer' => $issuer,
                'subject_cn' => $parsed['subject']['CN'] ?? null,
            ],
        ]);
    }

    /**
     * Habilita el modo demo con el usuario oficial de pruebas SUNAT (MODDATOS)
     * y genera automáticamente un certificado autofirmado para desarrollo.
     */
    public function useDemoMode()
    {
        $res = SunatConfigHelper::generateDemoCertificate();

        return response()->json([
            'ok' => true,
            'message' => 'Modo Demo SUNAT activado con usuario oficial MODDATOS.',
            'credentials' => [
                'ruc' => '20000000001',
                'razon_social' => 'EMPRESA DEMO S.A.C.',
                'sol_user' => 'MODDATOS',
                'sol_password' => 'MODDATOS',
                'entorno' => 'beta',
            ],
        ]);
    }
}
