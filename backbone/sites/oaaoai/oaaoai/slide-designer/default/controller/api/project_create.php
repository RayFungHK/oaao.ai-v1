<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideProjectRegistry;

/**
 * POST /slide-designer/api/project_create
 *
 * Body JSON: { conversation_id, title?, slide_count? }
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $raw = file_get_contents('php://input');
    $body = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    if (! \is_array($body)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'JSON body required']);

        return;
    }

    $cid = (int) ($body['conversation_id'] ?? 0);
    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    $title = isset($body['title']) && is_string($body['title']) ? trim($body['title']) : 'Slide project';
    $slideCount = (int) ($body['slide_count'] ?? 10);
    $wid = isset($body['workspace_id']) ? (int) $body['workspace_id'] : null;
    if ($wid !== null && $wid < 1) {
        $wid = null;
    }

    try {
        $templateId = isset($body['template_id']) && is_string($body['template_id'])
            ? trim($body['template_id'])
            : null;

        $manifest = SlideProjectRegistry::createProject(
            $pdo,
            $uid,
            $cid,
            $wid,
            $title,
            $slideCount,
            $templateId !== '' ? $templateId : null,
        );
        echo json_encode([
            'success' => true,
            'data'    => [
                'project_id' => $manifest['project_id'],
                'manifest'   => $manifest,
            ],
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        error_log('slide project_create: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not create project']);
    }
};
