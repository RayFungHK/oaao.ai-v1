<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_auto_rag_set — toggle {@code oaao_vault.is_enabled} (auto-queue ingest jobs on upload).
 *
 * JSON body: {@code vault_id} (required), {@code auto_rag} (boolean — {@code true} = auto-index uploads),
 * optional {@code workspace_id} (shell gate).
 *
 * Existing documents are unchanged; only **future** uploads skip ingest when {@code auto_rag} is {@code false}.
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

    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'vault_id is required']);

        return;
    }

    if (! \array_key_exists('auto_rag', $body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'auto_rag is required']);

        return;
    }

    $autoRaw = $body['auto_rag'];
    $enabled = false;
    if (\is_bool($autoRaw)) {
        $enabled = $autoRaw;
    } elseif (\is_int($autoRaw) || \is_float($autoRaw)) {
        $enabled = ((int) $autoRaw) === 1;
    } elseif (\is_string($autoRaw)) {
        $t = strtolower(trim($autoRaw));
        $enabled = \in_array($t, ['1', 'true', 'yes', 'on'], true);
    } else {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid auto_rag']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $flag = $enabled ? 1 : 0;
    $ts = date('Y-m-d H:i:s');
    $db->update('vault', ['is_enabled', 'updated_at'])
        ->where('id=:id')
        ->assign([
            'is_enabled' => $flag,
            'updated_at' => $ts,
            'id'         => $vaultId,
        ])
        ->query();

    echo json_encode([
        'success' => true,
        'data'    => [
            'vault_id'  => $vaultId,
            'auto_rag'  => $enabled,
            'is_enabled'=> $flag,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
