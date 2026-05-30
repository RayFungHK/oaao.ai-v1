<?php

declare(strict_types=1);

use oaaoai\calendar\CalendarSendPlannerPrompt;
use oaaoai\calendar\CalendarUpcomingForSend;
use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;

/** Calendar {@code chat.send.orchestrator_ready} — inject upcoming events + planner conflict context. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::PERSONALIZE) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $canonPdo = $payload['canonical_pdo'] ?? null;
    if (! $canonPdo instanceof \PDO) {
        return;
    }

    $user = $payload['user'] ?? null;
    $tenantId = \is_object($user) ? (int) ($user->tenant_id ?? 0) : 0;
    if ($tenantId < 1 && method_exists($this, 'api')) {
        $coreApi = $this->api('core');
        if ($coreApi && method_exists($coreApi, 'bootstrapTenantContext')) {
            $tenantId = (int) $coreApi->bootstrapTenantContext($canonPdo);
        }
    }
    if ($tenantId < 1) {
        return;
    }

    $wid = $ctx->workspaceId;
    $workspaceId = $wid !== null && $wid > 0 ? $wid : null;

    $events = CalendarUpcomingForSend::listForSend($canonPdo, $tenantId, $workspaceId);
    if ($events !== []) {
        $ctx->mergePayloadFragment('calendar', ['upcoming_calendar_events' => $events]);
    }

    /** @var array<string, mixed> $orchPayload */
    $orchPayload = (isset($payload['orchestrator_payload']) && \is_array($payload['orchestrator_payload']))
        ? $payload['orchestrator_payload']
        : [];
    $extra = CalendarSendPlannerPrompt::dynamicBlock($events);
    if ($extra === '') {
        return;
    }

    $pending = $ctx->mergedPayloadFragments();
    $base = trim((string) ($pending['planner_prompt_block'] ?? $orchPayload['planner_prompt_block'] ?? ''));
    $ctx->mergePayloadFragment('chat', [
        'planner_prompt_block' => $base !== '' ? $base . "\n" . $extra : $extra,
    ]);
};
