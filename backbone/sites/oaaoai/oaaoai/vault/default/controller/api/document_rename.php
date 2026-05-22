<?php

declare(strict_types=1);

/**
 * POST /vault/api/document_rename — update display {@code file_name} (blob path unchanged).
 *
 * JSON body: {@code document_id}, {@code file_name}, optional {@code workspace_id}.
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

    $docId = isset($body['document_id']) ? (int) $body['document_id'] : 0;
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    $name = isset($body['file_name']) ? trim((string) $body['file_name']) : '';
    if ($name === '' || \strlen($name) > 255) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'file_name must be 1–255 characters.']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    /** @var array<string, mixed>|false $r */
    $r = $db->prepare()
        ->select('vault_id')
        ->from('vault_document')
        ->where('id=:id')
        ->assign(['id' => $docId])
        ->limit(1)
        ->query()
        ->fetch();
    $vaultId = \is_array($r) ? (int) ($r['vault_id'] ?? 0) : 0;
    if ($vaultId < 1) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $ts = date('Y-m-d H:i:s');
    $db->update('vault_document', ['file_name', 'updated_at'])
        ->where('id=:id')
        ->assign([
            'file_name'  => $name,
            'updated_at' => $ts,
            'id'         => $docId,
        ])
        ->query();

    echo json_encode(
        ['success' => true, 'data' => ['document_id' => $docId, 'file_name' => $name]],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
