<?php

declare(strict_types=1);

use oaaoai\calendar\CalendarLlmBootstrap;
use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /calendar/api/calendar_events_plan — planner step before save (CS-5).
 *
 * Body: title, notes, start_at, end_at, location?, locale?
 */
return function (): void {
    require_once __DIR__ . '/_calendar_api_bootstrap.php';

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_calendar_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $title = trim((string) ($input['title'] ?? ''));
    $startAt = trim((string) ($input['start_at'] ?? ''));
    $endAt = trim((string) ($input['end_at'] ?? ''));
    if ($title === '' || $startAt === '' || $endAt === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'title, start_at, end_at required']);

        return;
    }

    $locale = trim((string) ($input['locale'] ?? ''));
    if ($locale === '') {
        $accept = (string) ($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');
        $locale = $accept !== '' ? strtok($accept, ',;') : 'en';
    }

    $payload = [
        'tenant_id' => (int) $ctx['tenant_id'],
        'user_id'   => (int) $ctx['uid'],
        'title'     => $title,
        'notes'     => trim((string) ($input['notes'] ?? '')),
        'start_at'  => $startAt,
        'end_at'    => $endAt,
        'location'  => trim((string) ($input['location'] ?? '')),
        'locale'    => $locale,
    ];

    $llmCfg = CalendarLlmBootstrap::llmCfgForPayload(
        CalendarLlmBootstrap::resolvePlannerLlm($this),
    );
    if ($llmCfg !== null) {
        $payload['llm_cfg'] = $llmCfg;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/productivity/calendar/plan', $payload, 28);
    if ($resp === null || empty($resp['ok'])) {
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($resp['error'] ?? 'planner_failed'),
            'detail'  => $resp,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'title'    => (string) ($resp['title'] ?? $title),
            'notes'    => (string) ($resp['notes'] ?? ''),
            'location' => (string) ($resp['location'] ?? ''),
            'source'   => (string) ($resp['source'] ?? 'heuristic'),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
