<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\slide_designer\SlideSendOrchestratorPayload;

/** Slide-designer {@code chat.send.orchestrator_ready} slide stage — deck payload + materials. */
return function (array $payload): void {
    if (($payload['stage'] ?? '') !== ChatSendOrchestratorStage::SLIDE) {
        return;
    }

    $ctx = $payload['context'] ?? null;
    $splitPdo = $payload['split_pdo'] ?? null;
    $conversationId = (int) ($payload['conversation_id'] ?? 0);
    if (! $ctx instanceof ChatSendContext || ! $splitPdo instanceof \PDO) {
        return;
    }

    $bubbleThread = (bool) ($payload['bubble_thread'] ?? false);
    $activeMaterialId = isset($payload['active_material_id']) && \is_string($payload['active_material_id'])
        ? trim($payload['active_material_id'])
        : '';
    $reuseGroundingMid = (int) ($payload['reuse_grounding_mid'] ?? 0);
    $canonPdoGround = $payload['canonical_pdo_ground'] ?? null;
    $tenantIdGround = (int) ($payload['tenant_id_ground'] ?? 0);

    $ctx->mergePayloadFragment(
        'slide_designer',
        SlideSendOrchestratorPayload::buildFragment(
            $this,
            $ctx,
            $splitPdo,
            $conversationId,
            $bubbleThread,
            $activeMaterialId,
            $reuseGroundingMid,
            $canonPdoGround instanceof \PDO ? $canonPdoGround : null,
            $tenantIdGround,
        ),
    );
};
