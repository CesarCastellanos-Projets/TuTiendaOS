<?php

return [
    'tenant_id' => 'denzoz',

    /*
    |--------------------------------------------------------------------------
    | Datos del emisor
    |--------------------------------------------------------------------------
    */
    'ruc' => env('SUNAT_RUC', '20000000001'),
    'razon_social' => env('SUNAT_RAZON_SOCIAL', 'DENZOZ SAC'),
    'direccion' => env('SUNAT_DIRECCION', 'Av. Real 123, Huancayo'),
    'ubigeo' => env('SUNAT_UBIGEO', '120101'),

    /*
    |--------------------------------------------------------------------------
    | Entorno SUNAT: beta (integración) o produccion
    |--------------------------------------------------------------------------
    */
    'entorno' => env('SUNAT_ENV', 'beta'),

    /*
    |--------------------------------------------------------------------------
    | Credenciales SOL (usuario secundario con facturación electrónica)
    | En producción el usuario suele ser RUC + usuario secundario.
    |--------------------------------------------------------------------------
    */
    'sol_user' => env('SUNAT_SOL_USER', 'MODDATOS'),
    'sol_password' => env('SUNAT_SOL_PASSWORD', 'MODDATOS'),

    /*
    |--------------------------------------------------------------------------
    | Certificado digital (.pfx) y clave
    |--------------------------------------------------------------------------
    */
    'cert_path' => env('SUNAT_CERT_PATH', storage_path('app/sunat/certificate.pfx')),
    'cert_password' => env('SUNAT_CERT_PASSWORD', 'demo'),
    'config_dir' => env('SUNAT_CONFIG_DIR', storage_path('app/sunat')),

    /*
    |--------------------------------------------------------------------------
    | Token compartido exclusivamente con Cloud Functions
    |--------------------------------------------------------------------------
    */
    'api_token' => env('API_FACT_TOKEN', ''),
    'tenant_requests_per_minute' => (int) env('API_FACT_TENANT_REQUESTS_PER_MINUTE', 60),
    'global_requests_per_minute' => (int) env('API_FACT_GLOBAL_REQUESTS_PER_MINUTE', 60),

    'serie_nc_factura' => env('SUNAT_SERIE_NC_FACTURA', 'FC01'),
    'serie_nc_boleta' => env('SUNAT_SERIE_NC_BOLETA', 'BC01'),
    'min_boleta_dni' => (float) env('SUNAT_MIN_BOLETA_DNI', 700),
    'retry_max_attempts' => (int) env('SUNAT_RETRY_MAX_ATTEMPTS', 6),

    // Endpoints oficiales según entorno
    'endpoints' => [
        'beta' => [
            'factura' => 'https://e-fact.sunat.gob.pe/ol-ti-itcpfefem/billService',
        ],
        'produccion' => [
            'factura' => 'https://api-cpe.sunat.gob.pe/v1/contribuyente/gem',
        ],
    ],
];
