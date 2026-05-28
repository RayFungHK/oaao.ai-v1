<?php

use oaaoai\chat\ChatAttachmentManifest;
use oaaoai\chat\ChatAttachmentStorage;
use oaaoai\chat\ChatConversationMaterial;
use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatConversationTitle;
use oaaoai\chat\ChatContextUsage;
use oaaoai\chat\ChatConversationCompact;
use oaaoai\chat\ChatTokenEstimator;
use oaaoai\chat\ChatHistorySettings;
use oaaoai\chat\ChatRunPrincipal;
use oaaoai\chat\ChatTeachingIntent;
use oaaoai\chat\ChatVaultScope;
use oaaoai\chat\MicroSkillCatalog;
use oaaoai\chat\PlannerAgentRegister;
use oaaoai\chat\SkillsManifestStorage;
use oaaoai\endpoints\ChatAllowedAgentsPurposeConfig;
use oaaoai\endpoints\MmModuleSettings;
use oaaoai\user\UserPersonalization;

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
 *             "slide_template_id"?: string — published custom template for a new deck,
 *             "planner_mode_id"?: "default"|"tot"|"ddtree" — thread planner mode (persisted on new chats),
 *             "corpus_id"?: number — Corpus Studio style injection (CS-1-S10); programmatic only, not chat composer }
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
    $conversationId = $input['conversation_id'] ?? null;
    $conversationId = ($conversationId === null || $conversationId === '') ? null : (int) $conversationId;

    $inputPlannerMode = '';
    if (isset($input['planner_mode_id'])) {
        $pmIn = strtolower(trim((string) $input['planner_mode_id']));
        if (\in_array($pmIn, ['default', 'tot', 'ddtree'], true)) {
            $inputPlannerMode = $pmIn;
        }
    }

    $chatEndpointRaw = $input['chat_endpoint_id'] ?? null;
    $chatEndpointId = ($chatEndpointRaw === null || $chatEndpointRaw === '') ? 0 : (int) $chatEndpointRaw;

    /** @var list<int> $vaultSourceIds */
    $vaultSourceIds = [];
    /** @var list<array{kind: string, id: int, vault_id: int, name: string}> $vaultSourceRefs */
    $vaultSourceRefs = [];

    $refsRaw = $input['vault_source_refs'] ?? null;
    if (\is_array($refsRaw)) {
        foreach ($refsRaw as $item) {
            if (! \is_array($item)) {
                continue;
            }
            $kind = strtolower(trim((string) ($item['kind'] ?? '')));
            $rid = \is_int($item['id'] ?? null) ? (int) $item['id'] : (int) ($item['id'] ?? 0);
            $vaultRowId = \is_int($item['vault_id'] ?? null) ? (int) $item['vault_id'] : (int) ($item['vault_id'] ?? 0);
            if ($kind === 'vault') {
                $vaultRowId = $rid;
            }
            if (! \in_array($kind, ['vault', 'folder', 'document'], true) || $rid < 1 || $vaultRowId < 1) {
                continue;
            }
            $nm = substr(trim((string) ($item['name'] ?? '')), 0, 512);
            $vaultSourceRefs[] = ['kind' => $kind, 'id' => $rid, 'vault_id' => $vaultRowId, 'name' => $nm];
            if (\count($vaultSourceRefs) >= 24) {
                break;
            }
        }
    }

    if ($vaultSourceRefs !== []) {
        $vaultSourceIds = [];
        $seenVault = [];
        foreach ($vaultSourceRefs as $ref) {
            $v = (int) ($ref['vault_id'] ?? 0);
            if ($v < 1 || isset($seenVault[$v])) {
                continue;
            }
            $seenVault[$v] = true;
            $vaultSourceIds[] = $v;
        }
        sort($vaultSourceIds);
    } else {
        $vaultRaw = $input['vault_source_ids'] ?? null;
        if (\is_array($vaultRaw)) {
            foreach ($vaultRaw as $v) {
                $vid = \is_int($v) ? $v : (int) $v;
                if ($vid > 0) {
                    $vaultSourceIds[] = $vid;
                }
                if (\count($vaultSourceIds) >= 24) {
                    break;
                }
            }
            $vaultSourceIds = array_values(array_unique($vaultSourceIds, SORT_NUMERIC));
        }
    }

    $vaultAutoRag = false;
    $varRaw = $input['vault_auto_rag'] ?? null;
    if ($varRaw === true || $varRaw === 1 || $varRaw === '1') {
        $vaultAutoRag = true;
    } elseif (\is_string($varRaw) && strtolower(trim($varRaw)) === 'true') {
        $vaultAutoRag = true;
    }

    $enableWebSearch = false;
    $webRaw = $input['enable_web_search'] ?? null;
    if ($webRaw === true || $webRaw === 1 || $webRaw === '1') {
        $enableWebSearch = true;
    } elseif (\is_string($webRaw) && strtolower(trim($webRaw)) === 'true') {
        $enableWebSearch = true;
    }

    /** @var list<int> $attachmentIds */
    $attachmentIds = [];
    $attRaw = $input['attachment_ids'] ?? null;
    if (\is_array($attRaw)) {
        foreach ($attRaw as $a) {
            $aid = \is_int($a) ? $a : (int) $a;
            if ($aid > 0) {
                $attachmentIds[] = $aid;
            }
            if (\count($attachmentIds) >= 8) {
                break;
            }
        }
        $attachmentIds = array_values(array_unique($attachmentIds, SORT_NUMERIC));
    }

    $slideTemplateId = trim((string) ($input['slide_template_id'] ?? ''));

    if ($content === '') {
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

    $hasPublishedSlideTemplate = false;
    $slideTemplateLabel = '';
    $slideDesignerApi = $this->api('slide_designer');
    if ($slideTemplateId !== '' && $slideDesignerApi) {
        $tplRow = $slideDesignerApi->resolvePublishedTemplate($slideTemplateId);
        if ($tplRow !== null) {
            $hasPublishedSlideTemplate = true;
            $slideTemplateLabel = trim((string) ($tplRow['label'] ?? ''));
            if ($slideTemplateLabel === '') {
                $slideTemplateLabel = $slideTemplateId;
            }
        }
    }

    $orchestratorUserContent = $content;
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
    } elseif ($slideTemplateId !== '') {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'Slide template not found or not published. Publish it in Templates, then use “Use in chat” again.',
        ]);

        return;
    }

    $hasExplicitVaultRefs = $vaultSourceRefs !== [] || $vaultSourceIds !== [];
    /** @var list<array{kind: string, id: int, vault_id: int, name: string}> $matchedRefs */
    $matchedRefs = [];
    if (
        $canonDb instanceof \Razy\Database
        && ChatTeachingIntent::shouldTryComposerVaultMatch(
            $vaultAutoRag,
            $hasExplicitVaultRefs,
            $orchestratorUserContent,
        )
    ) {
        $matchedRefs = ChatVaultScope::composerRefsMatchingMessage(
            $canonDb,
            $uid,
            $wid,
            $orchestratorUserContent,
        );
    }

    $expandVaultForGrounding = ChatTeachingIntent::shouldExpandVaultComposerScope(
        $vaultAutoRag,
        $hasExplicitVaultRefs,
        $matchedRefs !== [],
        $orchestratorUserContent,
    );
    if (
        $expandVaultForGrounding
        && $vaultSourceRefs === []
        && $vaultSourceIds === []
        && $canonDb instanceof \Razy\Database
    ) {
        if (ChatTeachingIntent::impliesPersonalRecordVaultLookup($orchestratorUserContent)) {
            $audioRefs = ChatVaultScope::embeddedAudioRefsForRecordLookup(
                $canonDb,
                $uid,
                $wid,
                $orchestratorUserContent,
            );
            if ($audioRefs !== []) {
                /** @var array<string, true> $seenRef */
                $seenRef = [];
                foreach ($matchedRefs as $ref) {
                    $seenRef[(int) ($ref['vault_id'] ?? 0) . ':' . (int) ($ref['id'] ?? 0)] = true;
                }
                foreach ($audioRefs as $ref) {
                    $key = (int) ($ref['vault_id'] ?? 0) . ':' . (int) ($ref['id'] ?? 0);
                    if (isset($seenRef[$key])) {
                        continue;
                    }
                    $seenRef[$key] = true;
                    $matchedRefs[] = $ref;
                }
            }
        }
        if ($matchedRefs !== []) {
            $vaultSourceRefs = $matchedRefs;
            /** @var array<int, true> $seenVault */
            $seenVault = [];
            foreach ($matchedRefs as $ref) {
                $vid = (int) ($ref['vault_id'] ?? 0);
                if ($vid < 1 || isset($seenVault[$vid])) {
                    continue;
                }
                $seenVault[$vid] = true;
                $vaultSourceIds[] = $vid;
            }
            $vaultSourceIds = array_values(array_unique($vaultSourceIds, SORT_NUMERIC));
        } else {
            $authApi = $this->api('auth');
            $candidates = ChatVaultScope::vaultIdsForRetrieval($canonDb, $uid, $wid, $authApi);
            $vaultSourceIds = ChatVaultScope::filterVaultIdsWithEmbeddedDocuments($canonDb, $candidates);
            if (\count($vaultSourceIds) > 24) {
                $vaultSourceIds = \array_slice($vaultSourceIds, 0, 24);
            }
        }
    }

    if (
        $expandVaultForGrounding
        && $vaultSourceIds === []
        && $canonDb instanceof \Razy\Database
    ) {
        $vaultSourceIds = $this->embeddedVaultIdsForUserWorkspace($uid, $wid);
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
    if ($canonDb instanceof \Razy\Database) {
        if ($chatEndpointId > 0) {
            $binding = \oaaoai\chat\ChatOrchestratorBootstrap::resolveBindingForProfile($canonDb, $chatEndpointId);
        }
        if ($binding === null) {
            $binding = \oaaoai\chat\ChatOrchestratorBootstrap::resolveDefaultBinding($canonDb);
        }
    }

    $internalBase = '';
    $envInternal = getenv('OAAO_ORCHESTRATOR_INTERNAL_URL');
    if ($envInternal !== false && trim((string) $envInternal) !== '') {
        $internalBase = rtrim(trim((string) $envInternal), '/');
    } elseif (getenv('OAAO_DOCKER') === '1') {
        // Compose service hostname — used when INTERNAL_URL is unset (Apache may not inherit shell `.env`).
        $internalBase = 'http://orchestrator:8103';
    } else {
        $port = getenv('OAAO_SIDECAR_PORT');
        if ($port !== false && (string) $port !== '') {
            $internalBase = 'http://127.0.0.1:' . max(1, min(65535, (int) $port));
        }
    }
    // Apache/ClearEnv may drop OAAO_DOCKER — container filesystem still identifies Compose runs.
    if ($internalBase === '' && @is_readable('/.dockerenv')) {
        $internalBase = 'http://orchestrator:8103';
    }

    $orchReady = $binding !== null && $internalBase !== '';
    $assistantInsertContent = $orchReady ? '' : $assistantStub;
    $conversationModeId = 'default';
    $plannerModeId = 'default';

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
                    }
                } catch (\JsonException) {
                }
            }
            if ($inputPlannerMode !== '') {
                $plannerModeId = $inputPlannerMode;
            }
        } else {
            $title = 'New chat';
            if ($hasPublishedSlideTemplate && $slideTemplateLabel !== '') {
                $title = mb_substr($slideTemplateLabel, 0, 80);
            }
            $nowConv = date('Y-m-d H:i:s');
            $splitDb->insert('conversation', ['user_id', 'workspace_id', 'title', 'created_at', 'updated_at'])
                ->assign([
                    'user_id'       => $uid,
                    'workspace_id'  => $wid,
                    'title'         => $title,
                    'created_at'    => $nowConv,
                    'updated_at'    => $nowConv,
                ])
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

        $nowMsg = date('Y-m-d H:i:s');
        $userMeta = null;
        /** @var array<string, mixed> $userMetaArr */
        $userMetaArr = [];
        /** @var list<array<string, mixed>> $attRows */
        $attRows = [];
        if ($attachmentIds !== []) {
            require_once __DIR__ . '/_ensure_conversation_attachment_schema.php';
            oaao_chat_ensure_conversation_attachment_schema($pdo);
            ChatAttachmentStorage::claimDraftAttachments($splitDb, $uid, (int) $conversationId, $attachmentIds);
            $attRows = ChatAttachmentStorage::loadRowsForIds($splitDb, (int) $conversationId, $uid, $attachmentIds);
            $userMetaArr['attachments'] = ChatAttachmentManifest::manifestFromRows($attRows, false);
        }

        $conversationTitleOut = null;
        $titleRow = $splitDb->prepare()
            ->select('title')
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $conversationId, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();
        $curTitle = \is_array($titleRow) ? ChatConversationTitle::normalize((string) ($titleRow['title'] ?? '')) : '';
        if (ChatConversationTitle::isPlaceholder($curTitle)) {
            $provisional = ChatConversationTitle::provisionalFromSend($orchestratorUserContent, $attRows);
            if ($provisional !== '') {
                $splitDb->update('conversation', ['title', 'updated_at'])
                    ->where('id=?,user_id=?')
                    ->assign([
                        'title'      => $provisional,
                        'updated_at' => $nowMsg,
                        'id'         => $conversationId,
                        'user_id'    => $uid,
                    ])
                    ->query();
                $conversationTitleOut = $provisional;
            }
        }
        if ($hasPublishedSlideTemplate) {
            $userMetaArr['slide_template_id'] = $slideTemplateId;
            $userMetaArr['slide_template_label'] = $slideTemplateLabel;
            $userMetaArr['slide_template_ui'] = true;
        }
        if ($userMetaArr !== []) {
            try {
                $userMeta = json_encode($userMetaArr, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $userMeta = null;
            }
        }
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

        $splitDb->insert('message', ['conversation_id', 'role', 'content', 'created_at'])
            ->assign([
                'conversation_id' => $conversationId,
                'role'              => 'assistant',
                'content'           => $assistantInsertContent,
                'created_at'        => $nowMsg,
            ])
            ->query();
        $asstMsgId = (int) $splitDb->lastID();

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

            if ($hasPublishedSlideTemplate && $orchestratorUserContent !== '') {
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

            $this->api('endpoints')?->ensureFeatureRegistries();

            $endpointsApi = $this->api('endpoints');
            if ($endpointsApi) {
                $allowedAgents = $endpointsApi->resolveAllowedAgents();
            } else {
                $allowedAgents = ChatAllowedAgentsPurposeConfig::defaultAllowed();
            }
            // Planner chooses web_search per turn (needs_web_search); do not strip from allowed_agents here.
            $allowedAgents = ChatTeachingIntent::ensureSlideDesignerAllowed(
                $allowedAgents,
                $orchestratorUserContent,
                $hasPublishedSlideTemplate,
            );
            $payload['allowed_agents'] = $allowedAgents;
            $payload['enable_web_search'] = $enableWebSearch;
            $payload['agent_catalog'] = PlannerAgentRegister::catalogForAllowed(
                $payload['allowed_agents'],
            );

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
            if ($conversationCreated) {
                $payload['is_new_conversation'] = true;
            }

            $slideExtras = [];
            if ($hasPublishedSlideTemplate) {
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
                    $hasPublishedSlideTemplate ? $slideTemplateId : null,
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
            if ($splitPdo instanceof \PDO && $conversationId > 0) {
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

            // Multimodal — always forward python_module bindings ({@code mm_modules.json}); no Purpose row.
            $this->api('endpoints')?->ensureFeatureRegistries();
            require_once __DIR__ . '/../../../../endpoints/default/library/MmModuleSettings.php';
            $payload['mm_understand'] = MmModuleSettings::orchestratorPayloadForAxis('understand');
            $payload['mm_generate'] = MmModuleSettings::orchestratorPayloadForAxis('generate');
            $payload['mm_edit'] = MmModuleSettings::orchestratorPayloadForAxis('edit');

            if ($canonDb instanceof \Razy\Database) {
                $canonPdoForVault = $canonDb->getDBAdapter();
                if ($canonPdoForVault instanceof \PDO) {
                    $coreApiForVault = $this->api('core');
                    if ($coreApiForVault) {
                        $coreApiForVault->bootstrapTenantContext($canonPdoForVault);
                    }
                }
                if ($vaultSourceIds !== []) {
                    $payload['vault_retrieval_profiles'] = $this->vaultRetrievalProfilesForVaultIds(
                        $uid,
                        $wid,
                        $vaultSourceIds,
                    );
                    $docCatalog = ChatVaultScope::documentCitationCatalog($canonDb, $vaultSourceIds);
                    if ($docCatalog !== []) {
                        $payload['vault_document_catalog'] = $docCatalog;
                    }
                    if ($vaultSourceRefs !== []) {
                        $scopeDocs = ChatVaultScope::scopedDocumentIdsByVault($canonDb, $vaultSourceRefs);
                        if ($scopeDocs !== []) {
                            /** @var array<string, list<int>> $encoded */
                            $encoded = [];
                            foreach ($scopeDocs as $vid => $docIds) {
                                $encoded[(string) $vid] = $docIds;
                            }
                            $payload['vault_scope_documents'] = $encoded;
                        }
                    }
                }
                if ($endpointsApi) {
                    $emb = $endpointsApi->resolveOrchestratorEmbeddingPayload();
                    if ($emb !== null) {
                        $payload['embedding'] = $emb;
                    }
                    $rerank = $endpointsApi->resolveOrchestratorRerankPayload();
                    if ($rerank !== null) {
                        $payload['rerank'] = $rerank;
                    }
                    $rag = $endpointsApi->resolveOrchestratorVaultRagConfig();
                    if ($rag !== []) {
                        $payload['vault_rag'] = $rag;
                    }
                    $runPlannerMode = $endpointsApi->resolveRunPlannerMode();
                    if ($vaultAutoRag && $vaultSourceRefs === [] && $vaultSourceIds === []) {
                        $runPlannerMode = \oaaoai\endpoints\ChatRunPlannerPurposeConfig::MODE_LLM;
                    }
                    $payload['run_planner_mode'] = $runPlannerMode;
                    $asr = $endpointsApi->resolveOrchestratorAsrPayload();
                    if ($asr !== null) {
                        $payload['asr'] = $asr;
                    }
                    $polish = $endpointsApi->resolveOrchestratorPolishPayload();
                    if ($polish !== null) {
                        $payload['polish'] = $polish;
                    }
                    $uiqe = $endpointsApi->resolveOrchestratorUiqePayload();
                    if ($uiqe !== null) {
                        $payload['uiqe'] = $uiqe;
                    }
                    $planner = $endpointsApi->resolveOrchestratorPlannerPayload();
                    if ($planner !== null) {
                        $payload['planner'] = $planner;
                    }
                    $plannerIntent = $endpointsApi->resolveOrchestratorPlannerIntentPayload();
                    if ($plannerIntent !== null) {
                        $payload['planner_intent'] = $plannerIntent;
                    }
                    $knowledge = $endpointsApi->resolveOrchestratorKnowledgePayload();
                    if ($knowledge !== null) {
                        $knowledge['scope'] = 'platform';
                        $payload['knowledge'] = $knowledge;
                    }
                }
                if ($wid !== null && $wid > 0) {
                    $vaultApi = $this->api('vault');
                    if ($vaultApi) {
                        $glossary = $vaultApi->getWorkspaceGlossary($wid);
                        if ($glossary !== []) {
                            $payload['glossary'] = $glossary;
                        }
                    }
                }
            }

            require_once dirname(__DIR__, 4) . '/user/default/library/UserPersonalization.php';
            $canonPdoForPersonalization = $this->oaao_chat_canonical_pdo();
            $payload['user_personalization'] = UserPersonalization::forOrchestratorPayload(
                $canonPdoForPersonalization instanceof \PDO
                    ? UserPersonalization::loadForUser($canonPdoForPersonalization, $uid)
                    : UserPersonalization::defaults(),
            );

            $corpusIdRaw = $input['corpus_id'] ?? null;
            $corpusIdSend = ($corpusIdRaw === null || $corpusIdRaw === '') ? 0 : (int) $corpusIdRaw;
            if ($corpusIdSend > 0 && $canonDb instanceof \Razy\Database) {
                require_once dirname(__DIR__, 4) . '/corpus/default/library/CorpusStyleResolver.php';
                $tenantForCorpus = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : 0;
                if ($tenantForCorpus < 1) {
                    $tenantForCorpus = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
                }
                $corpusStyle = \oaaoai\corpus\CorpusStyleResolver::forChatRun(
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
