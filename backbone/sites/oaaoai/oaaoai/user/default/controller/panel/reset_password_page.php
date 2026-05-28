<?php

declare(strict_types=1);

/**
 * GET /user/reset-password?token= — public password reset page.
 */
return function (): void {
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');

    require_once __DIR__ . '/_public_page_render.php';

    $token = trim((string) ($_GET['token'] ?? ''));
    oaao_user_render_public_page($this, 'reset_password_page', 'oaao-reset-token', $token);
};
