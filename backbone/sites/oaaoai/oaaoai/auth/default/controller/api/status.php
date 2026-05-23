<?php

/**
 * GET /auth/status — Check install status.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (class_exists(\OaaoBenchProbe::class, false)) {
        \OaaoBenchProbe::mark('status_handler');
    }

    $config = $this->getModuleConfig();
    $installed = (bool) ($config['installed'] ?? false);

    echo json_encode(array_filter([
        'success'   => true,
        'installed' => $installed,
        'bench'     => class_exists(\OaaoBenchProbe::class, false) && \OaaoBenchProbe::enabled()
            ? \OaaoBenchProbe::marks()
            : null,
    ], static fn ($v) => $v !== null), JSON_UNESCAPED_UNICODE);
};
