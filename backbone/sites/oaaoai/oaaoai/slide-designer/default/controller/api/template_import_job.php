<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateScope;

/**
 * GET /slide-designer/api/template_import_job?job_id=
 */
return function (): void {
    \$chatApi = \$this->api('chat');
    if (! \$chatApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat orchestrator bridge unavailable']);
        return;
    }

    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth);

    $jobId = trim((string) ($_GET['job_id'] ?? ''));
    if ($jobId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'job_id required']);

        return;
    }

    $result = SlideOrchestrator::getTemplateImportJob($chatApi, $jobId, $scopeCtx);
    if ($result === null) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Orchestrator unreachable or job not found.',
        ]);

        return;
    }

    $status = (string) ($result['status'] ?? '');
    if ($status === 'running') {
        echo json_encode([
            'success' => true,
            'job_id'  => $jobId,
            'status'  => 'running',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($status === 'failed') {
        $detail = trim((string) ($result['detail'] ?? $result['error'] ?? 'analyze_failed'));
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'job_id'  => $jobId,
            'status'  => 'failed',
            'message' => $detail,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $ok = (bool) ($result['ok'] ?? false);
    echo json_encode([
        'success'  => $ok,
        'job_id'   => $jobId,
        'status'   => 'done',
        'template' => $result['template'] ?? null,
        'preview'  => $result['preview'] ?? null,
        'issues'   => $result['preview']['issues'] ?? $result['issues'] ?? [],
        'message'  => $ok ? 'Template analyzed' : (string) ($result['detail'] ?? $result['error'] ?? 'analyze_failed'),
    ], JSON_UNESCAPED_UNICODE);
};
