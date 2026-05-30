<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\todo\TodoOpenItemsForConversation;
use oaaoai\todo\TodoSendPlannerPrompt;

/** Todo {@code chat.send.orchestrator_ready} — ensure open todos + planner duplicate context. */
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

    $conversationId = (int) ($payload['conversation_id'] ?? 0);
    if ($conversationId < 1) {
        return;
    }

    $user = $payload['user'] ?? null;
    $uid = \is_object($user) ? (int) ($user->user_id ?? 0) : 0;
    $tenantId = \is_object($user) ? (int) ($user->tenant_id ?? 0) : 0;
    if ($uid < 1 || $tenantId < 1) {
        return;
    }

    $auth = $this->api('auth');
    if ($auth) {
        try {
            $auth->ensureTodoSchema($canonPdo);
        } catch (\Throwable) {
            /* schema ensure failed — still inject planner prompt; skip DB reads */
        }
    }

    /** @var array<string, mixed> $orchPayload */
    $orchPayload = (isset($payload['orchestrator_payload']) && \is_array($payload['orchestrator_payload']))
        ? $payload['orchestrator_payload']
        : [];

    /** @var list<array{todo_id: int, title: string}> $openItems */
    $openItems = [];
    $rawOpen = $orchPayload['open_todo_items'] ?? null;
    if (\is_array($rawOpen) && $rawOpen !== []) {
        foreach ($rawOpen as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $tid = (int) ($row['todo_id'] ?? 0);
            $title = trim((string) ($row['title'] ?? ''));
            if ($tid > 0 && $title !== '') {
                $openItems[] = ['todo_id' => $tid, 'title' => $title];
            }
        }
    }
    if ($openItems === []) {
        try {
            $openItems = TodoOpenItemsForConversation::listForConversation(
                $canonPdo,
                $tenantId,
                $uid,
                $conversationId,
            );
        } catch (\Throwable) {
            $openItems = [];
        }
    }
    if ($openItems !== []) {
        $ctx->mergePayloadFragment('todo', ['open_todo_items' => $openItems]);
    }

    $extra = TodoSendPlannerPrompt::dynamicBlock($openItems);
    if ($extra === '') {
        return;
    }

    $pending = $ctx->mergedPayloadFragments();
    $base = trim((string) ($pending['planner_prompt_block'] ?? $orchPayload['planner_prompt_block'] ?? ''));
    $ctx->mergePayloadFragment('chat', [
        'planner_prompt_block' => $base !== '' ? $base . "\n" . $extra : $extra,
    ]);
};
