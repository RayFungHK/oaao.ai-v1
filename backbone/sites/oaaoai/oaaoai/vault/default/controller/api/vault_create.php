<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_create — create a named vault in personal shell or active workspace scope.
 *
 * JSON body: {@code name} (required), optional {@code workspace_id} (omit/null = personal).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $body = $decoded;
            }
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);

            return;
        }
    }

    $ctx = $this->oaao_vault_require_pg_api_context($body);
    if ($ctx === null) {
        return;
    }

    $name = isset($body['name']) ? trim((string) $body['name']) : '';
    if ($name === '' || strlen($name) > 120) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Vault name must be 1–120 characters.']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    $vaultId = $this->oaao_vault_insert_named_vault($db, $uid, $wid, $name);

    echo json_encode([
        'success' => true,
        'data'    => ['vault_id' => $vaultId],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
