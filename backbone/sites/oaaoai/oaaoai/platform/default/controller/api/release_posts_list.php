<?php

declare(strict_types=1);

/**
 * GET /platform/api/release_posts_list — PLAT-1 CMS list (draft + published).
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

    $st = $pdo->query(
        'SELECT release_post_id, slug, post_type, locale, version, build_id, title, body_md, status,
                published_at::text AS published_at, created_at::text AS created_at, updated_at::text AS updated_at
         FROM oaao_release_post
         ORDER BY updated_at DESC
         LIMIT 200',
    );
    $rows = $st instanceof \PDOStatement ? $st->fetchAll(\PDO::FETCH_ASSOC) : [];

    echo json_encode([
        'success' => true,
        'data'    => ['posts' => \is_array($rows) ? $rows : []],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
