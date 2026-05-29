<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorAgents;
use oaaoai\chat\ChatSendOrchestratorBinding;
use oaaoai\chat\ChatSendOrchestratorStage;

/** Chat-owned {@code chat.send.orchestrator_ready} — bind, agents stages. */
return function (array $payload): void {
    $stage = (string) ($payload['stage'] ?? '');
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    if ($stage === ChatSendOrchestratorStage::BIND) {
        $canonDb = $payload['canonical_db'] ?? null;
        if (! $canonDb instanceof \Razy\Database) {
            return;
        }
        $ctx->binding = ChatSendOrchestratorBinding::resolveBinding($canonDb, $ctx->chatEndpointId);
        $ctx->internalBase = ChatSendOrchestratorBinding::resolveInternalBase();
        $ctx->orchReady = ChatSendOrchestratorBinding::isReady($ctx->binding, $ctx->internalBase);

        return;
    }

    if ($stage === ChatSendOrchestratorStage::AGENTS) {
        $bubbleThread = (bool) ($payload['bubble_thread'] ?? false);
        $endpointsApi = $payload['endpoints_api'] ?? null;
        $allowedAgents = ChatSendOrchestratorAgents::resolveAllowedAgents(
            \is_object($endpointsApi) ? $endpointsApi : null,
            $bubbleThread,
            $ctx->orchestratorUserContent,
            $ctx->hasPublishedSlideTemplate,
        );
        $ctx->mergePayloadFragment('chat', [
            'allowed_agents'    => $allowedAgents,
            'enable_web_search' => $ctx->enableWebSearch,
            'agent_catalog'     => ChatSendOrchestratorAgents::catalogForAllowed($allowedAgents),
        ]);
    }
};
