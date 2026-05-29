<?php

namespace Module\oaao\endpoints;

require_once __DIR__ . '/../library/PurposeAllocationRegister.php';
require_once __DIR__ . '/../library/FeatureRegistryBootstrap.php';
require_once __DIR__ . '/../library/CanonicalEndpointsRepository.php';
require_once __DIR__ . '/../library/AsrPurposeConfig.php';
require_once __DIR__ . '/../library/AsrLivePurposeConfig.php';
require_once __DIR__ . '/../library/UiqePurposeConfig.php';
require_once __DIR__ . '/../library/MmPurposeConfig.php';
require_once __DIR__ . '/../library/LlmOrchestratorPayload.php';

use oaaoai\endpoints\AsrLivePurposeConfig;
use oaaoai\endpoints\AsrPurposeConfig;
use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\ChatAllowedAgentsPurposeConfig;
use oaaoai\endpoints\FeatureRegistryBootstrap;
use oaaoai\endpoints\LlmOrchestratorPayload;
use oaaoai\endpoints\PurposeAllocationRegister;
use oaaoai\endpoints\KnowledgeRefreshPurposeConfig;
use oaaoai\endpoints\UiqePurposeConfig;
use oaaoai\endpoints\MmPurposeConfig;
use oaaoai\endpoints\AsrUserPreferenceRegister;
use oaaoai\endpoints\MediaCapabilityRegister;
use oaaoai\endpoints\MmPythonModuleRegister;
use Razy\Database;
use Razy\Agent;
use Razy\Controller;

/**
 * Canonical ({@code auth::getDB()}) CRUD: {@code oaao_endpoint} on whatever driver backs {@code getDB()};
 * {@code oaao_purpose} is **PostgreSQL only** (same rule as other global registry tables).
 *
 * Persistence goes through {@see \oaaoai\endpoints\CanonicalEndpointsRepository} and {@see \Razy\Database} fluent statements.
 *
 * ### Modular boundary
 *
 * This module is the **domain owner** for endpoint rows and purpose-allocation **slot metadata** ({@see PurposeAllocationRegister}).
 * Other modules extend slots via the {@code purpose_allocation.register} hook (listened as {@code oaaoai/chat:purpose_allocation.register}, {@code oaaoai/rag:…}, {@code oaaoai/slide-designer:…}, …);
 * they keep **feature-specific configuration UI** (e.g. Chat’s multi-profile endpoint wiring) in their own {@code settings.register} panels / APIs.
 */
