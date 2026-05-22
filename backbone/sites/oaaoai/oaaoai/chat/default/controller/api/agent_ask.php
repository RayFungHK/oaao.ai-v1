<?php

declare(strict_types=1);

/**
 * POST /chat/api/agent_ask — resume a paused run after user confirms or skips an agent step.
 *
 * Body JSON: { "run_id": string, "task_id": string, "decision": "proceed"|"skip"|"proceed_fork" }
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
    $taskId = isset($input['task_id']) && is_string($input['task_id']) ? trim($input['task_id']) : '';
    $decision = isset($input['decision']) && is_string($input['decision']) ? strtolower(trim($input['decision'])) : '';

    if ($runId === '' || strlen($runId) > 128 || $taskId === '' || strlen($taskId) > 128) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'run_id and task_id required']);

        return;
    }
    if (! \in_array($decision, ['proceed', 'skip', 'proceed_fork'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'decision must be proceed, skip, or proceed_fork']);

        return;
    }

    if ($this->getOrchestratorInternalBase() === '') {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Orchestrator not configured']);

        return;
    }

    $j = $this->resolveOrchestratorAgentAsk($runId, $taskId, $decision);
    if (! \is_array($j) || empty($j['ok'])) {
        http_response_code(502);
        $detail = isset($j['detail']) && is_string($j['detail']) ? trim($j['detail']) : '';
        $message = match ($detail) {
            'no_pending_ask'           => 'Confirmation expired or already answered — send a new message.',
            'orchestrator_unreachable' => 'Could not reach orchestrator.',
            default                    => 'Could not apply agent decision',
        };

        echo json_encode(['success' => false, 'message' => $message, 'detail' => $detail]);

        return;
    }

    echo json_encode([
        'success'       => true,
        'run_id'        => $runId,
        'task_id'       => $taskId,
        'decision'      => $decision,
        'client_action' => $decision === 'proceed_fork' ? 'fork_and_resend' : null,
    ]);
};
