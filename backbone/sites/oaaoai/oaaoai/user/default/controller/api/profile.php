<?php

/**
 * GET /user/api/profile — subset of authenticated user fields for SPA (no admin payload).
 *
 * Mirrors /auth/me shape where possible; excludes session secrets.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    $user = $auth ? $auth->getUser() : null;

    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'user_id'      => (int) ($user->user_id ?? 0),
            'email'        => $user->email ?? '',
            'display_name' => $user->display_name ?? '',
            'role'         => $user->role ?? '',
        ],
    ]);
};
