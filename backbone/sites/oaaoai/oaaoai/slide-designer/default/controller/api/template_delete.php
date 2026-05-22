<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateScope;

/**
 * POST /slide-designer/api/template_delete
 * Body: { template_id }
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

    $result = SlideOrchestrator::deleteTemplate($chatApi, $templateId, $scopeCtx);
    if ($result === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $ok = (bool) ($result['ok'] ?? false);
    echo json_encode([
        'success'     => $ok,
        'deleted'     => (bool) ($result['deleted'] ?? false),
        'template_id' => $result['template_id'] ?? $templateId,
        'message'     => $ok ? 'Template deleted' : (string) ($result['detail'] ?? $result['error'] ?? 'delete_failed'),
    ], JSON_UNESCAPED_UNICODE);
};
