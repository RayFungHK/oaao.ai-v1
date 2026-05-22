<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * GET /slide-designer/api/template_render?template_id=&page=
 * Serves LibreOffice-rendered slide PNG from template asset dir.
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user(false);
    if (! $user) {
        return;
    }

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth);

    $templateId = isset($_GET['template_id']) && is_string($_GET['template_id'])
        ? trim($_GET['template_id'])
        : '';
    $page = max(1, (int) ($_GET['page'] ?? 1));

    if ($templateId === '') {
        http_response_code(400);
        echo 'template_id required';

        return;
    }

    $row = SlideTemplateStorage::resolveTemplateRecord($templateId, $scopeCtx);
    if ($row === null) {
        http_response_code(404);
        echo 'Template not found';

        return;
    }

    $path = SlideTemplateStorage::resolveRenderSlidePath($templateId, $page, $scopeCtx);
    if ($path === null) {
        http_response_code(404);
        echo 'Rendered slide not found';

        return;
    }

    header('Content-Type: image/png');
    header('Cache-Control: private, max-age=300');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
};
