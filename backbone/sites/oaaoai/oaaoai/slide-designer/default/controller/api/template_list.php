<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateLlm;
use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * GET /slide-designer/api/template_list — builtin + scoped custom templates.
 * Query: published_only=1, scope_filter=global|tenant|personal
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

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth);
    $canonDb = $auth ? $auth->getDB() : null;
    $llmConfigured = SlideTemplateLlm::isAnalyzeConfigured($canonDb);
    $scopeCaps = SlideTemplateScope::scopeCapabilities($scopeCtx);

    $publishedOnly = isset($_GET['published_only']) && $_GET['published_only'] === '1';
    $scopeFilter = isset($_GET['scope_filter']) && is_string($_GET['scope_filter'])
        ? trim($_GET['scope_filter'])
        : null;

    $payload = SlideOrchestrator::listTemplates($chatApi, $scopeCtx, $publishedOnly, $scopeFilter);
    if ($payload === null) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Orchestrator unavailable',
            'data'    => [
                'custom_templates'               => [],
                'scope_capabilities'             => $scopeCaps,
                'template_analyze_llm_configured'  => $llmConfigured,
                'pptx_render_available'            => false,
            ],
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $payload['scope_capabilities'] = $scopeCaps;
    $payload['template_analyze_llm_configured'] = $llmConfigured;
    if (! isset($payload['pptx_render_available'])) {
        $payload['pptx_render_available'] = false;
    }
    $payload = SlideTemplateStorage::enrichCustomTemplateList($payload, $scopeCtx);

    echo json_encode([
        'success' => true,
        'data'    => $payload,
    ], JSON_UNESCAPED_UNICODE);
};
