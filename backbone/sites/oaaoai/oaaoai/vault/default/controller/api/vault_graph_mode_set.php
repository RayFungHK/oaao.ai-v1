<?php

declare(strict_types=1);

/**
 * POST /vault/api/vault_graph_mode_set — set {@code oaao_vault.graph_mode} (0 = off, non-zero = GraphRAG chain after embed).
 *
 * JSON body: {@code vault_id} (required), {@code graph_mode} (integer — typically 0 or 1),
 * optional {@code workspace_id} (shell gate).
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

    if (! \array_key_exists('graph_mode', $body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'graph_mode is required']);

        return;
    }

    $gmRaw = $body['graph_mode'];
    $mode = 0;
    if (\is_int($gmRaw)) {
        $mode = $gmRaw;
    } elseif (\is_float($gmRaw)) {
        $mode = (int) $gmRaw;
    } elseif (\is_string($gmRaw) && is_numeric(trim($gmRaw))) {
        $mode = (int) $gmRaw;
    } elseif (\is_bool($gmRaw)) {
        $mode = $gmRaw ? 1 : 0;
    } else {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid graph_mode']);

        return;
    }
    if ($mode < 0) {
        $mode = 0;
    }
    if ($mode > 32767) {
        $mode = 32767;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $ts = date('Y-m-d H:i:s');
    $db->update('vault', ['graph_mode', 'updated_at'])
        ->where('id=:id')
        ->assign([
            'graph_mode' => $mode,
            'updated_at' => $ts,
            'id'         => $vaultId,
        ])
        ->query();

    echo json_encode([
        'success' => true,
        'data'    => [
            'vault_id'   => $vaultId,
            'graph_mode' => $mode,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
