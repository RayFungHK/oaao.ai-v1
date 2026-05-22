<?php

declare(strict_types=1);

use oaaoai\vault\VaultGlossary;

/**
 * GET /vault/api/glossary_get?vault_id=
 * POST /vault/api/glossary_set — body JSON { vault_id, glossary: { terms: [...] } }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $ctx = $this->oaao_vault_require_pg_api_context($_GET);
    if ($ctx === null) {
        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];
    $pdo = $ctx['pdo'];

    if ($method === 'GET') {
        $vaultId = isset($_GET['vault_id']) ? (int) $_GET['vault_id'] : 0;
        if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Forbidden']);

            return;
        }
        $glossary = VaultGlossary::loadVaultGlossary($db, $vaultId) ?? VaultGlossary::emptyDocument();
        echo json_encode(['success' => true, 'data' => ['vault_id' => $vaultId, 'glossary' => $glossary]], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $rawG = $body['glossary'] ?? null;
    if (! \is_array($rawG)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'glossary object required']);

        return;
    }

    $terms = $rawG['terms'] ?? [];
    $encoded = VaultGlossary::encode(VaultGlossary::parseJson(json_encode(['terms' => $terms], JSON_THROW_ON_ERROR)));

    $db->update('vault', ['glossary_json', 'updated_at'])
        ->where('id=:vid')
        ->assign([
            'glossary_json' => $encoded,
            'updated_at'    => date('Y-m-d H:i:s'),
            'vid'           => $vaultId,
        ])
        ->query();

    echo json_encode(['success' => true, 'data' => ['vault_id' => $vaultId]], JSON_UNESCAPED_UNICODE);
};
