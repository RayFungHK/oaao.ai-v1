<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /library/api/library_document_convert — enqueue Python /v1/library/convert (CS-2-S3).
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $title = trim((string) ($input['title'] ?? 'Untitled'));
    $text = trim((string) ($input['text'] ?? $input['source_text'] ?? ''));

    $resp = ChatOrchestratorApi::postInternalJson('/v1/library/convert', [
        'title' => $title !== '' ? $title : 'Untitled',
        'text'  => $text,
    ], 30);

    if ($resp === null) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable']);

        return;
    }

    echo json_encode([
        'success' => ! empty($resp['ok']),
        'data'    => $resp,
        'message' => empty($resp['ok']) ? (string) ($resp['error'] ?? 'convert_failed') : '',
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
