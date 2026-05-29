<?php

declare(strict_types=1);

use Oaaoai\Core\NotificationRepository;
use Oaaoai\Core\OaaoBuildInfo;

/**
 * POST /platform/api/release_posts_publish — PLAT-1 publish + cross-tenant notification fan-out.
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

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_release_post_schema.php';
    oaao_auth_ensure_release_post_schema($pdo);
    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_notification_schema.php';
    oaao_auth_ensure_notification_schema($pdo);

    $st = $pdo->prepare('SELECT * FROM oaao_release_post WHERE release_post_id = ? LIMIT 1');
    $st->execute([$postId]);
    $row = $st->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($row)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Post not found']);

        return;
    }

    $build = OaaoBuildInfo::load();
    $buildId = trim((string) ($row['build_id'] ?? ''));
    if ($buildId === '') {
        $buildId = (string) ($build['build_id'] ?? 'unknown');
    }
    $version = trim((string) ($row['version'] ?? ''));
    if ($version === '') {
        $version = (string) ($build['version'] ?? '0.0.0');
    }

    $upd = $pdo->prepare(
        'UPDATE oaao_release_post SET status = ?, published_at = CURRENT_TIMESTAMP, build_id = ?, version = ?,
                updated_at = CURRENT_TIMESTAMP WHERE release_post_id = ?',
    );
    $upd->execute(['published', $buildId, $version, $postId]);

    $title = trim((string) ($row['title'] ?? 'Release notes'));
    $slug = trim((string) ($row['slug'] ?? ''));
    $notifyTitle = $title;
    $notifyBody = mb_substr(trim((string) ($row['body_md'] ?? '')), 0, 280);
    $payload = [
        'release_post_id'    => $postId,
        'release_version'    => $version,
        'release_build_id'   => $buildId,
        'release_slug'       => $slug,
        'post_type'          => (string) ($row['post_type'] ?? 'changelog'),
    ];

    $repo = new NotificationRepository($pdo);
    $created = 0;
    $userSt = $pdo->query('SELECT user_id FROM oaao_user WHERE disabled = 0');
    if ($userSt instanceof \PDOStatement) {
        while (($u = $userSt->fetch(\PDO::FETCH_ASSOC)) !== false) {
            $uid = isset($u['user_id']) ? (int) $u['user_id'] : 0;
            if ($uid < 1) {
                continue;
            }
            if ($repo->create($uid, 'release', $notifyTitle, $notifyBody !== '' ? $notifyBody : null, $payload) > 0) {
                ++$created;
            }
        }
    }

    echo json_encode([
        'success'  => true,
        'data'     => [
            'release_post_id' => $postId,
            'status'          => 'published',
            'notifications'   => $created,
            'build_id'        => $buildId,
            'version'         => $version,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
