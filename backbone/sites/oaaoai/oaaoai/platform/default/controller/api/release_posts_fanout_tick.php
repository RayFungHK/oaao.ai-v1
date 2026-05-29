<?php

declare(strict_types=1);

use Oaaoai\Core\ReleasePostFanout;

/**
 * POST /platform/api/release_posts_fanout_tick — resume PLAT-1-S4 fan-out batches.
 */
return function (): void {
    $db = $this->oaao_platform_require_pg();
    if ($db === null) {
        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $postId = (int) ($input['release_post_id'] ?? 0);
    if ($postId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'release_post_id required']);

        return;
    }

    $fanout = new ReleasePostFanout($pdo);
    $fanout->ensureSchema();
    $result = $fanout->processBatch($postId);

    echo json_encode([
        'success' => true,
        'data'    => array_merge(['release_post_id' => $postId], $result),
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
