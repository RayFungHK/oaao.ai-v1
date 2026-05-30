<?php

declare(strict_types=1);

use Oaaoai\Core\NotificationRepository;
use Oaaoai\Core\OaaoBuildInfo;

/**
 * GET /user/api/notifications_list — unread + recent notifications for signed-in user.
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

    $uid = (int) ($user->user_id ?? 0);
    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database || ! \oaao_auth_database_is_pgsql($db)) {
        echo json_encode(
            OaaoBuildInfo::mergeBuild(['success' => true, 'notifications' => [], 'unread_count' => 0]),
            JSON_UNESCAPED_UNICODE,
        );

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

    $unreadOnly = isset($_GET['unread_only']) && (string) $_GET['unread_only'] === '1';
    $limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;

    $repo = new NotificationRepository($pdo);
    $rows = $repo->listForUser($uid, $limit, $unreadOnly);
    $notifications = [];
    foreach ($rows as $row) {
        $payload = null;
        $raw = $row['payload_json'] ?? null;
        if (\is_string($raw) && $raw !== '') {
            try {
                $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($decoded)) {
                    $payload = $decoded;
                }
            } catch (\JsonException) {
            }
        }
        unset($row['payload_json']);
        $row['payload'] = $payload;
        $row['read'] = isset($row['read_at']) && $row['read_at'] !== null && $row['read_at'] !== '';
        $notifications[] = $row;
    }

    echo json_encode(
        OaaoBuildInfo::mergeBuild([
            'success'       => true,
            'notifications' => $notifications,
            'unread_count'  => $repo->unreadCount($uid),
        ]),
        JSON_UNESCAPED_UNICODE,
    );
};
