<?php

use oaaoai\chat\ChatVaultScope;
use oaaoai\chat\ChatAttachmentStorage;

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
 *             "slide_template_id"?: string — published custom template for a new deck }
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

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    $content = trim((string) ($input['content'] ?? ''));
    $conversationId = $input['conversation_id'] ?? null;
    $conversationId = ($conversationId === null || $conversationId === '') ? null : (int) $conversationId;

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

    $authApi = $this->api('auth');
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
        require_once dirname(__DIR__, 2) . '/library/ChatTeachingIntent.php';
        $orchestratorUserContent = \oaaoai\chat\ChatTeachingIntent::enrichUserMessageForTemplate(
            $content,
            $slideTemplateId,
            $slideTemplateLabel,
        );
        $content = \oaaoai\chat\ChatTeachingIntent::displayUserMessageForTemplate(
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

    require_once dirname(__DIR__, 2) . '/library/ChatTeachingIntent.php';
    $expandVaultForGrounding = $vaultAutoRag
        || \oaaoai\chat\ChatTeachingIntent::impliesVaultGrounding($orchestratorUserContent);
    if (
        $expandVaultForGrounding
        && $vaultSourceRefs === []
        && $vaultSourceIds === []
        && $canonDb instanceof \Razy\Database
    ) {
        $matchedRefs = ChatVaultScope::composerRefsMatchingMessage(
            $canonDb,
            $uid,
            $wid,
            $orchestratorUserContent,
        );
        if (\oaaoai\chat\ChatTeachingIntent::impliesPersonalRecordVaultLookup($orchestratorUserContent)) {
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
            $candidates = ChatVaultScope::vaultIdsForUserWorkspace($canonDb, $uid, $wid);
            $vaultSourceIds = ChatVaultScope::filterVaultIdsWithEmbeddedDocuments($canonDb, $candidates);
            if (\count($vaultSourceIds) > 24) {
                $vaultSourceIds = \array_slice($vaultSourceIds, 0, 24);
            }
        }
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

    try {
        $pdo->beginTransaction();

        if ($conversationId !== null && $conversationId > 0) {
            $own = $splitDb->prepare()
                ->select('id, params_json')
                ->from('conversation')
                ->where('id=?,user_id=?,workspace_id=?')
                ->assign(['id' => $conversationId, 'user_id' => $uid, 'workspace_id' => $wid])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($own) || ! isset($own['id'])) {
                $pdo->rollBack();
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Conversation not found']);

                return;
            }
            $paramsRaw = trim((string) ($own['params_json'] ?? ''));
            if ($paramsRaw !== '') {
                try {
                    $paramsDec = json_decode($paramsRaw, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($paramsDec) && strtolower(trim((string) ($paramsDec['mode'] ?? ''))) === 'desk') {
                        $conversationModeId = 'desk';
                    }
                } catch (\JsonException) {
                }
            }
        } else {
            $title = mb_substr(preg_replace('/\s+/u', ' ', $content), 0, 80);
            if ($title === '' && $hasPublishedSlideTemplate && $slideTemplateLabel !== '') {
                $title = mb_substr($slideTemplateLabel, 0, 80);
            }
            if ($title === '') {
                $title = 'New chat';
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
            if ($conversationId < 1) {
                $pdo->rollBack();
                http_response_code(500);
                echo json_encode(['success' => false, 'message' => 'Could not create conversation']);

                return;
            }
        }

        $nowMsg = date('Y-m-d H:i:s');
        $userMeta = null;
        /** @var array<string, mixed> $userMetaArr */
        $userMetaArr = [];
        if ($attachmentIds !== []) {
            $userMetaArr['attachments'] = $attachmentIds;
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

        if ($orchReady && $binding !== null) {
            $secret = getenv('OAAO_ORCH_SHARED_SECRET');
            $secret = ($secret !== false && trim((string) $secret) !== '') ? trim((string) $secret) : 'oaao_dev_shared_secret';

            $publicBase = getenv('OAAO_ORCHESTRATOR_PUBLIC_BASE');
            $publicBase = ($publicBase !== false && trim((string) $publicBase) !== '')
                ? rtrim(trim((string) $publicBase), '/')
                : $internalBase;

            $histRaw = $splitDb->prepare()
                ->select('role, content')
                ->from('message')
                ->where('conversation_id=?')
                ->assign(['conversation_id' => $conversationId])
                ->order('+id')
                ->limit(120)
                ->query()
                ->fetchAll();
            /** @var list<array{role: string, content: string}> $rows */
            $rows = \is_array($histRaw) ? $histRaw : [];

            $messages = [];
            foreach ($rows as $r) {
                if (! \is_array($r)) {
                    continue;
                }
                $role = strtolower(trim((string) ($r['role'] ?? '')));
                if (! \in_array($role, ['system', 'user', 'assistant'], true)) {
                    continue;
                }
                $c = (string) ($r['content'] ?? '');
                if ($c === '' && $role === 'assistant') {
                    continue;
                }
                $messages[] = ['role' => $role, 'content' => $c];
            }

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

            $endpointsApi = $this->api('endpoints');
            if ($endpointsApi) {
                $allowedAgents = $endpointsApi->resolveAllowedAgents();
            } else {
                require_once dirname(__DIR__, 2) . '/library/ChatAllowedAgentsPurposeConfig.php';
                $allowedAgents = \oaaoai\chat\ChatAllowedAgentsPurposeConfig::defaultAllowed();
            }
            if (! $enableWebSearch) {
                $allowedAgents = array_values(array_filter(
                    $allowedAgents,
                    static fn (string $kind): bool => strtolower(trim($kind)) !== 'web_search',
                ));
            }
            require_once dirname(__DIR__, 2) . '/library/ChatTeachingIntent.php';
            $allowedAgents = \oaaoai\chat\ChatTeachingIntent::ensureSlideDesignerAllowed(
                $allowedAgents,
                $orchestratorUserContent,
                $hasPublishedSlideTemplate,
            );
            $payload['allowed_agents'] = $allowedAgents;
            $payload['enable_web_search'] = $enableWebSearch;
            require_once dirname(__DIR__, 2) . '/library/PlannerAgentRegister.php';
            $payload['agent_catalog'] = \oaaoai\chat\PlannerAgentRegister::catalogForAllowed(
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

            require_once dirname(__DIR__, 2) . '/library/ChatConversationMaterial.php';
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
                require_once dirname(__DIR__, 2) . '/library/MicroSkillCatalog.php';
                $payload['skills_catalog'] = \oaaoai\chat\MicroSkillCatalog::forPlanner(
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
            $activeMaterialId = trim((string) ($input['active_material_id'] ?? ''));
            if ($splitPdo instanceof \PDO && $conversationId > 0) {
                if ($activeMaterialId !== '') {
                    $slideDesignerPayload['active_material_id'] = $activeMaterialId;
                    $resolved = \oaaoai\chat\ChatConversationMaterial::resolveSlideProjectMaterial(
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

                $payload['conversation_materials'] = \oaaoai\chat\ChatConversationMaterial::catalogForPlanner(
                    $splitPdo,
                    $conversationId,
                    $uid,
                    16,
                    $slideDesignerApi,
                );
                $reuseGroundingMid = (int) ($input['reuse_grounding_message_id'] ?? 0);
                $grounding = \oaaoai\chat\ChatConversationMaterial::groundingContextForOrchestrator(
                    $splitPdo,
                    $conversationId,
                    $uid,
                    $activeMaterialId !== '' ? $activeMaterialId : null,
                    $reuseGroundingMid,
                    $slideDesignerApi,
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
                        require_once dirname(__DIR__, 4) . '/core/default/library/TenantContext.php';
                        \Oaaoai\Core\TenantContext::bootstrap($canonPdo);
                        $ctxTid = \Oaaoai\Core\TenantContext::id();
                        if ($ctxTid > 0) {
                            $payload['tenant_id'] = $ctxTid;
                        }
                    }
                }
            }

            if ($attachmentIds !== []) {
                require_once __DIR__ . '/../library/ChatAttachmentStorage.php';
                /** @var list<array<string, mixed>> $chatAttachments */
                $chatAttachments = [];
                foreach ($attachmentIds as $aid) {
                    $ar = $splitDb->prepare()
                        ->select('id, conversation_id, file_name, mime_type, storage_path, byte_size')
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
                    $abs = ChatAttachmentStorage::conversationDir((int) $conversationId) . '/' . $rel;
                    $chatAttachments[] = [
                        'id'            => (int) ($ar['id'] ?? 0),
                        'file_name'     => (string) ($ar['file_name'] ?? ''),
                        'mime_type'     => (string) ($ar['mime_type'] ?? ''),
                        'absolute_path' => $abs,
                        'byte_size'     => (int) ($ar['byte_size'] ?? 0),
                    ];
                }
                if ($chatAttachments !== []) {
                    $payload['chat_attachments'] = $chatAttachments;
                }
            }

            if ($canonDb instanceof \Razy\Database) {
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
                    $rag = $endpointsApi->resolveOrchestratorVaultRagConfig();
                    if ($rag !== []) {
                        $payload['vault_rag'] = $rag;
                    }
                    $payload['run_planner_mode'] = $endpointsApi->resolveRunPlannerMode();
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

            require_once dirname(__DIR__, 2) . '/library/ChatRunPrincipal.php';
            $tenantForPrincipal = isset($payload['tenant_id']) ? (int) $payload['tenant_id'] : 0;
            $payload['run_principal'] = \oaaoai\chat\ChatRunPrincipal::issue(
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
                $streamUrl = $publicBase . '/v1/stream?run_id=' . rawurlencode($runId)
                    . '&token=' . rawurlencode($streamToken);
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
