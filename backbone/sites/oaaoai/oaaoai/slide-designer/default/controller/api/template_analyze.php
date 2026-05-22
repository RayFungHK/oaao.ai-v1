<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideTemplateLlm;
use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * POST /slide-designer/api/template_analyze
 * multipart: pptx, label?, notes?, scope? (tenant|personal; global via platform only), chat_endpoint_id?
 */
return function (): void {
    $chatApi = $this->api('chat');
    if (! $chatApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat orchestrator bridge unavailable']);
        return;
    }

    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
    $writeScope = SlideTemplateScope::normalizeScope(
        isset($_POST['scope']) ? (string) $_POST['scope'] : null,
    );
    if (! SlideTemplateScope::canWriteScope($scopeCtx, $writeScope)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => "Cannot import to scope: {$writeScope}"]);

        return;
    }

    $file = $_FILES['pptx'] ?? null;
    if (! is_array($file) || (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'pptx file required']);

        return;
    }

    $orig = (string) ($file['name'] ?? 'deck.pptx');
    $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
    if ($ext !== 'pptx') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Only .pptx is supported']);

        return;
    }

    $incoming = SlideTemplateStorage::incomingDir();
    $safeName = 'import_' . bin2hex(random_bytes(8)) . '.pptx';
    $dest = $incoming . '/' . $safeName;
    if (! move_uploaded_file((string) $file['tmp_name'], $dest)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Upload failed']);

        return;
    }

    $label = trim((string) ($_POST['label'] ?? ''));
    $notes = trim((string) ($_POST['notes'] ?? ''));
    $origName = trim((string) ($_FILES['pptx']['name'] ?? $_POST['original_filename'] ?? ''));
    if ($label === '' && $origName !== '') {
        $label = pathinfo($origName, PATHINFO_FILENAME);
    }

    $canonDb = $auth ? $auth->getDB() : null;
    $endpointPayload = SlideTemplateLlm::resolveAnalyzePayload($canonDb);
    if ($endpointPayload === null) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Slide template LLM is not configured. In Settings → Purpose allocation, assign an endpoint to the Slide template slot (slide_template.*).',
        ]);

        return;
    }

    $generatePreview = ! isset($_POST['generate_preview']) || $_POST['generate_preview'] !== '0';

    $result = SlideOrchestrator::startAnalyzeTemplate($chatApi, 
        $dest,
        $endpointPayload,
        $scopeCtx,
        $writeScope,
        $label !== '' ? $label : null,
        $notes !== '' ? $notes : null,
        $generatePreview,
    );

    if ($result === null) {
        if ($chatApi->getOrchestratorInternalBase() === '') {
            $message = 'Orchestrator URL not configured (OAAO_ORCHESTRATOR_INTERNAL_URL).';
        } elseif (! is_readable($dest)) {
            $message = 'Uploaded PPTX is not readable on the web server.';
        } else {
            $message =
                'Orchestrator unreachable or cannot read the uploaded PPTX. '
                . 'Start the oaao orchestrator sidecar and ensure it mounts the same '
                . 'slide-templates/custom/incoming directory as PHP '
                . '(see data/slide-templates/custom/incoming).';
        }
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => $message]);

        return;
    }

    $jobId = trim((string) ($result['job_id'] ?? ''));
    if ($jobId !== '' && (string) ($result['status'] ?? '') === 'running') {
        echo json_encode([
            'success' => true,
            'job_id'  => $jobId,
            'status'  => 'running',
            'message' => 'Template import started',
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    $ok = (bool) ($result['ok'] ?? false);
    if (! $ok) {
        $detail = trim((string) ($result['detail'] ?? $result['error'] ?? 'analyze_failed'));
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => $detail], JSON_UNESCAPED_UNICODE);

        return;
    }
    echo json_encode([
        'success'  => $ok,
        'template' => $result['template'] ?? null,
        'preview'  => $result['preview'] ?? null,
        'issues'   => $result['preview']['issues'] ?? $result['issues'] ?? [],
        'message'  => $ok ? 'Template analyzed' : (string) ($result['detail'] ?? $result['error'] ?? 'analyze_failed'),
    ], JSON_UNESCAPED_UNICODE);
};
