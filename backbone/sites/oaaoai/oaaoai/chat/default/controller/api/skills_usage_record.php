<?php

declare(strict_types=1);

use oaaoai\chat\ChatRunPrincipal;
use oaaoai\chat\MicroSkillStorage;

/**
 * POST /chat/api/skills_usage_record — internal orchestrator usage bump (CS-4-S7).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    if (! \is_string($hdr) || $hdr === '' || ! hash_equals($secret, $hdr)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $uid = (int) ($input['user_id'] ?? 0);
    $cid = (int) ($input['conversation_id'] ?? 0);
    $mid = (int) ($input['assistant_message_id'] ?? 0);
    if ($uid < 1 || $cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'user_id, conversation_id, assistant_message_id required']);

        return;
    }

    $token = isset($input['run_principal']) && \is_string($input['run_principal']) ? trim($input['run_principal']) : '';
    if ($token !== '') {
        $principal = ChatRunPrincipal::verify($token);
        if ($principal === null
            || (int) $principal['user_id'] !== $uid
            || (int) $principal['conversation_id'] !== $cid
            || (int) $principal['assistant_message_id'] !== $mid) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Invalid run_principal']);

            return;
        }
    }

    $rawIds = $input['skill_ids'] ?? [];
    $skillIds = [];
    if (\is_array($rawIds)) {
        foreach ($rawIds as $sid) {
            if (\is_string($sid) && trim($sid) !== '') {
                $skillIds[] = trim($sid);
            }
        }
    }
    if ($skillIds === []) {
        echo json_encode(['success' => true, 'data' => ['skills' => []]], JSON_UNESCAPED_UNICODE);

        return;
    }

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

        return;
    }
    $splitDb = $auth->getDBSplit();
    $pdo = $splitDb?->getDBAdapter();
    if (! $pdo instanceof \PDO) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable']);

        return;
    }

    $this->ensureMicroSkillSchema($pdo);

    $rows = MicroSkillStorage::recordUsage($pdo, $uid, $skillIds);
    echo json_encode(['success' => true, 'data' => ['skills' => $rows]], JSON_UNESCAPED_UNICODE);
};
