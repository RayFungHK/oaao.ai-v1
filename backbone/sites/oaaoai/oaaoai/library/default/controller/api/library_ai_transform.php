<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\corpus\CorpusRepository;
use oaaoai\library\LibraryLlmBootstrap;

/**
 * POST /library/api/library_ai_transform — CS-2-S5 selection AI (rewrite / expand / summarize).
 *
 * Body: {
 *   document_id, action?, selection_text?, block_id?, blocks?,
 *   corpus_id?, workspace_id?, skill_id?
 * }
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $docId = (int) ($input['document_id'] ?? 0);
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id required']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $st = $ctx['pdo']->prepare(
        'SELECT document_id, title, corpus_id FROM oaao_library_document WHERE document_id = ? AND tenant_id = ? LIMIT 1',
    );
    $st->execute([$docId, $tenantId]);
    $doc = $st->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($doc)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $selection = trim((string) ($input['selection_text'] ?? $input['text'] ?? ''));
    if ($selection === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'selection_text required']);

        return;
    }

    $action = trim((string) ($input['action'] ?? $input['skill_id'] ?? 'improve-writing'));
    if ($action === '') {
        $action = 'improve-writing';
    }

    $corpusId = isset($input['corpus_id']) ? (int) $input['corpus_id'] : (int) ($doc['corpus_id'] ?? 0);
    $corpusStyle = null;
    if ($corpusId > 0) {
        try {
            require_once dirname(__DIR__, 4) . '/corpus/default/library/CorpusRepository.php';
            $repo = new CorpusRepository($ctx['db']);
            $scopeWid = null;
            $widRaw = $input['workspace_id'] ?? null;
            if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
                $scopeWid = (int) $widRaw;
            }
            $profile = $repo->getProfileInScope($corpusId, $tenantId, $ctx['uid'], $scopeWid);
            if (\is_array($profile) && isset($profile['style_json'])) {
                $corpusStyle = $profile['style_json'];
            }
        } catch (\Throwable) {
            $corpusStyle = null;
        }
    }

    $llmCfg = LibraryLlmBootstrap::llmCfgForPayload(
        LibraryLlmBootstrap::resolveEditorLlm($this),
    );

    $payload = [
        'tenant_id'      => $tenantId,
        'document_id'    => $docId,
        'action'         => $action,
        'selection_text' => $selection,
        'title'          => (string) ($doc['title'] ?? ''),
        'block_id'       => $input['block_id'] ?? null,
        'blocks'         => \is_array($input['blocks'] ?? null) ? $input['blocks'] : [],
    ];
    if ($corpusId > 0) {
        $payload['corpus_id'] = $corpusId;
    }
    if ($corpusStyle !== null) {
        $payload['corpus_style'] = $corpusStyle;
    }
    if ($llmCfg !== null) {
        $payload['llm_cfg'] = $llmCfg;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/library/ai/transform', $payload, 90);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'transform_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'mode'    => (string) ($resp['mode'] ?? 'replace-selection'),
            'text'    => (string) ($resp['text'] ?? ''),
            'message' => (string) ($resp['message'] ?? ''),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
