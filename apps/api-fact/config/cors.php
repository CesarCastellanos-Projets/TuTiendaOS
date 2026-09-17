<?php

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie', '/'],
    'allowed_methods' => ['*'],
    'allowed_origins' => array_values(array_filter(explode(',', (string) env('CORS_ALLOWED_ORIGINS', 'https://denzozsaas.web.app,https://denzozsaas.firebaseapp.com')))),
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
