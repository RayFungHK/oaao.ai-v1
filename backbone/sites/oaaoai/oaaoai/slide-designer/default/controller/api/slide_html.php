<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideProjectRegistry;
use oaaoai\slide_designer\SlideProjectStorage;

/**
 * GET /slide-designer/api/slide_html?project_id=&page=&conversation_id=
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user(false);
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $projectId = isset($_GET['project_id']) && is_string($_GET['project_id'])
        ? trim($_GET['project_id'])
        : '';
    $page = max(1, (int) ($_GET['page'] ?? 1));
    $cid = (int) ($_GET['conversation_id'] ?? 0);

    if ($projectId === '') {
        http_response_code(400);
        echo 'project_id required';

        return;
    }

    if (SlideProjectRegistry::resolveProjectAccess($pdo, $projectId, $uid, $cid) === null) {
        http_response_code(404);
        echo 'Project not found';

        return;
    }

    $manifest = SlideProjectRegistry::loadManifest($projectId);
    if ($manifest === null) {
        http_response_code(404);
        echo 'Project files missing';

        return;
    }

    $rel = sprintf('slides/%02d/slide.html', $page);
    $pages = $manifest['pages'] ?? null;
    if (\is_array($pages)) {
        foreach ($pages as $p) {
            if (! \is_array($p)) {
                continue;
            }
            if ((int) ($p['index'] ?? 0) === $page && isset($p['html_path']) && is_string($p['html_path'])) {
                $rel = trim($p['html_path']);
                break;
            }
        }
    }

    $path = SlideProjectStorage::projectDir($projectId) . '/' . ltrim(str_replace(['..', '\\'], '', $rel), '/');
    if (! is_readable($path)) {
        http_response_code(404);
        echo 'Slide HTML not found';

        return;
    }

    $html = file_get_contents($path);
    if ($html === false) {
        http_response_code(500);
        echo 'Slide HTML unreadable';

        return;
    }

    require_once dirname(__DIR__, 2) . '/library/SlideCanvas.php';
    require_once dirname(__DIR__, 2) . '/library/SlideTemplateStorage.php';
    $html = \oaaoai\slide_designer\SlideCanvas::normalizeHtml($html);

    $auth = $this->api('auth');
    $scopeCtx = \oaaoai\slide_designer\SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
    $html = \oaaoai\slide_designer\SlideTemplateStorage::sanitizeSlideHtmlFontFaces($html, $scopeCtx);

    $templateId = trim((string) ($manifest['template_id'] ?? ''));
    $templatePage = $page;
    $slidesSpec = $manifest['slides_spec'] ?? null;
    if (\is_array($slidesSpec)) {
        foreach ($slidesSpec as $spec) {
            if (! \is_array($spec)) {
                continue;
            }
            if ((int) ($spec['index'] ?? 0) !== $page) {
                continue;
            }
            if ($templateId === '') {
                $templateId = trim((string) ($spec['template_id'] ?? ''));
            }
            $tplPage = (int) ($spec['template_page_index'] ?? 0);
            if ($tplPage > 0) {
                $templatePage = $tplPage;
            }
            break;
        }
    }

    $slotsPath = \dirname($path) . '/slots.json';
    $filledSlots = \oaaoai\slide_designer\SlideTemplateStorage::loadSlideSlotsFromPath($slotsPath);
    $skipDecor = $filledSlots !== [];
    if ($skipDecor) {
        $html = \oaaoai\slide_designer\SlideTemplateStorage::applyPptxSlotsToSlideHtml($html, $filledSlots);
    }

    if ($templateId !== '') {
        $html = \oaaoai\slide_designer\SlideTemplateStorage::enrichProjectSlideHtmlForPreview(
            $html,
            $templateId,
            $templatePage,
            $scopeCtx,
            $skipDecor,
        );
    }

    header('Content-Type: text/html; charset=UTF-8');
    header('X-Frame-Options: SAMEORIGIN');
    header('Cache-Control: private, max-age=300');
    echo $html;
};
