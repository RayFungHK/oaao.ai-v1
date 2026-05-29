<?php

declare(strict_types=1);

use oaaoai\user\UserModelParams;

/**
 * POST /user/api/model_params_save — UX-1 persist composer advanced overrides.
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

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $db = $auth->getDB();
    $pdo = $db instanceof \Razy\Database ? $db->getDBAdapter() : null;
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    require_once dirname(__DIR__, 2) . '/library/UserModelParams.php';

    $uid = (int) ($user->user_id ?? 0);
    $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
    $stmt->execute([$uid]);
    $raw = $stmt->fetchColumn();
    $prefs = [];
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $prefs = $decoded;
            }
        } catch (\JsonException) {
            $prefs = [];
        }
    }

    $patch = $input['model_params'] ?? $input;
    if (! \is_array($patch)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'model_params required']);

        return;
    }

    $merged = UserModelParams::mergeIntoPreferences($prefs, $patch);
    $json = json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $upd = $pdo->prepare(
        'UPDATE oaao_user SET preferences_json = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    );
    $upd->execute([$json, $uid]);

    echo json_encode([
        'success' => true,
        'data'    => [
            'model_params' => UserModelParams::fromPreferences($merged),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
