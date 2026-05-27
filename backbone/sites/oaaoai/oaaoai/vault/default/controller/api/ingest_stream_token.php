<?php

declare(strict_types=1);

/**
 * POST /vault/api/ingest_stream_token — mint orchestrator SSE token for vault ingest progress.
 *
 * Browser opens {@code GET /v1/vault/ingest/stream} on the Python sidecar (not PHP).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'POST required'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $ctx = $this->oaao_vault_require_pg_api_context(null);
    if ($ctx === null) {
        return;
    }

    $raw = file_get_contents('php://input');
    $body = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    if (! \is_array($body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON body'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $vaultId = isset($body['vault_id']) && is_numeric($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'vault_id required'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    if (! class_exists(\oaaoai\chat\OrchestratorPublicBase::class)) {
        require_once dirname(__DIR__, 3) . '/chat/default/library/OrchestratorPublicBase.php';
    }

    $internal = getenv('OAAO_ORCHESTRATOR_INTERNAL_URL');
    if (! \is_string($internal) || trim($internal) === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator not configured'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $mintUrl = rtrim(trim($internal), '/') . '/v1/vault/ingest/stream/mint';
    $mintBody = json_encode([
        'vault_id'     => $vaultId,
        'user_id'      => $uid,
        'workspace_id' => $wid,
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

    $ch = curl_init($mintUrl);
    if ($ch === false) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Mint request failed'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $mintBody,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Accept: application/json',
            'X-OAAO-Internal-Token: ' . $secret,
        ],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
    ]);
    $respBody = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (! \is_string($respBody) || $httpCode < 200 || $httpCode >= 300) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator mint failed'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $mint = json_decode($respBody, true);
    if (! \is_array($mint) || empty($mint['token']) || ! \is_string($mint['token'])) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Invalid mint response'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $publicBase = \oaaoai\chat\OrchestratorPublicBase::forClientStream(
        \oaaoai\chat\OrchestratorPublicBase::fromEnv(),
    );
    if ($publicBase === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator public base not configured'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $docIds = isset($body['document_ids']) && \is_array($body['document_ids'])
        ? array_values(array_filter(array_map(static fn ($v) => is_numeric($v) ? (int) $v : 0, $body['document_ids']), static fn ($n) => $n > 0))
        : [];

    $query = [
        'vault_id' => $vaultId,
        'user_id'  => $uid,
        'token'    => $mint['token'],
    ];
    if ($docIds !== []) {
        $query['document_ids'] = implode(',', array_slice($docIds, 0, 64));
    }

    $streamUrl = rtrim($publicBase, '/') . '/v1/vault/ingest/stream?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    $streamUrl = \oaaoai\chat\OrchestratorPublicBase::rewriteOrchestratorUrlForClient($streamUrl);

    echo json_encode([
        'success' => true,
        'data'    => [
            'stream_url' => $streamUrl,
            'vault_id'   => $vaultId,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
