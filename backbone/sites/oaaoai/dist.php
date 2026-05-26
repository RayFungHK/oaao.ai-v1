<?php

return [
    'dist' => 'oaaoai',
    'global_module' => false,
    'autoload_shared' => false,
    // Load every listed module per request so passive *.register hooks and lazy routes exist before shell/API dispatch.
    'greedy' => true,
    'strict' => false,
    'internal_bridge' => [
        'enabled' => false,
        'allow' => [],
        'secret' => '',
        'path' => '/__bridge',
    ],
    'modules' => [
        '*' => [
            'oaaoai/auth'      => 'default',
            'oaaoai/endpoints' => 'default',
            'oaaoai/core'      => 'default',
            'oaaoai/rag'       => 'default',
            'oaaoai/user'      => 'default',
            'oaaoai/group'     => 'default',
            'oaaoai/platform'  => 'default',
            'oaaoai/chat'          => 'default',
            'oaaoai/sandbox-coder' => 'default',
            'oaaoai/slide-designer' => 'default',
            'oaaoai/vault'         => 'default',
            'oaaoai/live-meeting'  => 'default',
            'oaaoai/research'      => 'default',
            'oaaoai/mine'          => 'default',
        ],
    ],
];
