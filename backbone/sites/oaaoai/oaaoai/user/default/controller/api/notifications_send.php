<?php

/**
 * POST /user/api/notifications_send — admin broadcast / targeted notification.
 *
 * Body JSON: `{ "user_id"?: number, "kind"?: string, "title": string, "body"?: string, "payload"?: object }`
 *
 * Omit {@code user_id} to fan out to all active users in the tenant (best-effort).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }

    $admin = $auth->requireAdmin();
    if (! $admin) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Admin required']);

        return;
    }

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database || ! \oaao_auth_database_is_pgsql($db)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'PostgreSQL required']);

        return;
    }

    $pdo = $db->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $auth->ensurePgCoreTables($db);
    $this->api('auth')->ensureNotificationSchema($pdo);

    require_once dirname(__DIR__, 4) . '/core/default/library/NotificationRepository.php';

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $body = $decoded;
            }
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);

            return;
        }
    }

    $title = trim((string) ($body['title'] ?? ''));
    if ($title === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'title required']);

        return;
    }

    $kind = trim((string) ($body['kind'] ?? 'news'));
    if ($kind === '') {
        $kind = 'news';
    }
    $msgBody = isset($body['body']) ? trim((string) $body['body']) : null;
    if ($msgBody === '') {
        $msgBody = null;
    }
    /** @var array<string, mixed> $payload */
    $payload = isset($body['payload']) && \is_array($body['payload']) ? $body['payload'] : [];

    $targetUid = isset($body['user_id']) ? (int) $body['user_id'] : 0;
    $repo = new \Oaaoai\Core\NotificationRepository($pdo);
    $created = 0;

    if ($targetUid > 0) {
        $id = $repo->create($targetUid, $kind, $title, $msgBody, $payload);
        if ($id > 0) {
            ++$created;
        }
    } else {
        $st = $pdo->query('SELECT user_id FROM oaao_user WHERE disabled = 0');
        if ($st instanceof \PDOStatement) {
            while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
                $uid = isset($row['user_id']) ? (int) $row['user_id'] : 0;
                if ($uid < 1) {
                    continue;
                }
                if ($repo->create($uid, $kind, $title, $msgBody, $payload) > 0) {
                    ++$created;
                }
            }
        }
    }

    echo json_encode([
        'success' => true,
        'created' => $created,
    ], JSON_UNESCAPED_UNICODE);
};
