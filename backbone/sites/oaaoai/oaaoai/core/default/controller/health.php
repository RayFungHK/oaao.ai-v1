<?php

declare(strict_types=1);

/**
 * GET /health — liveness + version/build (load balancers + dev visibility).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');
    require_once __DIR__ . '/../library/OaaoBuildInfo.php';

    $payload = \Oaaoai\Core\OaaoBuildInfo::payloadForWeb();
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
};
