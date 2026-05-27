<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * GET /api/build_info — web + orchestrator version/build for dev mismatch detection.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');
    require_once __DIR__ . '/../../library/OaaoBuildInfo.php';

    $web = \Oaaoai\Core\OaaoBuildInfo::payloadForWeb();
    $orch = ChatOrchestratorApi::getInternalJson('/v1/build_info', 8);
    $orchPayload = \is_array($orch) ? $orch : null;

    $mismatch = false;
    if (\is_array($orchPayload)) {
        $webBid = (string) ($web['build_id'] ?? '');
        $orchBid = (string) ($orchPayload['build_id'] ?? '');
        if ($webBid !== '' && $orchBid !== '' && $webBid !== $orchBid) {
            $mismatch = true;
        }
    }

    echo json_encode(
        \Oaaoai\Core\OaaoBuildInfo::mergeBuild([
            'success'              => true,
            'web'                  => $web,
            'orchestrator'         => $orchPayload,
            'stack_mismatch'       => $mismatch,
            'orchestrator_reachable' => $orchPayload !== null,
        ]),
        JSON_UNESCAPED_UNICODE,
    );
};
