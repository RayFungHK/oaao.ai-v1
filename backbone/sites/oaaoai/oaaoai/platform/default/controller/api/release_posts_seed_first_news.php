<?php

declare(strict_types=1);

use Oaaoai\Core\ReleasePostFirstNewsSeed;

/**
 * POST /platform/api/release_posts_seed_first_news — idempotent first news post + fan-out (ops).
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

    $this->api('auth')->ensureReleasePostSchema($pdo);
    $this->api('auth')->ensureNotificationSchema($pdo);

    ReleasePostFirstNewsSeed::ensureOnce($pdo);

    $st = $pdo->prepare(
        'SELECT release_post_id, slug, locale, status, fanout_status, fanout_notifications_total
         FROM oaao_release_post WHERE slug = ? ORDER BY locale ASC',
    );
    $st->execute([ReleasePostFirstNewsSeed::SEED_SLUG]);
    $rows = $st->fetchAll(\PDO::FETCH_ASSOC) ?: [];

    echo json_encode([
        'success' => true,
        'data'    => [
            'slug'  => ReleasePostFirstNewsSeed::SEED_SLUG,
            'posts' => $rows,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
