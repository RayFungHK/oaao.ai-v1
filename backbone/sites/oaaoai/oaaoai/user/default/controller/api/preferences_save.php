<?php

declare(strict_types=1);

/**
 * POST /user/api/preferences_save — body JSON { locale? }
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

    require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_credit_schema.php';
    oaao_auth_ensure_credit_schema($pdo);

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $locale = trim((string) ($body['locale'] ?? ''));
    $allowed = ['en', 'zh-Hant'];
    if ($locale !== '' && ! \in_array($locale, $allowed, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Unsupported locale']);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    $prefs = [];
    $raw = $stmt->fetchColumn();
    if (\is_string($raw) && trim($raw) !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $prefs = $decoded;
            }
        } catch (\JsonException) {
            $prefs = [];
        }
    }

    if ($locale !== '') {
        $prefs['locale'] = $locale;
    }

    $json = json_encode($prefs, JSON_UNESCAPED_UNICODE);
    $pdo->prepare(
        'UPDATE oaao_user SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    )->execute([$json, $uid]);

    echo json_encode([
        'success' => true,
        'data'    => ['locale' => $prefs['locale'] ?? 'en', 'preferences' => $prefs],
    ]);
};
