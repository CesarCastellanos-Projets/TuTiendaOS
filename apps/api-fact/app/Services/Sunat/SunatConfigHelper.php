<?php

namespace App\Services\Sunat;

class SunatConfigHelper
{
    protected static ?array $cachedConfig = null;

    protected static ?string $cachedTenant = null;

    public static function setTenant(string $tenantId): void
    {
        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $tenantId)) {
            throw new \InvalidArgumentException('Tenant inválido.');
        }
        if (self::$cachedTenant !== $tenantId) {
            self::$cachedConfig = null;
            self::$cachedTenant = $tenantId;
        }
        config(['sunat.tenant_id' => $tenantId]);
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $cfg = self::load();

        return $cfg[$key] ?? config("sunat.{$key}", $default);
    }

    public static function load(): array
    {
        if (self::$cachedConfig !== null) {
            return self::$cachedConfig;
        }

        $path = self::configDirectory().'/config.json';
        if (file_exists($path)) {
            $json = json_decode((string) file_get_contents($path), true);
            if (is_array($json)) {
                self::$cachedConfig = $json;

                return self::$cachedConfig;
            }
        }

        self::$cachedConfig = [];

        return self::$cachedConfig;
    }

    public static function save(array $data): void
    {
        $current = self::load();
        $merged = array_merge($current, $data);

        $dir = self::configDirectory();
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $path = $dir.'/config.json';
        file_put_contents($path, json_encode($merged, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
        chmod($path, 0600);
        self::$cachedConfig = $merged;
    }

    public static function generateDemoCertificate(): array
    {
        $dir = self::configDirectory();
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $dn = [
            'countryName' => 'PE',
            'stateOrProvinceName' => 'Lima',
            'localityName' => 'Lima',
            'organizationName' => 'EMPRESA DEMO S.A.C.',
            'organizationalUnitName' => 'Facturacion Electronica Demo',
            'commonName' => '20000000001',
            'emailAddress' => 'demo@denzoz.pe',
        ];

        $configArgs = ['digest_alg' => 'sha256'];
        $possibleCnf = [
            '/etc/ssl/openssl.cnf',
            '/usr/lib/ssl/openssl.cnf',
            '/etc/pki/tls/openssl.cnf',
            dirname(PHP_BINARY).'/extras/ssl/openssl.cnf',
            dirname(PHP_BINARY).'/openssl.cnf',
            'C:/xampp/apache/bin/openssl.cnf',
            'C:/xampp/php/extras/ssl/openssl.cnf',
        ];
        foreach ($possibleCnf as $cnf) {
            if (file_exists($cnf)) {
                $configArgs['config'] = $cnf;
                putenv("OPENSSL_CONF=$cnf");
                break;
            }
        }

        $privkey = openssl_pkey_new(array_merge([
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ], $configArgs));

        $csr = openssl_csr_new($dn, $privkey, $configArgs);
        $sscert = openssl_csr_sign($csr, null, $privkey, 365, $configArgs);

        $certPassword = 'demo';
        $pfxPath = $dir.'/certificate.pfx';

        openssl_pkcs12_export_to_file($sscert, $pfxPath, $privkey, $certPassword, $configArgs);

        self::save([
            'cert_path' => $pfxPath,
            'cert_password' => $certPassword,
            'cert_filename' => 'certificado_demo_sunat.pfx',
            'entorno' => 'beta',
            'ruc' => '20000000001',
            'razon_social' => 'EMPRESA DEMO S.A.C.',
            'sol_user' => 'MODDATOS',
            'sol_password' => 'MODDATOS',
        ]);

        return [
            'ok' => true,
            'message' => 'Certificado Demo SUNAT generado exitosamente.',
            'cert_password' => $certPassword,
        ];
    }

    public static function configDirectory(): string
    {
        $base = rtrim((string) config('sunat.config_dir', storage_path('app/sunat')), '/\\');
        $tenantId = (string) config('sunat.tenant_id', 'denzoz');

        return $base.DIRECTORY_SEPARATOR.$tenantId;
    }
}
