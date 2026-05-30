<?php

/**
 * POST /user/api/notifications_mark_read — mark notification ids (or all) as read.
 *
 * Body JSON: `{ "ids"?: number[], "all"?: boolean }`
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

    $auth->restrict(true);
    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database || ! \oaao_auth_database_is_pgsql($db)) {
        echo json_encode(['success' => true, 'marked' => 0]);

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

    $repo = new \Oaaoai\Core\NotificationRepository($pdo);
    $marked = 0;
    if (! empty($body['all'])) {
        $marked = $repo->markAllRead($uid);
    } else {
        /** @var list<int> $ids */
        $ids = [];
        if (isset($body['ids']) && \is_array($body['ids'])) {
            foreach ($body['ids'] as $id) {
                if (\is_numeric($id)) {
                    $ids[] = (int) $id;
                }
            }
        }
        $marked = $repo->markRead($uid, $ids);
    }

    echo json_encode([
        'success'      => true,
        'marked'       => $marked,
        'unread_count' => $repo->unreadCount($uid),
    ], JSON_UNESCAPED_UNICODE);
};
