<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';
require_once __DIR__ . '/_internal_auth.php';

use oaaoai\research\ResearchItemPurge;

/**
 * POST /research/api/item_refetch_purge — internal: delete old md/summary + clear embeddings for one item.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! oaao_research_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $itemId = isset($input['item_id']) ? (int) $input['item_id'] : 0;
    $vaultId = isset($input['vault_id']) ? (int) $input['vault_id'] : 0;
    if ($itemId < 1 || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'item_id and vault_id required']);

        return;
    }

    $auth = $this->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->api('auth')->ensurePgCoreTables($db);

    $stats = ResearchItemPurge::purgeResearchItem($db, $itemId, $vaultId);

    echo json_encode(['success' => true, 'purge' => $stats], JSON_UNESCAPED_UNICODE);
};
