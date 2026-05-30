<?php

declare(strict_types=1);

use Oaaoai\Core\ReleasePostFanout;

/**
 * POST /platform/api/release_posts_publish — PLAT-1 publish + enqueue batched notification fan-out.
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

    $this->api('auth')->ensureReleasePostSchema($pdo);
    $this->api('auth')->ensureNotificationSchema($pdo);

    $fanout = new ReleasePostFanout($pdo);
    $fanout->ensureSchema();

    $row = $fanout->loadPost($postId);
    if ($row === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Post not found']);

        return;
    }

    $published = $fanout->markPublished($postId, $row);
    $firstBatch = $fanout->processBatch($postId);

    echo json_encode([
        'success' => true,
        'data'    => [
            'release_post_id' => $postId,
            'status'          => 'published',
            'build_id'        => $published['build_id'],
            'version'         => $published['version'],
            'fanout'          => $firstBatch,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
