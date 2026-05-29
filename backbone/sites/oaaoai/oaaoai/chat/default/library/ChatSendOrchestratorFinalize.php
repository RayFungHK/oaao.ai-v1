<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\corpus\CorpusStyleResolver;

/**
 * Final orchestrator payload overlays — inference params, corpus, library attach, run principal.
 */
final class ChatSendOrchestratorFinalize
{
    /**
     * @param array<string, int|float> $inferenceApplied
     * @param array<string, mixed> $inferenceSnapshot
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public static function buildFragment(
        ChatSendContext $ctx,
        array $payload,
        array $inferenceApplied,
        array $inferenceSnapshot,
        object $user,
        ?\Razy\Database $canonDb,
        ?int $workspaceId,
        int $conversationId,
        int $assistantMessageId,
        int $continueAssistantId,
    ): array {
        $fragment = [];

        if ($inferenceApplied !== []) {
            $fragment['model_params'] = $inferenceApplied;
            if (isset($inferenceApplied['temperature'])) {
                $fragment['temperature'] = (float) $inferenceApplied['temperature'];
            }
            if (isset($inferenceApplied['max_tokens'])) {
                $fragment['max_tokens'] = (int) $inferenceApplied['max_tokens'];
            }
        }
        if (($inferenceSnapshot['mode'] ?? '') === ChatInferenceControl::MODE_AUTO_TUNE) {
            $fragment['inference_mode'] = ChatInferenceControl::MODE_AUTO_TUNE;
            $fragment['inference_baseline'] = $inferenceApplied;
        } elseif (($inferenceSnapshot['mode'] ?? '') === ChatInferenceControl::MODE_MANUAL) {
            $fragment['inference_mode'] = ChatInferenceControl::MODE_MANUAL;
        }

        $corpusIdRaw = $ctx->input['corpus_id'] ?? null;
        $corpusIdSend = ($corpusIdRaw === null || $corpusIdRaw === '') ? 0 : (int) $corpusIdRaw;
        if ($corpusIdSend > 0 && $canonDb instanceof \Razy\Database) {
            $tenantForCorpus = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : 0;
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
            if ($corpusStyle !== null) {
                $fragment['corpus_id'] = $corpusIdSend;
                $fragment['corpus_style'] = $corpusStyle;
            }
        }

        $libraryDocIds = [];
        $libRaw = $ctx->input['library_doc_ids'] ?? $ctx->input['attached_library_doc_ids'] ?? null;
        if (\is_array($libRaw)) {
            foreach ($libRaw as $lid) {
                $n = (int) $lid;
                if ($n > 0) {
                    $libraryDocIds[$n] = $n;
                }
            }
        }
        if ($libraryDocIds !== []) {
            $fragment['library_doc_ids'] = array_values($libraryDocIds);
        }

        if ($ctx->appendAssistantTurn) {
            $fragment['append_assistant_content'] = true;
            $fragment['continue_assistant_message_id'] = $continueAssistantId;
        }

        $tenantForPrincipal = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : 0;
        $fragment['run_principal'] = ChatRunPrincipal::issue(
            $ctx->userId,
            $conversationId,
            $assistantMessageId,
            $workspaceId,
            $tenantForPrincipal > 0 ? $tenantForPrincipal : null,
        );

        return $fragment;
    }
}
