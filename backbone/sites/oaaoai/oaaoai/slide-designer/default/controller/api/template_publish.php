<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideTemplateLlm;
use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateScope;

/**
 * POST /slide-designer/api/template_publish
 * Body: { template_id, chat_endpoint_id?, auto_fix?: bool }
 */
return function (): void {
    \$chatApi = \$this->api('chat');
    if (! \$chatApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat orchestrator bridge unavailable']);
        return;
    }

    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user) {
        return;
    }

    $raw = file_get_contents('php://input');
    $body = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    if (! \is_array($body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'JSON body required']);

        return;
    }

    $templateId = trim((string) ($body['template_id'] ?? ''));
    if ($templateId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'template_id required']);

        return;
    }

    $autoFix = ! isset($body['auto_fix']) || $body['auto_fix'] !== false;

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth);
    $endpointPayload = SlideTemplateLlm::resolveAnalyzePayload($auth ? $auth->getDB() : null);
    if ($endpointPayload === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Slide template LLM is not configured (slide_template.* purpose).']);

        return;
    }

    $result = SlideOrchestrator::publishTemplate($chatApi, $templateId, $endpointPayload, $scopeCtx, $autoFix);
    if ($result === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $ok = (bool) ($result['ok'] ?? false);
    $published = (bool) ($result['published'] ?? false);
    http_response_code($ok ? 200 : 409);
    echo json_encode([
        'success'   => $ok,
        'published' => $published,
        'template'  => $result['template'] ?? null,
        'issues'    => $result['issues'] ?? [],
        'message'   => $ok
            ? 'Template published'
            : (string) ($result['error'] ?? 'Preview slides must pass verification before publish'),
    ], JSON_UNESCAPED_UNICODE);
};
