<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideCanvas;
use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * GET /slide-designer/api/template_preview_html?template_id=&page=
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

    $path = SlideTemplateStorage::resolvePreviewHtmlPath($templateId, $page, $scopeCtx);
    if ($path === null) {
        http_response_code(404);
        echo 'Preview HTML not found';

        return;
    }

    $html = file_get_contents($path);
    if ($html === false) {
        http_response_code(500);
        echo 'Preview HTML unreadable';

        return;
    }

    $html = SlideCanvas::normalizeHtml($html);
    $html = SlideTemplateStorage::sanitizeSlideHtmlFontFaces($html, $scopeCtx);

    header('Content-Type: text/html; charset=UTF-8');
    header('X-Frame-Options: SAMEORIGIN');
    header('Cache-Control: private, max-age=300');
    echo $html;
};
