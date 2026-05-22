<?php

/**
 * GET /auth/status — Check install status.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $config = $this->getModuleConfig();
    $installed = (bool) ($config['installed'] ?? false);

    echo json_encode([
        'success'   => true,
        'installed' => $installed,
    ]);
};
