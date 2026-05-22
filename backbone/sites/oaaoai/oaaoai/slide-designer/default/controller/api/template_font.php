<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * GET /slide-designer/api/template_font?template_id=&path=materials/fonts/…
 * Serves cached / unpacked template fonts for @font-face (editor + master HTML).
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user(false);
    if (! $user) {
        return;
    }

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));

    $templateId = isset($_GET['template_id']) && is_string($_GET['template_id'])
        ? trim($_GET['template_id'])
        : '';
    $relPath = isset($_GET['path']) && is_string($_GET['path'])
        ? trim($_GET['path'])
        : '';

    if ($templateId === '' || $relPath === '') {
        http_response_code(400);
        echo 'template_id and path required';

        return;
    }

    $path = SlideTemplateStorage::resolveFontFilePath($templateId, $relPath, $scopeCtx);
    if ($path === null) {
        http_response_code(404);
        echo 'Font not found';

        return;
    }

    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $types = [
        'ttf'   => 'font/ttf',
        'otf'   => 'font/otf',
        'woff'  => 'font/woff',
        'woff2' => 'font/woff2',
    ];
    $mime = $types[$ext] ?? 'application/octet-stream';

    header('Content-Type: ' . $mime);
    header('Cache-Control: private, max-age=86400');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
};
