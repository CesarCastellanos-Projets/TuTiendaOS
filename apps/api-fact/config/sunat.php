<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Datos del emisor
    |--------------------------------------------------------------------------
    */
    'ruc' => env('SUNAT_RUC', ''),
    'razon_social' => env('SUNAT_RAZON_SOCIAL', "D'ENZOZ"),
    'direccion' => env('SUNAT_DIRECCION', ''),
    'ubigeo' => env('SUNAT_UBIGEO', '150101'),

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
    'sol_user' => env('SUNAT_SOL_USER', ''),
    'sol_password' => env('SUNAT_SOL_PASSWORD', ''),

    /*
    |--------------------------------------------------------------------------
    | Certificado digital (.pfx) y clave
    |--------------------------------------------------------------------------
    */
    'cert_path' => env('SUNAT_CERT_PATH', storage_path('app/sunat/certificate.pfx')),
    'cert_password' => env('SUNAT_CERT_PASSWORD', ''),

    /*
    |--------------------------------------------------------------------------
    | Token compartido con la PWA (header X-API-TOKEN)
    |--------------------------------------------------------------------------
    */
    'api_token' => env('API_FACT_TOKEN', ''),

    'serie_nc_factura' => env('SUNAT_SERIE_NC_FACTURA', 'FC01'),
    'serie_nc_boleta' => env('SUNAT_SERIE_NC_BOLETA', 'BC01'),

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
