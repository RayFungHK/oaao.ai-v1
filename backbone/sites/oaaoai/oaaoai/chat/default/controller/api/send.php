<?php

use oaaoai\chat\ChatAccsReflection;
use oaaoai\chat\ChatContextUsage;
use oaaoai\chat\ChatConversationCompact;
use oaaoai\chat\ChatTokenEstimator;
use oaaoai\chat\ChatHistorySettings;
use oaaoai\chat\ChatInferenceControl;
use oaaoai\chat\ChatSendAbort;
use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\chat\ChatSendPersist;
use oaaoai\chat\ChatSendPhase;
use oaaoai\chat\ChatSendPipeline;
use oaaoai\chat\ChatTeachingIntent;
use oaaoai\user\UserModelParams;

/**
 * POST /chat/api/send — append user message + assistant row; when orchestrator + binding exist, start Python stream run.
 *
 * Body JSON: { "conversation_id": number|null, "content": string, "chat_endpoint_id"?: number|null, "workspace_id"?: number,
 *             "vault_source_ids"?: number[], "vault_source_refs"?: { kind: "vault"|"folder"|"document", id: number, vault_id: number, name?: string }[],
 *             "vault_auto_rag"?: bool — when true and no explicit vault picks, expand to all vaults in the current workspace / personal scope,
 *             "enable_web_search"?: bool — when true, allow {@code web_search} agent for this turn (if enabled in Task planner settings),
 *             "attachment_ids"?: number[] — ephemeral conversation attachments (this turn only),
 *             "active_material_id"?: string — continue a slide deck ({@code slide-{project_id}}),
 *             "reuse_grounding_message_id"?: int — retry/regenerate: load material container from this assistant turn,
 *             "continue_assistant_message_id"?: int — append to an existing truncated assistant reply (same message row),
 *             "slide_template_id"?: string — published custom template for a new deck,
 *             "planner_mode_id"?: "default"|"tot"|"ddtree" — thread planner mode (persisted on new chats),
 *             "corpus_id"?: number — Corpus Studio style injection (CS-1-S10); programmatic only, not chat composer,
 *             "bubble"?: bool — ephemeral Bubble Chat dialog thread (excluded from sidebar; TTL in params_json) }
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $authApi = $this->api('auth');
    $canonDbEarly = $authApi ? $authApi->getDB() : null;

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($input);

    $content = trim((string) ($input['content'] ?? ''));
    $continueAssistantId = (int) ($input['continue_assistant_message_id'] ?? 0);
    $appendAssistantTurn = $continueAssistantId > 0;
    $conversationId = $input['conversation_id'] ?? null;
    $conversationId = ($conversationId === null || $conversationId === '') ? null : (int) $conversationId;
    $isBubbleChat = ! empty($input['bubble']);
    $bubbleThread = $isBubbleChat;

    if ($appendAssistantTurn) {
        if ($conversationId === null || $conversationId < 1) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'conversation_id required for continue']);

            return;
        }
        if ($content === '') {
            $content = 'Continue';
        }
    }

    $inputPlannerMode = '';
    if (isset($input['planner_mode_id'])) {
        $pmIn = strtolower(trim((string) $input['planner_mode_id']));
        if (\in_array($pmIn, ['default', 'tot', 'ddtree'], true)) {
            $inputPlannerMode = $pmIn;
        }
    }

    $inputInferenceMode = '';
    if (isset($input['inference_mode'])) {
        $inputInferenceMode = ChatInferenceControl::normalizeMode((string) $input['inference_mode']);
    }
    /** @var array<string, int|float|null>|null $inputModelParamsNorm */
    $inputModelParamsNorm = null;
    if (\array_key_exists('model_params', $input) && \is_array($input['model_params'])) {
        $inputModelParamsNorm = UserModelParams::normalize($input['model_params']);
    }

    $chatEndpointRaw = $input['chat_endpoint_id'] ?? null;
    $chatEndpointId = ($chatEndpointRaw === null || $chatEndpointRaw === '') ? 0 : (int) $chatEndpointRaw;

    $sendCtx = new ChatSendContext(
        userId: $uid,
        workspaceId: $wid,
        input: $input,
        chatEndpointId: $chatEndpointId,
        isBubbleChat: $isBubbleChat,
        appendAssistantTurn: $appendAssistantTurn,
        conversationId: $conversationId,
    );

    $sendPipeline = new ChatSendPipeline($this);

    try {
        $sendPipeline->run(ChatSendPhase::GATE, $sendCtx, [
            'user'         => $user,
            'auth_api'     => $authApi,
            'core_api'     => $this->api('core'),
            'canonical_db' => $canonDbEarly,
        ]);
        $sendPipeline->run(ChatSendPhase::PREPARE, $sendCtx);
    } catch (ChatSendAbort $abort) {
        http_response_code($abort->httpStatus);
        echo json_encode($abort->payload, JSON_UNESCAPED_UNICODE);

        return;
    }

    $vaultSourceIds = $sendCtx->vaultSourceIds;
    $vaultSourceRefs = $sendCtx->vaultSourceRefs;
    $vaultAutoRag = $sendCtx->vaultAutoRag;
    $enableWebSearch = $sendCtx->enableWebSearch;
    $attachmentIds = $sendCtx->attachmentIds;
    $slideTemplateId = $sendCtx->slideTemplateId;
    $hasPublishedSlideTemplate = $sendCtx->hasPublishedSlideTemplate;
    $slideTemplateLabel = $sendCtx->slideTemplateLabel;

    if ($content === '' && ! $appendAssistantTurn) {
        if ($slideTemplateId !== '') {
            $content = 'Create a slide presentation using the selected template.';
        } elseif ($attachmentIds !== []) {
            $content = 'Please read the attached file(s) and respond helpfully.';
        } else {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Message cannot be empty']);

            return;
        }
    }
    if (strlen($content) > 32000) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Message too long']);

        return;
    }

    $assistantStub = '*(Preview)* Connect an LLM endpoint and sidecar to stream real replies. Stored locally: your message was received.';

    $canonDb = $authApi ? $authApi->getDB() : null;

    $orchestratorUserContent = $appendAssistantTurn
        ? 'Continue from where you left off in your previous assistant reply. Do not repeat text you already wrote; only add the next part.'
        : $content;
    if ($hasPublishedSlideTemplate) {
        $orchestratorUserContent = ChatTeachingIntent::enrichUserMessageForTemplate(
            $content,
            $slideTemplateId,
            $slideTemplateLabel,
        );
        $content = ChatTeachingIntent::displayUserMessageForTemplate(
            $content,
            $slideTemplateId,
            $slideTemplateLabel,
        );
    }

    $sendCtx->content = $content;
    $sendCtx->orchestratorUserContent = $orchestratorUserContent;

    if ($canonDb instanceof \Razy\Database) {
        try {
            $sendPipeline->run(ChatSendPhase::SCOPE, $sendCtx, [
                'canonical_db' => $canonDb,
                'auth_api'     => $authApi,
            ]);
        } catch (ChatSendAbort $abort) {
            http_response_code($abort->httpStatus);
            echo json_encode($abort->payload, JSON_UNESCAPED_UNICODE);

            return;
        }
        $vaultSourceIds = $sendCtx->vaultSourceIds;
        $vaultSourceRefs = $sendCtx->vaultSourceRefs;
    }

    if ($chatEndpointId > 0) {
        if (! $canonDb instanceof \Razy\Database
            || ! \oaaoai\chat\ChatRoutingSelectableProfiles::isRunnableId($canonDb, $chatEndpointId)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid chat completion profile']);

            return;
        }
    }

    /** @var array{profile: array<string, mixed>, endpoint: array<string, mixed>, endpoint_id: int, temperature: float}|null $binding */
    $binding = null;
    $internalBase = '';
    if ($canonDb instanceof \Razy\Database) {
        $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
            'stage'        => ChatSendOrchestratorStage::BIND,
            'canonical_db' => $canonDb,
        ]);
        $binding = $sendCtx->binding;
        $internalBase = $sendCtx->internalBase;
    }

    $orchReady = $sendCtx->orchReady;
    $assistantInsertContent = $orchReady ? '' : $assistantStub;

    try {
        $persist = ChatSendPersist::execute(
            pipeline: $sendPipeline,
            ctx: $sendCtx,
            chatController: $this,
            splitDb: $splitDb,
            pdo: $pdo,
            canonDb: $canonDb instanceof \Razy\Database ? $canonDb : null,
            uid: $uid,
            wid: $wid,
            isBubbleChat: $isBubbleChat,
            bubbleThread: $bubbleThread,
            conversationId: $conversationId,
            content: $content,
            appendAssistantTurn: $appendAssistantTurn,
            continueAssistantId: $continueAssistantId,
            inputPlannerMode: $inputPlannerMode,
            inputInferenceMode: $inputInferenceMode,
            inputModelParamsNorm: $inputModelParamsNorm,
            chatEndpointId: $chatEndpointId,
            orchReady: $orchReady,
            assistantInsertContent: $assistantInsertContent,
            attachmentIds: $attachmentIds,
            hasPublishedSlideTemplate: $hasPublishedSlideTemplate,
            slideTemplateLabel: $slideTemplateLabel,
        );

        $conversationId = $persist->conversationId;
        $conversationCreated = $persist->conversationCreated;
        $bubbleThread = $persist->bubbleThread;
        $conversationModeId = $persist->conversationModeId;
        $plannerModeId = $persist->plannerModeId;
        $userMsgId = $persist->userMsgId;
        $asstMsgId = $persist->asstMsgId;
        $assistantInsertContent = $persist->assistantInsertContent;
        $conversationTitleOut = $persist->conversationTitleOut;
        $inferenceSnapshot = $persist->inferenceSnapshot;

        $streamUrl = null;
        $runId = null;
        $streamToken = null;
        $assistantOut = $assistantInsertContent;
        $autoCompactApplied = false;

        if ($orchReady && $binding !== null) {
            $secret = getenv('OAAO_ORCH_SHARED_SECRET');
            $secret = ($secret !== false && trim((string) $secret) !== '')
                ? trim((string) $secret)
                : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');

            $publicBase = getenv('OAAO_ORCHESTRATOR_PUBLIC_BASE');
            $publicBase = ($publicBase !== false && trim((string) $publicBase) !== '')
                ? rtrim(trim((string) $publicBase), '/')
                : $internalBase;
            $publicBase = \oaaoai\chat\OrchestratorPublicBase::forClientStream($publicBase);

            /** Server-side prompt memory — never trust browser-loaded thread cache. */
            $canonPdoForPrompt = $this->oaao_chat_canonical_pdo();
            $bindingForContext = $binding;
            $contextLimit = ChatContextUsage::resolveContextLimitFromBinding($bindingForContext);
            $tokenizerProfile = ChatTokenEstimator::resolveProfileFromBinding($bindingForContext);
            $splitPdoForCtx = $splitDb->getDBAdapter();
            $overheadTokens = ChatContextUsage::measureOverheadTokens(
                $this,
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
                    $this,
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
                'api_key_env'  => \oaaoai\chat\ChatOrchestratorBootstrap::inferApiKeyEnv(
                    isset($endpointRow['api_key_ref']) ? (string) $endpointRow['api_key_ref'] : null
                ),
            ];
            $cfgRaw = isset($endpointRow['config_json']) ? trim((string) $endpointRow['config_json']) : '';
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
                'conversation_id'        => (string) $conversationId,
                'user_id'                => (string) $uid,
                'purpose_id'             => 'chat',
                'mode_id'                => $conversationModeId,
                'planner_mode_id'        => $plannerModeId,
                'messages'               => $messages,
                'temperature'            => $binding['temperature'],
                ...(isset($binding['max_tokens']) && (int) $binding['max_tokens'] > 0
                    ? ['max_tokens' => (int) $binding['max_tokens']]
                    : []),
                'endpoint'               => $endpointPayload,
                'chat_profile'           => [
                    'id'   => (int) ($profileRow['id'] ?? 0),
                    'name' => (string) ($profileRow['name'] ?? ''),
                    'type' => strtolower(trim((string) ($profileRow['type'] ?? 'single'))),
                ],
                'assistant_message_id'   => (string) $asstMsgId,
            ];

            $canonicalEndpointId = (int) ($binding['endpoint_id'] ?? 0);
            if ($canonicalEndpointId > 0) {
                $payload['endpoint_id'] = $canonicalEndpointId;
            }
            if ($chatEndpointId > 0) {
                $payload['chat_endpoint_id'] = $chatEndpointId;
            }
            $chatPurposeKey = 'chat';
            $profCfgRaw = isset($profileRow['config_json']) ? trim((string) $profileRow['config_json']) : '';
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
                        (int) $asstMsgId,
                    );
                    if ($reflectionCtx !== null) {
                        $payload['accs_reflection_context'] = $reflectionCtx;
                    }
                }
            }

            $endpointsApi = $this->api('endpoints');
            $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                'stage'          => ChatSendOrchestratorStage::AGENTS,
                'endpoints_api'  => $endpointsApi,
                'bubble_thread'  => $bubbleThread,
            ]);

            $slideDesignerApi = $this->api('slide_designer');
            $splitPdo = $splitDb->getDBAdapter();
            $activeMaterialId = trim((string) ($input['active_material_id'] ?? ''));
            $reuseGroundingMid = (int) ($input['reuse_grounding_message_id'] ?? 0);
            $canonPdoGround = null;
            $tenantIdGround = 0;
            if ($canonDb instanceof \Razy\Database) {
                $canonPdoGround = $canonDb->getDBAdapter();
                if ($canonPdoGround instanceof \PDO) {
                    $tenantIdGround = isset($user->tenant_id) ? (int) ($user->tenant_id ?? 0) : 0;
                    if ($tenantIdGround < 1) {
                        $coreApiGround = $this->api('core');
                        $tenantIdGround = $coreApiGround
                            ? $coreApiGround->bootstrapTenantContext($canonPdoGround)
                            : 0;
                    }
                }
            }
            if ($splitPdo instanceof \PDO) {
                $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                    'stage'                => ChatSendOrchestratorStage::CORE,
                    'split_db'             => $splitDb,
                    'conversation_id'      => (int) $conversationId,
                    'bubble_thread'        => $bubbleThread,
                    'conversation_created' => $conversationCreated,
                    'user'                 => $user,
                    'auth_api'             => $authApi,
                    'endpoints_api'        => $endpointsApi,
                    'slide_designer_api'   => $slideDesignerApi,
                    'canonical_db'         => $canonDb,
                    'attachment_ids'       => $attachmentIds,
                ]);
                $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                    'stage'                => ChatSendOrchestratorStage::SLIDE,
                    'split_pdo'            => $splitPdo,
                    'conversation_id'      => (int) $conversationId,
                    'bubble_thread'        => $bubbleThread,
                    'active_material_id'   => $activeMaterialId,
                    'reuse_grounding_mid'  => $reuseGroundingMid,
                    'canonical_pdo_ground' => $canonPdoGround,
                    'tenant_id_ground'     => $tenantIdGround,
                ]);
            }

            if ($canonDb instanceof \Razy\Database) {
                $canonPdoForVault = $canonDb->getDBAdapter();
                if ($canonPdoForVault instanceof \PDO) {
                    $this->api('core')?->bootstrapTenantContext($canonPdoForVault);
                }
                $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                    'stage'          => ChatSendOrchestratorStage::PAYLOAD,
                    'canonical_db'   => $canonDb,
                ]);
                $payload = array_merge($payload, $sendCtx->drainPayloadFragments());
            }

            $canonPdoForPersonalization = $this->oaao_chat_canonical_pdo();
            $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                'stage'                 => ChatSendOrchestratorStage::PERSONALIZE,
                'user'                  => $user,
                'canonical_pdo'         => $canonPdoForPersonalization,
                'conversation_id'       => (int) $conversationId,
                'orchestrator_payload'  => $payload,
            ]);
            $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                'stage'                 => ChatSendOrchestratorStage::FINALIZE,
                'user'                  => $user,
                'canonical_db'          => $canonDb,
                'conversation_id'       => (int) $conversationId,
                'assistant_message_id'  => (int) $asstMsgId,
                'continue_assistant_id' => $continueAssistantId,
                'orchestrator_payload'  => $payload,
            ]);
            $payload = array_merge($payload, $sendCtx->drainPayloadFragments());

            $sendPipeline->run(ChatSendPhase::RUN_START, $sendCtx, [
                'orchestrator_payload' => $payload,
                'started'              => null,
            ]);

            $started = $this->startOrchestratorChatRun($payload);

            if ($started === null) {
                $failStub = '*(Sidecar)* Could not start stream — check OAAO_ORCHESTRATOR_INTERNAL_URL and that the orchestrator is running.';
                $splitDb->update('message', ['content'])
                    ->where('id=?,conversation_id=?')
                    ->assign([
                        'content'          => $failStub,
                        'id'               => $asstMsgId,
                        'conversation_id'  => $conversationId,
                    ])
                    ->query();
                $assistantOut = $failStub;
            } elseif ($publicBase !== '') {
                $runId = $started['run_id'];
                $streamToken = $started['stream_token'];
                $streamUrl = \oaaoai\chat\OrchestratorPublicBase::buildStreamUrl($publicBase, [
                    'run_id' => $runId,
                    'token'  => $streamToken,
                ]);
            }
        }

        $responsePayload = [
            'success'               => true,
            'conversation_id'       => $conversationId,
            'user_message_id'       => $userMsgId,
            'assistant_message_id'  => $asstMsgId,
            'assistant_content'     => $assistantOut,
            'stream_url'            => $streamUrl,
            'run_id'                => $runId,
            'stream_token'          => $streamToken,
            'orchestrator_persist'  => $orchReady && $runId !== null,
        ];
        if (\is_string($conversationTitleOut) && $conversationTitleOut !== '') {
            $responsePayload['conversation_title'] = $conversationTitleOut;
        }
        if ($wid !== null && $wid > 0) {
            $responsePayload['workspace_id'] = $wid;
        }
        if ($autoCompactApplied) {
            $responsePayload['auto_compact_applied'] = true;
        }
        if ($inferenceSnapshot !== []) {
            $responsePayload['inference'] = $inferenceSnapshot;
        }
        try {
            $json = json_encode($responsePayload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Send failed — response could not be encoded']);

            return;
        }
        echo $json;
    } catch (ChatSendAbort $abort) {
        http_response_code($abort->httpStatus);
        echo json_encode($abort->payload, JSON_UNESCAPED_UNICODE);

        return;
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Send failed',
            'detail'  => $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
};