return new class extends Controller {
    /**
     * Admin session + canonical {@see \Razy\Database} — JSON errors already emitted when returning null.
     */
    protected function oaao_endpoints_require_admin(): ?\Razy\Database
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return null;
        }

        $auth->restrict(true);

        if (! $auth->requireAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Administrator required']);

            return null;
        }

        $db = $auth->getDB();
        if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
            $core = $this->api('core');
            if ($core) {
                $core->bootstrapTenantContext($pdo);
            }
        }

        return $db;
    }

    /**
     * Knowledge plane control — platform host + {@code platform_admin} only (not tenant {@code admin}).
     */
    protected function oaao_endpoints_require_platform_knowledge_admin(): ?\Razy\Database
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return null;
        }

        $auth->restrict(true);

        $db = $auth->getDB();
        if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
            $core = $this->api('core');
            if ($core) {
                $core->bootstrapTenantContext($pdo);
            }
        }

        $core = $this->api('core');
        if (! $core || ! $core->tenantIsPlatform()) {
            http_response_code(403);
            echo json_encode(
                ['success' => false, 'message' => 'Knowledge control plane is platform-only'],
                JSON_UNESCAPED_UNICODE,
            );

            return null;
        }

        $user = $auth->getUser();
        $UserModel = $auth->loadModel('User');
        if (! $UserModel || ! $UserModel::isPlatformOperator($user)) {
            http_response_code(403);
            echo json_encode(
                ['success' => false, 'message' => 'Platform administrator required'],
                JSON_UNESCAPED_UNICODE,
            );

            return null;
        }

        return $db;
    }

    /** {@code oaao_purpose} exists only on PostgreSQL canonical — not on SQLite file core. */
    protected function oaao_endpoints_canonical_is_pgsql(\Razy\Database $db): bool
    {
        $pdo = $db->getDBAdapter();

        return $pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql';
    }

    /**
     * @return array{0: string, 1: string} internal base URL, shared secret
     */
    protected function oaao_endpoints_orchestrator_internal(): array
    {
        $internalBase = '';
        $envInternal = getenv('OAAO_ORCHESTRATOR_INTERNAL_URL');
        if ($envInternal !== false && trim((string) $envInternal) !== '') {
            $internalBase = rtrim(trim((string) $envInternal), '/');
        } elseif (getenv('OAAO_DOCKER') === '1' || @is_readable('/.dockerenv')) {
            $internalBase = 'http://orchestrator:8103';
        } else {
            $port = getenv('OAAO_SIDECAR_PORT');
            if ($port !== false && (string) $port !== '') {
                $internalBase = 'http://127.0.0.1:' . max(1, min(65535, (int) $port));
            }
        }

        $secret = getenv('OAAO_ORCH_SHARED_SECRET');
        $secret = \is_string($secret) && trim($secret) !== ''
            ? trim($secret)
            : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');

        return [$internalBase, $secret];
    }

    /**
     * @param array<string, mixed> $extras sort, purpose_key_prefix, fallback, module_code, allocation_mode (optional consumer tag, e.g. chat_multi)
     */
    public function registerPurposeAllocationSlot(string $slot_id, string $label, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        PurposeAllocationRegister::add($slot_id, $label, $title, $sub, $icon, $extras);
    }

    /**
     * Pull-based registry bootstrap — fires {@code collect_feature_registries} once per request.
     */
    public function ensureFeatureRegistries(): void
    {
        FeatureRegistryBootstrap::collect($this);
    }

    /**
     * Embedded into {@code index.tpl} by {@see core.main.php} via {@code api('endpoints')->getPurposeAllocationSlots()}.
     *
     * @return list<array<string, mixed>>
     */
    public function getPurposeAllocationSlots(): array
    {
        $this->ensureFeatureRegistries();

        return PurposeAllocationRegister::allSorted();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getToolServerRegistry(): array
    {
        $this->ensureFeatureRegistries();

        require_once __DIR__ . '/../library/ToolServerStorage.php';

        ToolServerStorage::bootstrapPersisted();

        return \oaaoai\endpoints\ToolServerRegister::allSorted();
    }

    protected function oaao_endpoints_canonical_db(): ?Database
    {
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;

        return $db instanceof Database ? $db : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorAsrPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $asrBind = $repo->resolveAsrBinding();
        if ($asrBind === null) {
            return null;
        }
        $chat = $this->api('chat');
        $infer = $chat
            ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
            : static fn (string $ref): ?string => null;

        return AsrPurposeConfig::jobPayloadFromBinding($asrBind, $infer);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorLiveAsrPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $repo->ensureAsrLivePurposeRow();
        $liveBind = $repo->resolveLiveAsrBinding();
        if ($liveBind === null) {
            return null;
        }
        $chat = $this->api('chat');
        $infer = $chat
            ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
            : static fn (string $ref): ?string => null;

        return AsrLivePurposeConfig::jobPayloadFromBinding($liveBind, $infer);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorEmbeddingPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $embBind = $repo->resolveVaultIngestEmbeddingBinding();
        if ($embBind === null) {
            return null;
        }
        $eref = trim((string) ($embBind['api_key_ref'] ?? ''));
        $chat = $this->api('chat');

        return [
            'purpose_key' => $embBind['purpose_key'],
            'base_url'    => $embBind['base_url'],
            'model'       => $embBind['model'],
            'api_key_env' => ($eref !== '' && $chat)
                ? $chat->inferOrchestratorApiKeyEnv($eref)
                : null,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorRerankPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $bind = $repo->resolveVaultRerankBinding();
        if ($bind === null) {
            return null;
        }
        $eref = trim((string) ($bind['api_key_ref'] ?? ''));
        $chat = $this->api('chat');

        return [
            'purpose_key' => $bind['purpose_key'],
            'base_url'    => $bind['base_url'],
            'model'       => $bind['model'],
            'api_key_env' => ($eref !== '' && $chat)
                ? $chat->inferOrchestratorApiKeyEnv($eref)
                : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function resolveOrchestratorVaultRagConfig(): array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return [];
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

        return $repo->resolveRagRetrievalConfig();
    }

    /**
     * @return list<string>
     */
    public function resolveAllowedAgents(): array
    {
        $this->ensureFeatureRegistries();

        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            require_once dirname(__DIR__, 3) . '/library/ChatAllowedAgentsPurposeConfig.php';

            return ChatAllowedAgentsPurposeConfig::defaultAllowed();
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

        return $repo->resolveAllowedAgents();
    }

    public function resolveRunPlannerMode(): string
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return 'auto';
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

        return $repo->resolveRunPlannerMode();
    }

    /**
     * @return array<string, mixed>|null
     */
    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorUiqePayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $uiqeBind = $repo->resolveUiqeBinding();
        if ($uiqeBind === null) {
            return null;
        }
        $chat = $this->api('chat');

        return UiqePurposeConfig::jobPayloadFromBinding(
            $uiqeBind,
            $chat
                ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
                : static fn (string $ref): ?string => null,
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorPlannerPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $planBind = $repo->resolvePlanningBinding();
        if ($planBind === null) {
            return null;
        }
        $chat = $this->api('chat');

        return LlmOrchestratorPayload::fromBinding(
            $planBind,
            $chat,
        );
    }

    /**
     * Per-turn agent intent hook ({@code planning.intent.*}).
     *
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorPlannerIntentPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $repo->ensurePlanningIntentPurposeRow();
        $intentBind = $repo->resolvePlanningIntentBinding();
        if ($intentBind === null) {
            return null;
        }
        $chat = $this->api('chat');

        return LlmOrchestratorPayload::fromBinding($intentBind, $chat);
    }

    /**
     * EPIC-WS-1 — Knowledge plane LLM cfg (orientation + search-plan) for web_search → platform/tenant buckets.
     *
     * @return array{orientation?: array<string, mixed>, search_plan?: array<string, mixed>}|null
     */
    public function resolveOrchestratorKnowledgePayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $chat = $this->api('chat');
        $infer = $chat
            ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
            : static fn (string $ref): ?string => null;

        $out = [];
        $orientBind = $repo->resolveKnowledgeOrientationBinding();
        if ($orientBind !== null) {
            $payload = UiqePurposeConfig::jobPayloadFromBinding($orientBind, $infer);
            if ($payload !== null) {
                $out['orientation'] = $payload;
            }
        }
        $planBind = $repo->resolveKnowledgeSearchPlanBinding();
        if ($planBind !== null) {
            $payload = UiqePurposeConfig::jobPayloadFromBinding($planBind, $infer);
            if ($payload !== null) {
                $out['search_plan'] = $payload;
            }
        }
        $classifyBind = $repo->resolveKnowledgeClassifyBinding();
        if ($classifyBind !== null) {
            $payload = UiqePurposeConfig::jobPayloadFromBinding($classifyBind, $infer);
            if ($payload !== null) {
                $out['knowledge.classify'] = $payload;
            }
        }
        $distillBind = $repo->resolveKnowledgeDistillBinding();
        if ($distillBind !== null) {
            $payload = UiqePurposeConfig::jobPayloadFromBinding($distillBind, $infer);
            if ($payload !== null) {
                $out['knowledge.distill'] = $payload;
            }
        }

        $out['scope'] = 'platform';
        $refreshCfg = $repo->resolveKnowledgeRefreshConfig();
        $vaultIds = KnowledgeRefreshPurposeConfig::resolveKnowledgeVaultIds($refreshCfg);
        $platVault = (int) ($vaultIds['platform_vault_id'] ?? 0);
        $tenantVault = (int) ($vaultIds['tenant_vault_id'] ?? 0);
        if ($platVault > 0) {
            $out['platform_vault_id'] = $platVault;
            $out['web_vault_id'] = $platVault;
        } elseif ($tenantVault > 0) {
            $out['platform_vault_id'] = $tenantVault;
            $out['web_vault_id'] = $tenantVault;
        }
        $refreshUid = KnowledgeRefreshPurposeConfig::resolveRefreshUserId($refreshCfg);
        if ($refreshUid > 0) {
            $out['refresh_user_id'] = $refreshUid;
        }

        $recallProfiles = $this->resolveKnowledgeRecallVaultProfiles();
        if ($recallProfiles !== []) {
            $out['recall_vault_profiles'] = $recallProfiles;
        }

        $out['refresh'] = $refreshCfg;
        if (! ($refreshCfg['merge_recall'] ?? true)) {
            $out['merge_recall'] = false;
        }

        return $out === [] ? null : $out;
    }

    /**
     * WS-1-S8 — full Qdrant profiles for tenant/platform Knowledge vaults (RAG merge).
     *
     * @return list<array<string, mixed>>
     */
    public function resolveKnowledgeRecallVaultProfiles(): array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db instanceof Database) {
            return [];
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $refresh = $repo->resolveKnowledgeRefreshConfig();
        $vaultIds = KnowledgeRefreshPurposeConfig::resolveKnowledgeVaultIds($refresh);
        /** @var list<int> $ids */
        $ids = [];
        foreach (['platform_vault_id', 'tenant_vault_id'] as $key) {
            $v = (int) ($vaultIds[$key] ?? 0);
            if ($v > 0 && ! in_array($v, $ids, true)) {
                $ids[] = $v;
            }
        }
        $ids = array_values(array_unique($ids, SORT_NUMERIC));
        if ($ids === []) {
            return [];
        }

        require_once dirname(__DIR__, 3) . '/vault/default/library/VaultRetrievalProfiles.php';
        require_once dirname(__DIR__, 3) . '/vault/default/library/VaultQdrantCollectionResolver.php';

        $chat = $this->api('chat');
        $infer = $chat
            ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
            : static fn (string $ref): ?string => null;

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $core = $this->api('core');
            if ($core) {
                $core->bootstrapTenantContext($pdo);
                $slug = trim((string) $core->tenantContextSlug());
                if ($slug !== '') {
                    \oaaoai\vault\VaultQdrantCollectionResolver::setTenantSlug($slug);
                }
            }
        }

        return \oaaoai\vault\VaultRetrievalProfiles::fromVaultIds($db, $ids, $infer);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getAsrUserPreferenceRegistry(): array
    {
        $this->ensureFeatureRegistries();

        return AsrUserPreferenceRegister::allSorted();
    }

    /**
     * Whether a {@code polish.*} purpose row with a default endpoint is configured.
     */
    public function isPolishPurposeConfigured(): bool
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return false;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));

        return $repo->resolvePolishBinding() !== null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorPolishPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $polishBind = $repo->resolvePolishBinding();
        if ($polishBind === null) {
            return null;
        }
        $chat = $this->api('chat');

        return LlmOrchestratorPayload::fromBinding($polishBind, $chat);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getMediaCapabilityRegistry(): array
    {
        $this->ensureFeatureRegistries();

        return MediaCapabilityRegister::allSorted();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getMmPythonModuleRegistry(): array
    {
        $this->ensureFeatureRegistries();

        return MmPythonModuleRegister::allSorted();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorMmUnderstandPayload(): ?array
    {
        return $this->resolveOrchestratorMmAxisPayload('understand');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorMmGeneratePayload(): ?array
    {
        return $this->resolveOrchestratorMmAxisPayload('generate');
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorMmEditPayload(): ?array
    {
        return $this->resolveOrchestratorMmAxisPayload('edit');
    }

    /**
     * @return array<string, mixed>|null
     */
    private function resolveOrchestratorMmAxisPayload(string $axis): ?array
    {
        require_once __DIR__ . '/../library/MmModuleSettings.php';
        $this->ensureFeatureRegistries();

        return MmModuleSettings::orchestratorPayloadForAxis($axis);
    }

    public function __onInit(Agent $agent): bool
    {
        /* Required for {@see Emitter}: {@code $this->api('endpoints')->registerPurposeAllocationSlot(...)} from {@code oaaoai/*}. */
        $agent->addAPICommand([
            'registerPurposeAllocationSlot'       => 'registerPurposeAllocationSlot',
            'getPurposeAllocationSlots'           => 'getPurposeAllocationSlots',
            'getToolServerRegistry'               => 'getToolServerRegistry',
            'ensureFeatureRegistries'             => 'ensureFeatureRegistries',
            'resolveOrchestratorAsrPayload'       => 'resolveOrchestratorAsrPayload',
            'resolveOrchestratorLiveAsrPayload'   => 'resolveOrchestratorLiveAsrPayload',
            'resolveOrchestratorEmbeddingPayload' => 'resolveOrchestratorEmbeddingPayload',
            'resolveOrchestratorVaultRagConfig'   => 'resolveOrchestratorVaultRagConfig',
            'resolveAllowedAgents'                => 'resolveAllowedAgents',
            'resolveRunPlannerMode'               => 'resolveRunPlannerMode',
            'resolveOrchestratorPolishPayload'    => 'resolveOrchestratorPolishPayload',
            'resolveOrchestratorUiqePayload'      => 'resolveOrchestratorUiqePayload',
            'resolveOrchestratorPlannerPayload'       => 'resolveOrchestratorPlannerPayload',
            'resolveOrchestratorPlannerIntentPayload' => 'resolveOrchestratorPlannerIntentPayload',
            'resolveOrchestratorMmUnderstandPayload' => 'resolveOrchestratorMmUnderstandPayload',
            'resolveOrchestratorMmGeneratePayload'   => 'resolveOrchestratorMmGeneratePayload',
            'resolveOrchestratorMmEditPayload'         => 'resolveOrchestratorMmEditPayload',
            'getMediaCapabilityRegistry'            => 'getMediaCapabilityRegistry',
            'getMmPythonModuleRegistry'             => 'getMmPythonModuleRegistry',
            'getAsrUserPreferenceRegistry'          => 'getAsrUserPreferenceRegistry',
            'isPolishPurposeConfigured'             => 'isPolishPurposeConfigured',
        ]);

        $purposeAllocationListener = 'event/purpose_allocation_register_listener';
        $chatPipelineListener = 'event/chat_pipeline_register_listener';
        $plannerAgentListener = 'event/planner_agent_register_listener';
        $mmPythonModuleListener = 'event/mm_python_module_register_listener';
        $asrUserPreferenceListener = 'event/asr_user_preference_register_listener';
        $microSkillProviderListener = 'event/micro_skill_provider_register_listener';
        $vaultDocumentHookListener = 'event/vault_document_hook_register_listener';
        $toolServerListener = 'event/tool_server_register_listener';
        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');
        $agent->listen([
            'oaaoai/chat:purpose_allocation.register'      => $purposeAllocationListener,
            'oaaoai/rag:purpose_allocation.register'       => $purposeAllocationListener,
            'oaaoai/vault:purpose_allocation.register'      => $purposeAllocationListener,
            'oaaoai/user:purpose_allocation.register'      => $purposeAllocationListener,
            'oaaoai/endpoints:purpose_allocation.register' => $purposeAllocationListener,
            'oaaoai/slide-designer:purpose_allocation.register' => $purposeAllocationListener,
            'oaaoai/research:purpose_allocation.register' => $purposeAllocationListener,
            'oaaoai/mine:purpose_allocation.register'    => $purposeAllocationListener,
            'oaaoai/chat:chat_pipeline.register'           => $chatPipelineListener,
            'oaaoai/rag:chat_pipeline.register'            => $chatPipelineListener,
            'oaaoai/vault:chat_pipeline.register'         => $chatPipelineListener,
            'oaaoai/endpoints:chat_pipeline.register'       => $chatPipelineListener,
            'oaaoai/chat:planner_agent.register'           => $plannerAgentListener,
            'oaaoai/rag:planner_agent.register'            => $plannerAgentListener,
            'oaaoai/vault:planner_agent.register'          => $plannerAgentListener,
            'oaaoai/endpoints:planner_agent.register'      => $plannerAgentListener,
            'oaaoai/sandbox-coder:planner_agent.register'  => $plannerAgentListener,
            'oaaoai/slide-designer:planner_agent.register' => $plannerAgentListener,
            'oaaoai/slide-designer:chat_pipeline.register' => $chatPipelineListener,
            'oaaoai/chat:micro_skill_provider.register'       => $microSkillProviderListener,
            'oaaoai/slide-designer:micro_skill_provider.register' => $microSkillProviderListener,
            'oaaoai/endpoints:micro_skill_provider.register'  => $microSkillProviderListener,
            'oaaoai/vault:vault_document_hook.register'    => $vaultDocumentHookListener,
            'oaaoai/rag:vault_document_hook.register'      => $vaultDocumentHookListener,
            'oaaoai/endpoints:vault_document_hook.register' => $vaultDocumentHookListener,
            'oaaoai/chat:tool_server.register'           => $toolServerListener,
            'oaaoai/rag:tool_server.register'            => $toolServerListener,
            'oaaoai/endpoints:tool_server.register'      => $toolServerListener,
            'oaaoai/chat:mm_python_module.register'      => $mmPythonModuleListener,
            'oaaoai/rag:mm_python_module.register'       => $mmPythonModuleListener,
            'oaaoai/vault:mm_python_module.register'     => $mmPythonModuleListener,
            'oaaoai/endpoints:mm_python_module.register' => $mmPythonModuleListener,
            'oaaoai/live-meeting:asr_user_preference.register' => $asrUserPreferenceListener,
            'oaaoai/chat:asr_user_preference.register'       => $asrUserPreferenceListener,
            'oaaoai/rag:asr_user_preference.register'        => $asrUserPreferenceListener,
            'oaaoai/endpoints:asr_user_preference.register'  => $asrUserPreferenceListener,
        ]);

        // Settings nav rows for endpoints / purposes: {@code panel_js_module} is {@code /webassets/core/default/js/oaao-endpoints-settings-panel.js} (registered in {@code oaaoai/core}) so {@code index.tpl} embeds {@code oaao-settings-registry} before SPA bootstrap.

        // {@code 'api' => [ … ]} scopes routes under {@code /endpoints/api/…} and resolves handlers from {@code controller/api/}.
        // Values are **relative to that folder** — do not prefix {@code api/} again ({@code 'api/endpoints_list'} would double-resolve).
        $agent->addLazyRoute([
            'api' => [
                'GET endpoints_list'         => 'endpoints_list',
                'GET endpoints_usage_stats'  => 'endpoints_usage_stats',
                'GET usage_by_purpose'       => 'usage_by_purpose',
                'POST endpoints_save'        => 'endpoints_save',
                'POST endpoints_delete' => 'endpoints_delete',
                'GET purposes_list'     => 'purposes_list',
                'POST purposes_save'    => 'purposes_save',
                'POST purposes_delete'  => 'purposes_delete',
                'GET mm_settings'       => 'mm_settings',
                'POST mm_settings_save' => 'mm_settings_save',
                'GET credit_factors'           => 'credit_factors',
                'GET knowledge_settings'       => 'knowledge_settings',
                'POST knowledge_settings_save' => 'knowledge_settings_save',
                'POST knowledge_cron_run'           => 'knowledge_cron_run',
                'POST knowledge_platform_bootstrap' => 'knowledge_platform_bootstrap',
                'POST funasr_ensure'      => 'funasr_ensure',
                'POST funasr_nano_ensure' => 'funasr_nano_ensure',
                'POST model_probe'        => 'model_probe',
            ],
        ]);

        return true;
    }

    /**
     * {@inheritDoc}
     */
    public function __onAPICall(\Razy\ModuleInfo $module, string $method, string $fqdn = ''): bool
    {
        $code = $module->getCode();
        if (! str_starts_with($code, 'oaaoai/')) {
            return false;
        }

        return \in_array($method, [
            'registerPurposeAllocationSlot',
            'getPurposeAllocationSlots',
            'ensureFeatureRegistries',
            'resolveOrchestratorAsrPayload',
            'resolveOrchestratorLiveAsrPayload',
            'resolveOrchestratorEmbeddingPayload',
            'resolveOrchestratorVaultRagConfig',
            'resolveAllowedAgents',
            'resolveRunPlannerMode',
            'resolveOrchestratorPolishPayload',
            'resolveOrchestratorUiqePayload',
            'resolveOrchestratorPlannerPayload',
            'resolveOrchestratorPlannerIntentPayload',
            'getAsrUserPreferenceRegistry',
            'isPolishPurposeConfigured',
        ], true);
    }
};
