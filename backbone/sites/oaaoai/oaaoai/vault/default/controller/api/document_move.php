<?php

declare(strict_types=1);

/**
 * POST /vault/api/document_move — change {@code container_id} within the same vault (null / omit = vault root).
 *
 * JSON body: {@code document_id}, {@code vault_id}, optional {@code container_id}, optional {@code workspace_id}.
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
    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($docId < 1 || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id and vault_id are required.']);

        return;
    }

    $targetRaw = $body['container_id'] ?? null;
    $targetCid = null;
    if ($targetRaw !== null && $targetRaw !== '') {
        $targetCid = (int) $targetRaw;
        if ($targetCid < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid container_id.']);

            return;
        }
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    /** @var array<string, mixed>|false $row */
    $row = $db->prepare()
        ->select('vault_id, container_id')
        ->from('vault_document')
        ->where('id=:id')
        ->assign(['id' => $docId])
        ->limit(1)
        ->query()
        ->fetch();
    if ($row === false || ! \is_array($row)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $docVault = (int) ($row['vault_id'] ?? 0);
    if ($docVault !== $vaultId) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Document is not in this vault.']);

        return;
    }

    if ($targetCid !== null && ! $this->oaao_vault_container_belongs_to_vault($db, $targetCid, $vaultId)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Target folder does not belong to this vault.']);

        return;
    }

    $ts = date('Y-m-d H:i:s');
    $db->update('vault_document', ['container_id', 'updated_at'])
        ->where('id=:id')
        ->assign([
            'container_id' => $targetCid,
            'updated_at'   => $ts,
            'id'           => $docId,
        ])
        ->query();

    echo json_encode(
        [
            'success' => true,
            'data'    => [
                'document_id'   => $docId,
                'vault_id'      => $vaultId,
                'container_id'  => $targetCid,
            ],
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
    );
};
