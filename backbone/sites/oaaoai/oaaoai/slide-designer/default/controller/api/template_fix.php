<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideTemplateLlm;
use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateScope;

/**
 * POST /slide-designer/api/template_fix
 * Body: { template_id, slide_index?, chat_endpoint_id? }
 * Omit slide_index to fix all unverified preview slides.
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

    $slideIndex = isset($body['slide_index']) ? (int) $body['slide_index'] : null;
    if ($slideIndex !== null && $slideIndex < 1) {
        $slideIndex = null;
    }

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
    $endpointPayload = SlideTemplateLlm::resolveAnalyzePayload($auth ? $auth->getDB() : null);
    if ($endpointPayload === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Slide template LLM is not configured (slide_template.* purpose).']);

        return;
    }

    $result = SlideOrchestrator::fixTemplatePreview($chatApi, $templateId, $endpointPayload, $scopeCtx, $slideIndex);
    if ($result === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $ok = (bool) ($result['ok'] ?? $result['verified'] ?? false);
    echo json_encode([
        'success' => true,
        'ok'      => $ok,
        'data'    => $result,
        'message' => $ok
            ? 'Preview slide verified'
            : 'Layout issues remain — try again or adjust source PPTX',
    ], JSON_UNESCAPED_UNICODE);
};
