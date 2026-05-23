<?php

declare(strict_types=1);

/**
 * POST /user/api/profile_save — body JSON { display_name?, email? }
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
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $displayName = trim((string) ($body['display_name'] ?? $user->display_name ?? ''));
    $emailRaw = trim((string) ($body['email'] ?? $user->email ?? ''));
    $email = $emailRaw !== '' ? strtolower($emailRaw) : null;

    if ($displayName === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'display_name required']);

        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $db->prepare()
        ->update('user')
        ->set([
            'display_name' => $displayName,
            'email'        => $email,
            'updated_at'   => date('Y-m-d H:i:s'),
        ])
        ->where('user_id=?', ['user_id' => $uid])
        ->query();

    echo json_encode([
        'success' => true,
        'data'    => [
            'user_id'      => $uid,
            'display_name' => $displayName,
            'email'        => $email ?? '',
        ],
    ]);
};
