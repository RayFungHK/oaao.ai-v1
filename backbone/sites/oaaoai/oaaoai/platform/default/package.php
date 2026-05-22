<?php

return [
    'module_code' => 'oaaoai/platform',
    'name'        => 'oaao.ai Platform',
    'author'      => 'Ray Fung',
    'description' => 'Platform control plane — tenant registry and cross-tenant usage (god mode)',
    'version'     => '1.0.0',
    'require'     => [
        'oaaoai/auth' => '*',
        'oaaoai/core' => '*',
    ],
];
