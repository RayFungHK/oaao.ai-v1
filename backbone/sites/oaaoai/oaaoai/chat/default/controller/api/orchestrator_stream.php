<?php

declare(strict_types=1);

/**
 * @deprecated SSE must use Apache {@code /sidecar} reverse proxy — not PHP.
 *
 * GET /chat/api/orchestrator_stream — removed (was blocking PHP workers on long SSE).
 */
return function (): void {
    http_response_code(410);
    header('Content-Type: application/json; charset=UTF-8');
    $sidecar = \oaaoai\chat\OrchestratorPublicBase::sidecarPath();
    echo json_encode([
        'success' => false,
        'message' => 'Orchestrator SSE no longer proxied through PHP. Use the /sidecar reverse proxy.',
        'sidecar_path' => $sidecar,
        'stream_path' => rtrim($sidecar, '/') . '/v1/stream',
    ], JSON_UNESCAPED_UNICODE);
};
