<?php

declare(strict_types=1);

return [
    'default' => env('FILESYSTEM_DISK', 'local'),

    'disks' => [
        'local' => [
            'driver' => 'local',
            'root' => env('SUNAT_STORAGE_ROOT', storage_path('app/private')),
            'serve' => false,
            'throw' => false,
        ],
    ],
];
