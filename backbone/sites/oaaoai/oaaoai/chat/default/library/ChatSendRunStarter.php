<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Post-persist orchestrator run — context compact, payload assembly, POST {@code /v1/runs/chat}.
 */
final class ChatSendRunStarter
{
    /**
     * @param array{profile: array<string, mixed>, endpoint: array<string, mixed>, endpoint_id: int, temperature: float, max_tokens?: int}|null $binding
     * @param list<int> $attachmentIds
     * @param array<string, mixed> $input
     */
    public static function start(
        ChatSendPipeline $pipeline,
        ChatSendContext $ctx,
        object $chatController,
        \Razy\Database $splitDb,
        ?\Razy\Database $canonDb,
        object $user,
        ?object $authApi,
        int $uid,
        ?int $wid,
        int $conversationId,
        int $asstMsgId,
        int $continueAssistantId,
        string $orchestratorUserContent,
        string $conversationModeId,
        string $plannerModeId,
        bool $bubbleThread,
        bool $conversationCreated,
        bool $orchReady,
        ?array $binding,
        string $internalBase,
        int $chatEndpointId,
        array $attachmentIds,
        array $input,
        string $assistantOut,
    ): ChatSendRunResult {
        if (! $orchReady || $binding === null) {
            return new ChatSendRunResult(assistantOut: $assistantOut);
        }

        $secret = getenv('OAAO_ORCH_SHARED_SECRET');
        $secret = ($secret !== false && trim((string) $secret) !== '')
            ? trim((string) $secret)
            : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');

        $publicBase = getenv('OAAO_ORCHESTRATOR_PUBLIC_BASE');
        $publicBase = ($publicBase !== false && trim((string) $publicBase) !== '')
            ? rtrim(trim((string) $publicBase), '/')
            : $internalBase;
        $publicBase = OrchestratorPublicBase::forClientStream($publicBase);

        $canonPdoForPrompt = method_exists($chatController, 'oaao_chat_canonical_pdo')
            ? $chatController->oaao_chat_canonical_pdo()
            : null;
        $bindingForContext = $binding;
        $contextLimit = ChatContextUsage::resolveContextLimitFromBinding($bindingForContext);
        $tokenizerProfile = ChatTokenEstimator::resolveProfileFromBinding($bindingForContext);
        $splitPdoForCtx = $splitDb->getDBAdapter();
        $overheadTokens = ChatContextUsage::measureOverheadTokens(
            $chatController,
            $uid,
            $wid,
            $splitPdoForCtx instanceof \PDO ? $splitPdoForCtx : null,
            $canonPdoForPrompt instanceof \PDO ? $canonPdoForPrompt : null,
            'default',
            $tokenizerProfile,
        );
        $usageBeforeSend = ChatContextUsage::usageReport(
            $splitDb,
            $conversationId,
            $contextLimit,
            $canonPdoForPrompt instanceof \PDO
                ? ChatHistorySettings::resolvePromptMessageLimit($canonPdoForPrompt)
                : ChatHistorySettings::promptMessageLimit(),
            $overheadTokens,
            $canonPdoForPrompt instanceof \PDO ? $canonPdoForPrompt : null,
            $tokenizerProfile,
        );
        $outputReserve = ChatContextUsage::outputReserveTokens($bindingForContext, $contextLimit);
        $autoCompactApplied = false;
        if (
            ChatContextUsage::shouldAutoCompactBeforeSend(
                $usageBeforeSend,
                $contextLimit,
                $outputReserve,
                $canonPdoForPrompt instanceof \PDO ? $canonPdoForPrompt : null,
            )
        ) {
            ChatConversationCompact::apply(
                $splitDb,
                $conversationId,
                $uid,
                (int) ($wid ?? 0),
                $chatController,
            );
            $autoCompactApplied = true;
        }

        $messages = ChatHistorySettings::buildPromptMessagesFromDb(
            $splitDb,
            $conversationId,
            null,
            $canonPdoForPrompt instanceof \PDO ? $canonPdoForPrompt : null,
        );

        if ($orchestratorUserContent !== '') {
            for ($mi = \count($messages) - 1; $mi >= 0; $mi--) {
                if (($messages[$mi]['role'] ?? '') === 'user') {
                    $messages[$mi]['content'] = $orchestratorUserContent;
                    break;
                }
            }
        }

        $endpointRow = $binding['endpoint'];
        $profileRow = $binding['profile'];

        $endpointPayload = [
            'endpoint_ref' => trim((string) ($endpointRow['name'] ?? '')),
            'endpoint_id'  => (int) ($binding['endpoint_id'] ?? 0),
            'base_url'     => trim((string) ($endpointRow['base_url'] ?? '')),
            'model'        => trim((string) ($endpointRow['model'] ?? '')),
            'api_key_env'  => ChatOrchestratorBootstrap::inferApiKeyEnv(
                isset($endpointRow['api_key_ref']) ? (string) $endpointRow['api_key_ref'] : null
            ),
        ];
        $cfgRaw = isset($endpointRow['config_json']) ? trim((string) ($endpointRow['config_json'])) : '';
        if ($cfgRaw !== '') {
            try {
                /** @var mixed $cfgDec */
                $cfgDec = json_decode($cfgRaw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($cfgDec) && isset($cfgDec['supports_vision']) && $cfgDec['supports_vision']) {
                    $endpointPayload['capabilities'] = ['supports_vision' => true];
                }
                if (\is_array($cfgDec)) {
                    $endpointPayload['config'] = $cfgDec;
                    foreach (['knowledge_cutoff', 'knowledge_until', 'training_cutoff'] as $cutKey) {
                        if (isset($cfgDec[$cutKey]) && \is_string($cfgDec[$cutKey]) && trim($cfgDec[$cutKey]) !== '') {
                            $endpointPayload['knowledge_cutoff'] = trim($cfgDec[$cutKey]);
                            break;
                        }
                    }
                }
            } catch (\JsonException) {
            }
        }

        $payload = [
            'conversation_id'      => (string) $conversationId,
            'user_id'              => (string) $uid,
            'purpose_id'           => 'chat',
            'mode_id'              => $conversationModeId,
            'planner_mode_id'      => $plannerModeId,
            'messages'             => $messages,
            'temperature'          => $binding['temperature'],
            ...(isset($binding['max_tokens']) && (int) $binding['max_tokens'] > 0
                ? ['max_tokens' => (int) $binding['max_tokens']]
                : []),
            'endpoint'             => $endpointPayload,
            'chat_profile'         => [
                'id'   => (int) ($profileRow['id'] ?? 0),
                'name' => (string) ($profileRow['name'] ?? ''),
                'type' => strtolower(trim((string) ($profileRow['type'] ?? 'single'))),
            ],
            'assistant_message_id' => (string) $asstMsgId,
        ];

        $canonicalEndpointId = (int) ($binding['endpoint_id'] ?? 0);
        if ($canonicalEndpointId > 0) {
            $payload['endpoint_id'] = $canonicalEndpointId;
        }
        if ($chatEndpointId > 0) {
            $payload['chat_endpoint_id'] = $chatEndpointId;
        }
        $chatPurposeKey = 'chat';
        $profCfgRaw = isset($profileRow['config_json']) ? trim((string) ($profileRow['config_json'])) : '';
        if ($profCfgRaw !== '') {
            try {
                /** @var mixed $profCfgDec */
                $profCfgDec = json_decode($profCfgRaw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($profCfgDec)) {
                    $pk = trim((string) ($profCfgDec['purpose_key'] ?? ''));
                    if ($pk !== '') {
                        $chatPurposeKey = $pk;
                    }
                }
            } catch (\JsonException) {
            }
        }
        $profileIdForPurpose = (int) ($profileRow['id'] ?? 0);
        if ($chatPurposeKey === 'chat' && $profileIdForPurpose > 0 && (int) ($profileRow['is_default'] ?? 0) !== 1) {
            $chatPurposeKey = 'chat.profile.' . $profileIdForPurpose;
        }
        $payload['purpose_key'] = $chatPurposeKey;

        if ($canonDb instanceof \Razy\Database) {
            if (! $bubbleThread) {
                $reflectionCtx = ChatAccsReflection::consumePendingForSend(
                    $canonDb,
                    $splitDb,
                    $conversationId,
                    $asstMsgId,
                );
                if ($reflectionCtx !== null) {
                    $payload['accs_reflection_context'] = $reflectionCtx;
                }
            }
        }

        $endpointsApi = method_exists($chatController, 'api') ? $chatController->api('endpoints') : null;
        $pipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $ctx, [
            'stage'         => ChatSendOrchestratorStage::AGENTS,
            'endpoints_api' => $endpointsApi,
            'bubble_thread' => $bubbleThread,
        ]);

