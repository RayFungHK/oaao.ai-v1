<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;
use oaaoai\mine\MineStorage;

/**
 * POST /mine/api/mine_delete
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $mineId = isset($input['mine_id']) ? (int) $input['mine_id'] : 0;
    if ($mineId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'mine_id required']);

        return;
    }

    $repo = new MineRepository($ctx['db']);
    $mine = $repo->getMine($mineId, $ctx['tenant_id'], $ctx['uid']);
    if ($mine === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Mine not found']);

        return;
    }

    $rel = isset($mine['sqlite_path']) && \is_string($mine['sqlite_path']) ? trim($mine['sqlite_path']) : '';
    $repo->deleteMine($mineId);
    if ($rel !== '') {
        $abs = MineStorage::absPath($rel);
        if ($abs !== '' && is_file($abs)) {
            @unlink($abs);
        }
    }

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
