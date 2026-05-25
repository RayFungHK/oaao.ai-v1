<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /chat/api/evolution_cron_run — administrator: trigger daily or weekly evolution job.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }
    $job = strtolower(trim((string) ($input['job'] ?? 'daily')));
    $path = match ($job) {
        'weekly', 'weekly_apply' => '/v1/admin/evolution/weekly_apply',
        default => '/v1/admin/evolution/daily_report',
    };

    $resp = ChatOrchestratorApi::postInternalJson($path, [], 120);
    if (! \is_array($resp)) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unreachable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'job'    => $job,
            'result' => $resp,
        ],
    ], JSON_UNESCAPED_UNICODE);
};