        $slideDesignerApi = method_exists($chatController, 'api') ? $chatController->api('slide_designer') : null;
        $splitPdo = $splitDb->getDBAdapter();
        $activeMaterialId = trim((string) ($input['active_material_id'] ?? ''));
        $reuseGroundingMid = (int) ($input['reuse_grounding_message_id'] ?? 0);
        $canonPdoGround = null;
        $tenantIdGround = 0;
        if ($canonDb instanceof \Razy\Database) {
            $canonPdoGround = $canonDb->getDBAdapter();
            if ($canonPdoGround instanceof \PDO) {
                $tenantIdGround = isset($user->tenant_id) ? (int) ($user->tenant_id ?? 0) : 0;
                if ($tenantIdGround < 1 && method_exists($chatController, 'api')) {
                    $coreApiGround = $chatController->api('core');
                    $tenantIdGround = $coreApiGround
                        ? $coreApiGround->bootstrapTenantContext($canonPdoGround)
                        : 0;
                }
            }
        }
        if ($splitPdo instanceof \PDO) {
            $pipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $ctx, [
                'stage'                => ChatSendOrchestratorStage::CORE,
                'split_db'             => $splitDb,
                'conversation_id'      => $conversationId,
                'bubble_thread'        => $bubbleThread,
                'conversation_created' => $conversationCreated,
                'user'                 => $user,
                'auth_api'             => $authApi,
                'endpoints_api'        => $endpointsApi,
                'slide_designer_api'   => $slideDesignerApi,
                'canonical_db'         => $canonDb,
                'attachment_ids'       => $attachmentIds,
            ]);
            $pipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $ctx, [
                'stage'                => ChatSendOrchestratorStage::SLIDE,
                'split_pdo'            => $splitPdo,
                'conversation_id'      => $conversationId,
                'bubble_thread'        => $bubbleThread,
                'active_material_id'   => $activeMaterialId,
                'reuse_grounding_mid'  => $reuseGroundingMid,
                'canonical_pdo_ground' => $canonPdoGround,
                'tenant_id_ground'     => $tenantIdGround,
            ]);
        }

        if ($canonDb instanceof \Razy\Database) {
            $canonPdoForVault = $canonDb->getDBAdapter();
            if ($canonPdoForVault instanceof \PDO && method_exists($chatController, 'api')) {
                $chatController->api('core')?->bootstrapTenantContext($canonPdoForVault);
            }
            $pipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $ctx, [
                'stage'        => ChatSendOrchestratorStage::PAYLOAD,
                'canonical_db' => $canonDb,
            ]);
            $payload = array_merge($payload, $ctx->drainPayloadFragments());
        }

        $canonPdoForPersonalization = method_exists($chatController, 'oaao_chat_canonical_pdo')
            ? $chatController->oaao_chat_canonical_pdo()
            : null;
        $pipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $ctx, [
            'stage'                => ChatSendOrchestratorStage::PERSONALIZE,
            'user'                 => $user,
            'canonical_pdo'        => $canonPdoForPersonalization,
            'conversation_id'      => $conversationId,
            'orchestrator_payload' => $payload,
        ]);
        $pipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $ctx, [
            'stage'                 => ChatSendOrchestratorStage::FINALIZE,
            'user'                  => $user,
            'canonical_db'          => $canonDb,
            'conversation_id'       => $conversationId,
            'assistant_message_id'  => $asstMsgId,
            'continue_assistant_id' => $continueAssistantId,
            'orchestrator_payload'  => $payload,
        ]);
        $payload = array_merge($payload, $ctx->drainPayloadFragments());

        $pipeline->run(ChatSendPhase::RUN_START, $ctx, [
            'orchestrator_payload' => $payload,
        ]);

        if (! method_exists($chatController, 'startOrchestratorChatRun')) {
            throw new \RuntimeException('Chat controller missing startOrchestratorChatRun');
        }
        $started = $chatController->startOrchestratorChatRun($payload);

        $streamUrl = null;
        $runId = null;
        $streamToken = null;
        if ($started === null) {
            $failStub = '*(Sidecar)* Could not start stream — check OAAO_ORCHESTRATOR_INTERNAL_URL and that the orchestrator is running.';
            $splitDb->update('message', ['content'])
                ->where('id=?,conversation_id=?')
                ->assign([
                    'content'         => $failStub,
                    'id'              => $asstMsgId,
                    'conversation_id' => $conversationId,
                ])
                ->query();
            $assistantOut = $failStub;
        } elseif ($publicBase !== '') {
            $runId = $started['run_id'];
            $streamToken = $started['stream_token'];
            $streamUrl = OrchestratorPublicBase::buildStreamUrl($publicBase, [
                'run_id' => $runId,
                'token'  => $streamToken,
            ]);
        }

        return new ChatSendRunResult(
            streamUrl: $streamUrl,
            runId: $runId,
            streamToken: $streamToken,
            assistantOut: $assistantOut,
            autoCompactApplied: $autoCompactApplied,
        );
    }
}
