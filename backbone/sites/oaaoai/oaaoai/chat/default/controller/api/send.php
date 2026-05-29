<?php

use oaaoai\chat\ChatAccsReflection;
use oaaoai\chat\ChatAttachmentStorage;
use oaaoai\chat\ChatBubbleConversation;
use oaaoai\chat\ChatConversationMaterial;
use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatContextUsage;
use oaaoai\chat\ChatConversationCompact;
use oaaoai\chat\ChatTokenEstimator;
use oaaoai\chat\ChatHistorySettings;
use oaaoai\chat\ChatInferenceControl;
use oaaoai\chat\ChatRunPrincipal;
use oaaoai\chat\ChatSendAbort;
use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendConversationSettle;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\chat\ChatSendPhase;
use oaaoai\chat\ChatSendPipeline;
use oaaoai\chat\ChatTeachingIntent;
use oaaoai\chat\MicroSkillCatalog;
use oaaoai\chat\SkillsManifestStorage;
use oaaoai\corpus\CorpusStyleResolver;
use oaaoai\endpoints\ChatInferencePurposeConfig;
use oaaoai\endpoints\MmModuleSettings;
use oaaoai\user\UserDisplayPreferences;
use oaaoai\user\UserModelParams;
use oaaoai\user\UserPersonalization;
use oaaoai\user\UserPreferenceProfile;

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
    $canonPdoEarly = $canonDbEarly instanceof \Razy\Database ? $canonDbEarly->getDBAdapter() : null;
    if ($canonPdoEarly instanceof \PDO) {
        require_once dirname(__DIR__, 4) . '/core/default/library/CreditLedgerRepository.php';
        $coreEarly = $this->api('core');
        $tenantIdEarly = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
        if ($tenantIdEarly < 1 && $coreEarly) {
            $tenantIdEarly = $coreEarly->bootstrapTenantContext($canonPdoEarly);
        }
        $creditBlock = \Oaaoai\Core\CreditLedgerRepository::sendBlockedReason($canonPdoEarly, $tenantIdEarly, $uid);
        if ($creditBlock !== null) {
            http_response_code(402);
            echo json_encode([
                'success' => false,
                'message' => $creditBlock,
                'code'    => 'credits_exhausted',
            ], JSON_UNESCAPED_UNICODE);

            return;
        }
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

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
    $conversationModeId = 'default';
    $plannerModeId = 'default';
    /** @var array<string, mixed>|null $paramsDec */
    $paramsDec = null;

    try {
        $pdo->beginTransaction();

        $conversationCreated = false;
        if ($conversationId !== null && $conversationId > 0) {
            $own = ChatConversationScope::findForUser($splitDb, $uid, (int) $conversationId, $wid, 'id, params_json');
            if ($own === null) {
                $pdo->rollBack();
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Conversation not found']);

                return;
            }
            if (ChatBubbleConversation::isBubbleRow($own)) {
                $bubbleThread = true;
                if (ChatBubbleConversation::isExpiredParams(ChatBubbleConversation::paramsFromRow($own))) {
                    $pdo->rollBack();
                    try {
                        $splitDb->delete('message', ['conversation_id' => (int) $conversationId])->query();
                        $splitDb->delete('conversation', ['id' => (int) $conversationId, 'user_id' => $uid])->query();
                    } catch (\Throwable) {
                    }
                    http_response_code(410);
                    echo json_encode(['success' => false, 'message' => 'Bubble chat expired', 'code' => 'bubble_expired']);

                    return;
                }
                ChatBubbleConversation::touchExpiry($splitDb, (int) $conversationId, $uid);
            }
            $paramsRaw = trim((string) ($own['params_json'] ?? ''));
            if ($paramsRaw !== '') {
                try {
                    $paramsDec = json_decode($paramsRaw, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($paramsDec)) {
                        if (strtolower(trim((string) ($paramsDec['mode'] ?? ''))) === 'desk') {
                            $conversationModeId = 'desk';
                        }
                        $pm = strtolower(trim((string) ($paramsDec['planner_mode_id'] ?? '')));
                        if (\in_array($pm, ['default', 'tot', 'ddtree'], true)) {
                            $plannerModeId = $pm;
                        }
                    } else {
                        $paramsDec = null;
                    }
                } catch (\JsonException) {
                    $paramsDec = null;
                }
            }
            if ($inputPlannerMode !== '') {
                $plannerModeId = $inputPlannerMode;
            }
        } else {
            $title = $isBubbleChat ? 'Bubble' : 'New chat';
            if (! $isBubbleChat && $hasPublishedSlideTemplate && $slideTemplateLabel !== '') {
                $title = mb_substr($slideTemplateLabel, 0, 80);
            }
            $nowConv = date('Y-m-d H:i:s');
            $insertCols = ['user_id', 'workspace_id', 'title', 'created_at', 'updated_at'];
            $insertAssign = [
                'user_id'       => $uid,
                'workspace_id'  => $wid,
                'title'         => $title,
                'created_at'    => $nowConv,
                'updated_at'    => $nowConv,
            ];
            if ($isBubbleChat) {
                $insertCols[] = 'params_json';
                $insertAssign['params_json'] = \oaaoai\chat\ChatBubbleConversation::initialParamsJson();
            }
            $splitDb->insert('conversation', $insertCols)
                ->assign($insertAssign)
                ->query();
            $conversationId = (int) $splitDb->lastID();
            $conversationCreated = true;
            if ($conversationId < 1) {
                $pdo->rollBack();
                http_response_code(500);
                echo json_encode(['success' => false, 'message' => 'Could not create conversation']);

                return;
            }
            if ($inputPlannerMode !== '') {
                $plannerModeId = $inputPlannerMode;
            }
        }

        if ($conversationId > 0 && $inputPlannerMode !== '' && $inputPlannerMode !== 'default') {
            $params = [];
            $paramsRow = $splitDb->prepare()
                ->select('params_json')
                ->from('conversation')
                ->where('id=?,user_id=?')
                ->assign(['id' => $conversationId, 'user_id' => $uid])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($paramsRow)) {
                $paramsRawPersist = trim((string) ($paramsRow['params_json'] ?? ''));
                if ($paramsRawPersist !== '') {
                    try {
                        $paramsDecPersist = json_decode($paramsRawPersist, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($paramsDecPersist)) {
                            $params = $paramsDecPersist;
                        }
                    } catch (\JsonException) {
                    }
                }
            }
            if ($conversationModeId === 'desk') {
                $params['mode'] = 'desk';
            }
            $params['planner_mode_id'] = $plannerModeId;
            $splitDb->update('conversation', ['params_json', 'updated_at'])
                ->where('id=?,user_id=?')
                ->assign([
                    'params_json'  => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'updated_at'   => date('Y-m-d H:i:s'),
                    'id'           => $conversationId,
                    'user_id'      => $uid,
                ])
                ->query();
        }

        if ($conversationId > 0 && $conversationCreated && $inputInferenceMode !== '') {
            $paramsInf = [];
            $paramsRowInf = $splitDb->prepare()
                ->select('params_json')
                ->from('conversation')
                ->where('id=?,user_id=?')
                ->assign(['id' => $conversationId, 'user_id' => $uid])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($paramsRowInf)) {
                $paramsRawInf = trim((string) ($paramsRowInf['params_json'] ?? ''));
                if ($paramsRawInf !== '') {
                    try {
                        $decodedInf = json_decode($paramsRawInf, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($decodedInf)) {
                            $paramsInf = $decodedInf;
                        }
                    } catch (\JsonException) {
                    }
                }
            }
            $infPatch = ['mode' => $inputInferenceMode];
            if ($inputInferenceMode === ChatInferenceControl::MODE_MANUAL && $inputModelParamsNorm !== null) {
                $infPatch['model_params'] = $inputModelParamsNorm;
            }
            if (
                $inputInferenceMode === ChatInferenceControl::MODE_AUTO_TUNE
                && ChatInferenceControl::modeFromConversation($paramsInf) !== ChatInferenceControl::MODE_AUTO_TUNE
            ) {
                $purposeMpSeed = [];
                if ($canonDb instanceof \Razy\Database) {
                    $purposeMpSeed = ChatInferencePurposeConfig::resolveDefaultsForChatEndpoint(
                        $canonDb,
                        $chatEndpointId > 0 ? $chatEndpointId : 0,
                    );
                }
                $userMpSeed = [];
                $canonPdoSeed = $this->oaao_chat_canonical_pdo();
                if ($canonPdoSeed instanceof \PDO) {
                    $userMpSeed = UserModelParams::activeOverrides(
                        UserModelParams::loadForUser($canonPdoSeed, $uid),
                    );
                }
                $infPatch['auto_state'] = ChatInferenceControl::initialAutoState($purposeMpSeed, $userMpSeed);
            }
            $paramsInf = ChatInferenceControl::mergeIntoParams($paramsInf, $infPatch);
            $splitDb->update('conversation', ['params_json', 'updated_at'])
                ->where('id=?,user_id=?')
                ->assign([
                    'params_json'  => json_encode($paramsInf, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'updated_at'   => date('Y-m-d H:i:s'),
                    'id'           => $conversationId,
                    'user_id'      => $uid,
                ])
                ->query();
            $paramsDec = $paramsInf;
        }

        $nowMsg = date('Y-m-d H:i:s');
        $userMeta = null;
        /** @var list<array<string, mixed>> $attRows */
        $attRows = [];
        if ($attachmentIds !== []) {
            require_once __DIR__ . '/_ensure_conversation_attachment_schema.php';
            oaao_chat_ensure_conversation_attachment_schema($pdo);
            ChatAttachmentStorage::claimDraftAttachments($splitDb, $uid, (int) $conversationId, $attachmentIds);
            $attRows = ChatAttachmentStorage::loadRowsForIds($splitDb, (int) $conversationId, $uid, $attachmentIds);
        }

        $conversationTitleOut = null;
        /** @var array<string, int|float> $inferenceApplied */
        $inferenceApplied = [];
        /** @var array<string, mixed> $inferenceSnapshot */
        $inferenceSnapshot = $sendCtx->inferenceSnapshot;

        try {
            $sendPipeline->run(ChatSendPhase::CONVERSATION_SETTLE, $sendCtx, [
                'split_db'              => $splitDb,
                'conversation_id'       => (int) $conversationId,
                'canonical_db'          => $canonDb,
                'canonical_pdo'         => $this->oaao_chat_canonical_pdo(),
                'attachment_rows'       => $attRows,
                'now_msg'               => $nowMsg,
                'params_dec'            => $paramsDec,
                'continue_assistant_id' => $continueAssistantId,
            ]);
        } catch (ChatSendAbort $abort) {
            $pdo->rollBack();
            http_response_code($abort->httpStatus);
            echo json_encode($abort->payload, JSON_UNESCAPED_UNICODE);

            return;
        }

        $conversationTitleOut = $sendCtx->conversationTitleOut;
        $inferenceApplied = $sendCtx->inferenceApplied;
        $inferenceSnapshot = $sendCtx->inferenceSnapshot;
        $userMeta = ChatSendConversationSettle::encodeUserMeta($sendCtx->userMetaArr);
        $userCols = ['conversation_id', 'role', 'content', 'created_at'];
        $userAssign = [
            'conversation_id' => $conversationId,
            'role'              => 'user',
            'content'           => $content,
            'created_at'        => $nowMsg,
        ];
        if ($userMeta !== null) {
            $userCols[] = 'meta_json';
            $userAssign['meta_json'] = $userMeta;
        }
        $splitDb->insert('message', $userCols)->assign($userAssign)->query();
        $userMsgId = (int) $splitDb->lastID();

        $asstMetaJson = ChatSendConversationSettle::encodeAssistantInferenceMeta($inferenceSnapshot);
        if ($appendAssistantTurn) {
            $asstExisting = $splitDb->prepare()
                ->select('id, content')
                ->from('message')
                ->where('id=?,conversation_id=?,role=?')
                ->assign([
                    'id'              => $continueAssistantId,
                    'conversation_id' => $conversationId,
                    'role'            => 'assistant',
                ])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($asstExisting) || ! isset($asstExisting['id'])) {
                $pdo->rollBack();
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Assistant message not found']);

                return;
            }
            $asstMsgId = $continueAssistantId;
            $assistantInsertContent = (string) ($asstExisting['content'] ?? '');
            $assistantOut = $assistantInsertContent;
        } else {
            $asstCols = ['conversation_id', 'role', 'content', 'created_at'];
            $asstAssign = [
                'conversation_id' => $conversationId,
                'role'              => 'assistant',
                'content'           => $assistantInsertContent,
                'created_at'        => $nowMsg,
            ];
            if ($asstMetaJson !== null) {
                $asstCols[] = 'meta_json';
                $asstAssign['meta_json'] = $asstMetaJson;
            }
            $splitDb->insert('message', $asstCols)->assign($asstAssign)->query();
            $asstMsgId = (int) $splitDb->lastID();
        }

        $splitDb->update('conversation', ['updated_at'])
            ->where('id=?')
            ->assign([
                'updated_at' => date('Y-m-d H:i:s'),
                'id'         => $conversationId,
            ])
            ->query();

        $pdo->commit();

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

            if ($vaultSourceIds !== []) {
                $payload['vault_source_ids'] = $vaultSourceIds;
            }
            if ($vaultSourceRefs !== []) {
                $payload['vault_source_refs'] = $vaultSourceRefs;
            }
            $payload['vault_auto_rag'] = $vaultAutoRag;
            if ($wid !== null) {
                $payload['workspace_id'] = $wid;
            }
            if ($conversationCreated && ! $bubbleThread) {
                $payload['is_new_conversation'] = true;
            }

            if ($bubbleThread) {
                $payload['conversation_kind'] = ChatBubbleConversation::KIND;
                $payload['skip_persistent_agent_hooks'] = true;
            }

            $slideDesignerApi = $this->api('slide_designer');
            $slideExtras = [];
            if (! $bubbleThread && $hasPublishedSlideTemplate) {
                $slideExtras['template_id'] = $slideTemplateId;
                $slideExtras['start_new_deck'] = true;
            }
            $slideDesignerPayload = ($slideDesignerApi ?? null)
                ? $slideDesignerApi->orchestratorSlideDesignerBase($slideExtras)
                : ['storage_root' => ''];
            $splitPdo = $splitDb->getDBAdapter();
            if ($splitPdo instanceof \PDO) {
                $payload['skills_catalog'] = MicroSkillCatalog::forPlanner(
                    $splitPdo,
                    $user,
                    $authApi,
                    $uid,
                    $wid,
                    (! $bubbleThread && $hasPublishedSlideTemplate) ? $slideTemplateId : null,
                    $this,
                    $slideDesignerApi,
                );
            }
            $endpointsApi = $this->api('endpoints');
            if ($endpointsApi && method_exists($endpointsApi, 'getToolServerRegistry')) {
                $payload['tool_servers'] = $endpointsApi->getToolServerRegistry();
            }
            $payload['hot_plug_skills'] = SkillsManifestStorage::enabledForPurpose('chat');
            $activeMaterialId = trim((string) ($input['active_material_id'] ?? ''));
            if ($splitPdo instanceof \PDO && $conversationId > 0 && ! $bubbleThread) {
                if ($activeMaterialId !== '') {
                    $slideDesignerPayload['active_material_id'] = $activeMaterialId;
                    $resolved = ChatConversationMaterial::resolveSlideProjectMaterial(
                        $splitPdo,
                        $conversationId,
                        $uid,
                        $activeMaterialId,
                        $slideDesignerApi,
                    );
                    if ($resolved !== null) {
                        $slideDesignerPayload['resume_project_id'] = $resolved['project_id'];
                        unset($slideDesignerPayload['start_new_deck']);
                    }
                }

                $payload['conversation_materials'] = ChatConversationMaterial::catalogForPlanner(
                    $splitPdo,
                    $conversationId,
                    $uid,
                    16,
                    $slideDesignerApi,
                );
                $reuseGroundingMid = (int) ($input['reuse_grounding_message_id'] ?? 0);
                $canonPdoGround = null;
                $tenantIdGround = 0;
                if ($canonDb instanceof \Razy\Database) {
                    $canonPdoGround = $canonDb->getDBAdapter();
                    if ($canonPdoGround instanceof \PDO) {
                        $tenantIdGround = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
                        if ($tenantIdGround < 1) {
                            $coreApiGround = $this->api('core');
                            $tenantIdGround = $coreApiGround
                                ? $coreApiGround->bootstrapTenantContext($canonPdoGround)
                                : 0;
                        }
                    }
                }
                $grounding = ChatConversationMaterial::groundingContextForOrchestrator(
                    $splitPdo,
                    $conversationId,
                    $uid,
                    $activeMaterialId !== '' ? $activeMaterialId : null,
                    $reuseGroundingMid,
                    $slideDesignerApi,
                    $canonPdoGround instanceof \PDO ? $canonPdoGround : null,
                    $tenantIdGround,
                );
                if ($grounding !== []) {
                    $payload['conversation_material_grounding'] = $grounding;
                }
                if ($reuseGroundingMid > 0) {
                    $payload['reuse_grounding_message_id'] = $reuseGroundingMid;
                }
            }
            $payload['slide_designer'] = $slideDesignerPayload;

            if ($canonDb instanceof \Razy\Database) {
                $canonPdo = $canonDb->getDBAdapter();
                if ($canonPdo instanceof \PDO) {
                    $userTenantId = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
                    if ($userTenantId > 0) {
                        $payload['tenant_id'] = $userTenantId;
                    } else {
                        $coreApi = $this->api('core');
                        $ctxTid = $coreApi
                            ? $coreApi->bootstrapTenantContext($canonPdo)
                            : 0;
                        if ($ctxTid > 0) {
                            $payload['tenant_id'] = $ctxTid;
                        }
                    }
                }
            }

            if ($attachmentIds !== []) {
                ChatAttachmentStorage::claimDraftAttachments($splitDb, $uid, (int) $conversationId, $attachmentIds);
                $canonPdoForAtt = $this->oaao_chat_canonical_pdo();
                $tenantIdForAtt = 0;
                if ($canonPdoForAtt instanceof \PDO) {
                    $coreApiAtt = $this->api('core');
                    $tenantIdForAtt = $coreApiAtt ? $coreApiAtt->bootstrapTenantContext($canonPdoForAtt) : 0;
                }
                /** @var list<array<string, mixed>> $chatAttachments */
                $chatAttachments = [];
                foreach ($attachmentIds as $aid) {
                    $ar = $splitDb->prepare()
                        ->select('id, conversation_id, file_name, mime_type, storage_path, storage_locator_json, byte_size')
                        ->from('conversation_attachment')
                        ->where('id=?,conversation_id=?,user_id=?')
                        ->assign(['id' => $aid, 'conversation_id' => $conversationId, 'user_id' => $uid])
                        ->limit(1)
                        ->query()
                        ->fetch();
                    if (! \is_array($ar)) {
                        continue;
                    }
                    $rel = trim((string) ($ar['storage_path'] ?? ''));
                    if ($rel === '') {
                        continue;
                    }
                    $locatorJson = isset($ar['storage_locator_json']) ? (string) $ar['storage_locator_json'] : null;
                    $relKey = ChatAttachmentStorage::relativeKey((int) $conversationId, $uid, $rel, false);
                    $abs = ChatAttachmentStorage::conversationDir((int) $conversationId) . '/' . $rel;
                    if ($tenantIdForAtt > 0 && $canonPdoForAtt instanceof \PDO && $locatorJson !== null && trim($locatorJson) !== '') {
                        try {
                            $blob = ChatAttachmentStorage::blobStorage($canonPdoForAtt, $tenantIdForAtt);
                            $abs = $blob->resolveAbsolutePath($locatorJson, $relKey, ChatAttachmentStorage::root());
                        } catch (\Throwable) {
                        }
                    }
                    $chatAttachments[] = [
                        'id'            => (int) ($ar['id'] ?? 0),
                        'file_name'     => (string) ($ar['file_name'] ?? ''),
                        'mime_type'     => (string) ($ar['mime_type'] ?? ''),
                        'absolute_path' => $abs,
                        'byte_size'     => (int) ($ar['byte_size'] ?? 0),
                        'storage_locator' => $locatorJson !== null && trim($locatorJson) !== ''
                            ? json_decode($locatorJson, true)
                            : null,
                    ];
                }
                if ($chatAttachments !== []) {
                    $payload['chat_attachments'] = $chatAttachments;
                }
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
                $payload = array_merge($payload, $sendCtx->mergedPayloadFragments());
            }

            if ($inferenceApplied !== []) {
                $payload['model_params'] = $inferenceApplied;
                if (isset($inferenceApplied['temperature'])) {
                    $payload['temperature'] = (float) $inferenceApplied['temperature'];
                }
                if (isset($inferenceApplied['max_tokens'])) {
                    $payload['max_tokens'] = (int) $inferenceApplied['max_tokens'];
                }
            }
            if (($inferenceSnapshot['mode'] ?? '') === ChatInferenceControl::MODE_AUTO_TUNE) {
                $payload['inference_mode'] = ChatInferenceControl::MODE_AUTO_TUNE;
                $payload['inference_baseline'] = $inferenceApplied;
            } elseif (($inferenceSnapshot['mode'] ?? '') === ChatInferenceControl::MODE_MANUAL) {
                $payload['inference_mode'] = ChatInferenceControl::MODE_MANUAL;
            }
            $canonPdoForPersonalization = $this->oaao_chat_canonical_pdo();
            if ($canonPdoForPersonalization instanceof \PDO) {
                require_once dirname(__DIR__, 4) . '/auth/default/controller/api/_ensure_todo_schema.php';
                oaao_auth_ensure_todo_schema($canonPdoForPersonalization);
                $tenantForTodos = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : (int) ($user->tenant_id ?? 0);
                $stTodos = $canonPdoForPersonalization->prepare(
                    'SELECT todo_id, title FROM oaao_todo_item
                     WHERE tenant_id = ? AND user_id = ? AND status = ? AND conversation_id = ?
                     ORDER BY updated_at DESC LIMIT 20',
                );
                $stTodos->execute([$tenantForTodos, $uid, 'open', $conversationId]);
                $openTodos = [];
                while ($row = $stTodos->fetch(\PDO::FETCH_ASSOC)) {
                    if (! \is_array($row)) {
                        continue;
                    }
                    $openTodos[] = [
                        'todo_id' => (int) ($row['todo_id'] ?? 0),
                        'title'   => (string) ($row['title'] ?? ''),
                    ];
                }
                if ($openTodos !== []) {
                    $payload['open_todo_items'] = $openTodos;
                }
            }
            $persPayload = UserPersonalization::forOrchestratorPayload(
                $canonPdoForPersonalization instanceof \PDO
                    ? UserPersonalization::loadForUser($canonPdoForPersonalization, $uid)
                    : UserPersonalization::defaults(),
            );
            if ($canonPdoForPersonalization instanceof \PDO) {
                $stmtPrefs = $canonPdoForPersonalization->prepare(
                    'SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1',
                );
                $stmtPrefs->execute([$uid]);
                $rawPrefs = $stmtPrefs->fetchColumn();
                if (\is_string($rawPrefs) && $rawPrefs !== '') {
                    try {
                        $decodedPrefs = json_decode($rawPrefs, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($decodedPrefs)) {
                            $persPayload = array_merge(
                                $persPayload,
                                UserPreferenceProfile::forOrchestratorPayload($decodedPrefs),
                            );
                        }
                    } catch (\JsonException) {
                        /* keep profile block empty */
                    }
                }
            }
            $payload['user_personalization'] = $persPayload;
            $payload['display_locale'] = $canonPdoForPersonalization instanceof \PDO
                ? UserDisplayPreferences::localeForUser($canonPdoForPersonalization, $uid)
                : UserDisplayPreferences::DEFAULT_LOCALE;

            $corpusIdRaw = $input['corpus_id'] ?? null;
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
                    $uid,
                    $wid,
                );
                if ($corpusStyle !== null) {
                    $payload['corpus_id'] = $corpusIdSend;
                    $payload['corpus_style'] = $corpusStyle;
                }
            }

            $libraryDocIds = [];
            $libRaw = $input['library_doc_ids'] ?? $input['attached_library_doc_ids'] ?? null;
            if (\is_array($libRaw)) {
                foreach ($libRaw as $lid) {
                    $n = (int) $lid;
                    if ($n > 0) {
                        $libraryDocIds[$n] = $n;
                    }
                }
            }
            if ($libraryDocIds !== []) {
                $payload['library_doc_ids'] = array_values($libraryDocIds);
            }

            if ($appendAssistantTurn) {
                $payload['append_assistant_content'] = true;
                $payload['continue_assistant_message_id'] = $continueAssistantId;
            }

            $tenantForPrincipal = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : 0;
            $payload['run_principal'] = ChatRunPrincipal::issue(
                $uid,
                $conversationId,
                $asstMsgId,
                $wid,
                $tenantForPrincipal > 0 ? $tenantForPrincipal : null,
            );

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
