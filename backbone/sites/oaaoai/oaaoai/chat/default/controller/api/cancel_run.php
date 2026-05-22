<?php

declare(strict_types=1);

/**
 * POST /chat/api/cancel_run — request cooperative stop on an orchestrator StreamRun.
 *
 * Body JSON: { "run_id": string }
 */
return function (): void {
    [, $user] = $this->oaao_chat_require_user();
    if (! $user) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $runId = isset($input['run_id']) && is_string($input['run_id']) ? trim($input['run_id']) : '';
    if ($runId === '' || strlen($runId) > 128) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'run_id required']);

        return;
    }

    if ($this->getOrchestratorInternalBase() === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator not configured']);

        return;
    }

    $j = $this->cancelOrchestratorChatRun($runId);
    if ($j === null || empty($j['ok'])) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Could not cancel run']);

        return;
    }

    echo json_encode([
        'success' => true,
        'run_id'  => $runId,
    ]);
};
