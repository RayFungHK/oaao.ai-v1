<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\endpoints\EndpointsSendOrchestratorPayload;

/** Endpoints {@code chat.send.orchestrator_ready} payload stage — purpose LLM bindings. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::PAYLOAD) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    $endpointsApi = $this;
    $ctx->mergePayloadFragment(
        'endpoints',
        EndpointsSendOrchestratorPayload::buildFragment(
            $endpointsApi,
            $ctx->vaultAutoRag,
            $ctx->vaultSourceRefs,
            $ctx->vaultSourceIds,
        ),
    );
};
