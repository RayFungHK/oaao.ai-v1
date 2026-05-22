<?php

/**
 * POST /api/logout — Destroy session and clear cookie.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $db = $this->getDB();
    $user = $this->resolveUser();

    if ($user && $db) {
        $user->clearSession($db);
    }

    setcookie($this->getSessionCookieName(), '', [
        'expires'  => time() - 3600,
        'path'     => $this->getSessionCookiePath(),
        'httponly'  => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']),
    ]);

    echo json_encode(['success' => true, 'message' => 'Logged out']);
};
