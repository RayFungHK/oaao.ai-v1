<?php

/**
 * GET /api/me — Return current authenticated user info.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $user = $this->resolveUser();
    if (!$user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated']);
        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'user_id'      => (int) $user->user_id,
            'email'        => $user->email ?? '',
            'display_name' => $user->display_name,
            'role'         => $user->role,
            'session_key'  => $user->session_key,
        ],
    ]);
};
