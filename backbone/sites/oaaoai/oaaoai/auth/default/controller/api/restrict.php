<?php

/**
 * Session gate — same identity as {@see resolveUser()} / {@see api/me}.
 *
 * Mirrors razit-user {@code restrict()} usage ({@code development-razy0.4}): modules call {@code api('auth')->restrict(...)}
 * instead of reimplementing cookie/session checks.
 *
 * JSON denials align with other oaao APIs ({@code success}, {@code message}, optional {@code data.sign_in_path}).
 *
 * @param bool $ajax When true (or X-Requested-With): JSON 401 + exit. Browser navigation otherwise redirects to {@see signInPath()}.
 */
return function (bool $ajax = false): void {
    $user = $this->resolveUser();
    if ($user) {
        return;
    }

    if ($ajax || ! empty($_SERVER['HTTP_X_REQUESTED_WITH'])) {
        http_response_code(401);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode([
            'success' => false,
            'message' => 'Not authenticated',
            'data'    => ['sign_in_path' => $this->signInPath()],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    header('Location: ' . $this->signInPath());
    exit;
};
