<?php

declare(strict_types=1);

use Oaaoai\Core\OaaoBuildInfo;

/**
 * GET /user/api/release_notes_list?locale=en&since_build=
 *
 * PLAT-1-S5 — published release posts for workspace What's New.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }
    $auth->restrict(true);
    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $db = $auth->getDB();
    $pdo = $db instanceof \Razy\Database ? $db->getDBAdapter() : null;
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_release_post_schema.php';
    oaao_auth_ensure_release_post_schema($pdo);

    $locale = trim((string) ($_GET['locale'] ?? 'en'));
    if ($locale === '') {
        $locale = 'en';
    }
    $sinceBuild = trim((string) ($_GET['since_build'] ?? ''));

    $sql = 'SELECT release_post_id, slug, post_type, locale, version, build_id, title, body_md, published_at
            FROM oaao_release_post
            WHERE status = ? AND locale = ?
            ORDER BY published_at DESC NULLS LAST, release_post_id DESC
            LIMIT 80';
    $st = $pdo->prepare($sql);
    $st->execute(['published', $locale]);
    $rows = $st->fetchAll(\PDO::FETCH_ASSOC);
    $posts = [];
    if (\is_array($rows)) {
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $buildId = (string) ($row['build_id'] ?? '');
            if ($sinceBuild !== '' && $buildId !== '' && $buildId === $sinceBuild) {
                continue;
            }
            $posts[] = [
                'release_post_id' => (int) ($row['release_post_id'] ?? 0),
                'slug'              => (string) ($row['slug'] ?? ''),
                'post_type'         => (string) ($row['post_type'] ?? 'changelog'),
                'locale'            => (string) ($row['locale'] ?? $locale),
                'version'           => (string) ($row['version'] ?? ''),
                'build_id'          => $buildId,
                'title'             => (string) ($row['title'] ?? ''),
                'body_md'           => (string) ($row['body_md'] ?? ''),
                'published_at'      => $row['published_at'] ?? null,
            ];
        }
    }

    $payload = [
        'success' => true,
        'data'    => [
            'posts'       => $posts,
            'locale'      => $locale,
            'since_build' => $sinceBuild !== '' ? $sinceBuild : null,
        ],
    ];
    if (class_exists(OaaoBuildInfo::class)) {
        $payload = OaaoBuildInfo::mergeBuild($payload);
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
