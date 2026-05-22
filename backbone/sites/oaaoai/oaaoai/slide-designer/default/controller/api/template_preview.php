<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateLlm;
use oaaoai\slide_designer\SlideTemplateScope;

/**
 * POST /slide-designer/api/template_preview
 * Body: { template_id, chat_endpoint_id? }
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

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
    $endpointPayload = SlideTemplateLlm::resolveAnalyzePayload($auth ? $auth->getDB() : null);
    if ($endpointPayload === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Slide template LLM is not configured (slide_template.* purpose).']);

        return;
    }

    $result = SlideOrchestrator::generateTemplatePreview($chatApi, $templateId, $endpointPayload, $scopeCtx);
    if ($result === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $ok = (bool) ($result['ok'] ?? false);
    echo json_encode([
        'success'  => true,
        'ok'       => $ok,
        'template' => $result['template'] ?? null,
        'preview'  => $result['preview'] ?? null,
        'issues'   => $result['issues'] ?? [],
        'message'  => $ok
            ? 'Preview slides generated'
            : 'Preview generated with layout issues — use template_fix',
    ], JSON_UNESCAPED_UNICODE);
};
