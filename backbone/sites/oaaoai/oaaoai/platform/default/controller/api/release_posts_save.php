<?php

declare(strict_types=1);

use Oaaoai\Core\OaaoBuildInfo;

/**
 * POST /platform/api/release_posts_save — PLAT-1 create/update draft release post.
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

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_release_post_schema.php';
    oaao_auth_ensure_release_post_schema($pdo);

    $postId = (int) ($input['release_post_id'] ?? 0);
    $title = trim((string) ($input['title'] ?? ''));
    if ($title === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'title required']);

        return;
    }

    $slug = trim((string) ($input['slug'] ?? ''));
    if ($slug === '') {
        $slug = 'release-' . preg_replace('/[^a-z0-9]+/i', '-', strtolower($title));
        $slug = trim($slug, '-') ?: 'release-' . time();
    }
    $postType = trim((string) ($input['post_type'] ?? 'changelog'));
    if (! \in_array($postType, ['changelog', 'news'], true)) {
        $postType = 'changelog';
    }
    $locale = trim((string) ($input['locale'] ?? 'en')) ?: 'en';
    $version = trim((string) ($input['version'] ?? OaaoBuildInfo::load()['version'] ?? '0.0.0'));
    $buildId = trim((string) ($input['build_id'] ?? ''));
    $bodyMd = (string) ($input['body_md'] ?? '');
    $status = trim((string) ($input['status'] ?? 'draft'));
    if (! \in_array($status, ['draft', 'published'], true)) {
        $status = 'draft';
    }

    if ($postId > 0) {
        $upd = $pdo->prepare(
            'UPDATE oaao_release_post SET slug = ?, post_type = ?, locale = ?, version = ?, build_id = ?,
                    title = ?, body_md = ?, status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE release_post_id = ?',
        );
        $upd->execute([$slug, $postType, $locale, $version, $buildId, $title, $bodyMd, $status, $postId]);
    } else {
        $ins = $pdo->prepare(
            'INSERT INTO oaao_release_post (slug, post_type, locale, version, build_id, title, body_md, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING release_post_id',
        );
        $ins->execute([$slug, $postType, $locale, $version, $buildId, $title, $bodyMd, $status]);
        $postId = (int) $ins->fetchColumn();
    }

    echo json_encode([
        'success' => true,
        'data'    => ['release_post_id' => $postId, 'slug' => $slug, 'status' => $status],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
