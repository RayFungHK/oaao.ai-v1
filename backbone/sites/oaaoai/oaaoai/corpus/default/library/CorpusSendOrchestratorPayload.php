<?php

declare(strict_types=1);

namespace oaaoai\corpus;

use oaaoai\chat\ChatSendContext;

/**
 * Corpus-owned orchestrator payload fragments for chat send ({@code corpus_id}, {@code corpus_style}).
 */
final class CorpusSendOrchestratorPayload
{
    /**
     * @param array<string, mixed> $orchestratorPayload merged payload (for tenant_id)
     * @return array<string, mixed>
     */
    public static function buildFragment(
        ChatSendContext $ctx,
        array $orchestratorPayload,
        \Razy\Database $canonDb,
        object $user,
        ?int $workspaceId,
    ): array {
        $corpusIdRaw = $ctx->input['corpus_id'] ?? null;
        $corpusIdSend = ($corpusIdRaw === null || $corpusIdRaw === '') ? 0 : (int) $corpusIdRaw;
        if ($corpusIdSend < 1) {
            return [];
        }

        $tenantForCorpus = isset($orchestratorPayload['tenant_id']) ? (int) $orchestratorPayload['tenant_id'] : 0;
        if ($tenantForCorpus < 1) {
            $tenantForCorpus = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
        }

        $corpusStyle = CorpusStyleResolver::forChatRun(
            $canonDb,
            $corpusIdSend,
            max(1, $tenantForCorpus),
            $ctx->userId,
            $workspaceId,
        );
        if ($corpusStyle === null) {
            return [];
        }

        return [
            'corpus_id'    => $corpusIdSend,
            'corpus_style' => $corpusStyle,
        ];
    }
}
