<?php

namespace Module\oaao\endpoints;

require_once __DIR__ . '/../library/PurposeAllocationRegister.php';
require_once __DIR__ . '/../library/CanonicalEndpointsRepository.php';
require_once __DIR__ . '/../library/AsrPurposeConfig.php';

use oaaoai\endpoints\AsrPurposeConfig;
use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\ChatAllowedAgentsPurposeConfig;
use oaaoai\endpoints\PurposeAllocationRegister;
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
            require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';
            \Oaaoai\Core\TenantContext::bootstrap($pdo);
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
        $secret = \is_string($secret) && trim($secret) !== '' ? trim($secret) : 'oaao_dev_shared_secret';

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
     * Embedded into {@code index.tpl} by {@see core.main.php} via {@code api('endpoints')->getPurposeAllocationSlots()}.
     *
     * @return list<array<string, mixed>>
     */
    public function getPurposeAllocationSlots(): array
    {
        return PurposeAllocationRegister::allSorted();
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
        $repo = new CanonicalEndpointsRepository($db);
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
    public function resolveOrchestratorEmbeddingPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db);
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
     * @return array<string, mixed>
     */
    public function resolveOrchestratorVaultRagConfig(): array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return [];
        }
        $repo = new CanonicalEndpointsRepository($db);

        return $repo->resolveRagRetrievalConfig();
    }

    /**
     * @return list<string>
     */
    public function resolveAllowedAgents(): array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            require_once dirname(__DIR__, 3) . '/library/ChatAllowedAgentsPurposeConfig.php';

            return ChatAllowedAgentsPurposeConfig::defaultAllowed();
        }
        $repo = new CanonicalEndpointsRepository($db);

        return $repo->resolveAllowedAgents();
    }

    public function resolveRunPlannerMode(): string
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return 'auto';
        }
        $repo = new CanonicalEndpointsRepository($db);

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
        require_once __DIR__ . '/../library/UiqePurposeConfig.php';
        $repo = new CanonicalEndpointsRepository($db);
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
    public function resolveOrchestratorPolishPayload(): ?array
    {
        $db = $this->oaao_endpoints_canonical_db();
        if (! $db) {
            return null;
        }
        $repo = new CanonicalEndpointsRepository($db);
        $polishBind = $repo->resolvePolishBinding();
        if ($polishBind === null) {
            return null;
        }
        $pref = trim((string) ($polishBind['api_key_ref'] ?? ''));
        $chat = $this->api('chat');

        return [
            'purpose_key' => $polishBind['purpose_key'],
            'base_url'    => $polishBind['base_url'],
            'model'       => $polishBind['model'],
            'api_key_env' => ($pref !== '' && $chat)
                ? $chat->inferOrchestratorApiKeyEnv($pref)
                : null,
        ];
    }

    public function __onInit(Agent $agent): bool
    {
        /* Required for {@see Emitter}: {@code $this->api('endpoints')->registerPurposeAllocationSlot(...)} from {@code oaaoai/*}. */
        $agent->addAPICommand([
            'registerPurposeAllocationSlot'       => 'registerPurposeAllocationSlot',
            'getPurposeAllocationSlots'           => 'getPurposeAllocationSlots',
            'resolveOrchestratorAsrPayload'       => 'resolveOrchestratorAsrPayload',
            'resolveOrchestratorEmbeddingPayload' => 'resolveOrchestratorEmbeddingPayload',
            'resolveOrchestratorVaultRagConfig'   => 'resolveOrchestratorVaultRagConfig',
            'resolveAllowedAgents'                => 'resolveAllowedAgents',
            'resolveRunPlannerMode'               => 'resolveRunPlannerMode',
            'resolveOrchestratorPolishPayload'    => 'resolveOrchestratorPolishPayload',
            'resolveOrchestratorUiqePayload'      => 'resolveOrchestratorUiqePayload',
        ]);

        $purposeAllocationListener = 'event/purpose_allocation_register_listener';
        $chatPipelineListener = 'event/chat_pipeline_register_listener';
        $plannerAgentListener = 'event/planner_agent_register_listener';
        $microSkillProviderListener = 'event/micro_skill_provider_register_listener';
        $vaultDocumentHookListener = 'event/vault_document_hook_register_listener';
        $agent->listen([
            'oaaoai/chat:purpose_allocation.register'      => $purposeAllocationListener,
            'oaaoai/rag:purpose_allocation.register'       => $purposeAllocationListener,
            'oaaoai/vault:purpose_allocation.register'      => $purposeAllocationListener,
            'oaaoai/user:purpose_allocation.register'      => $purposeAllocationListener,
            'oaaoai/endpoints:purpose_allocation.register' => $purposeAllocationListener,
            'oaaoai/slide-designer:purpose_allocation.register' => $purposeAllocationListener,
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
        ]);

        PurposeAllocationRegister::add(
            'pa-chat',
            'Chat',
            'Chat',
            'Registered chat pipeline — multiple chat-endpoint profiles in the selector; rows here set default LLMs per routing key.',
            'message-circle-more',
            [
                'sort' => 10,
                'purpose_key_prefix' => 'chat',
                'allocation_mode' => 'chat_multi',
                'module_code' => 'oaaoai/endpoints',
                'label_key' => 'settings.slot.chat.label',
                'sub_key'   => 'settings.slot.chat.sub',
            ]
        );
        PurposeAllocationRegister::add(
            'pa-uiqe',
            'Input quality',
            'Input quality',
            'Pre-flight scoring (e.g. IQS / ACCS) — fast, low-cost models.',
            'sparkles',
            [
                'sort' => 60,
                'purpose_key_prefix' => 'uiqe',
                'module_code' => 'oaaoai/endpoints',
                'label_key' => 'settings.slot.uiqe.label',
                'sub_key'   => 'settings.slot.uiqe.sub',
            ]
        );
        PurposeAllocationRegister::add(
            'pa-asr',
            'ASR',
            'ASR',
            'Speech-to-text modules register here (<code class="font-mono text-xs">asr.*</code>).',
            'mic',
            [
                'sort' => 70,
                'purpose_key_prefix' => 'asr',
                'module_code' => 'oaaoai/endpoints',
                'label_key' => 'settings.slot.asr.label',
                'sub_key'   => 'settings.slot.asr.sub',
            ]
        );
        PurposeAllocationRegister::add(
            'pa-other',
            'Other',
            'Other purposes',
            'Routing keys that do not match any registered prefix above.',
            'circle-dotted',
            [
                'sort' => 900,
                'fallback' => true,
                'module_code' => 'oaaoai/endpoints',
                'label_key' => 'settings.slot.other.label',
                'title_key' => 'settings.slot.other.title',
                'sub_key'   => 'settings.slot.other.sub',
            ]
        );

        // Settings nav rows for endpoints / purposes: {@code panel_js_module} is {@code /webassets/core/default/js/oaao-endpoints-settings-panel.js} (registered in {@code oaaoai/core}) so {@code index.tpl} embeds {@code oaao-settings-registry} before SPA bootstrap.

        // {@code 'api' => [ … ]} scopes routes under {@code /endpoints/api/…} and resolves handlers from {@code controller/api/}.
        // Values are **relative to that folder** — do not prefix {@code api/} again ({@code 'api/endpoints_list'} would double-resolve).
        $agent->addLazyRoute([
            'api' => [
                'GET endpoints_list'    => 'endpoints_list',
                'POST endpoints_save'   => 'endpoints_save',
                'POST endpoints_delete' => 'endpoints_delete',
                'GET purposes_list'     => 'purposes_list',
                'POST purposes_save'    => 'purposes_save',
                'POST purposes_delete'  => 'purposes_delete',
                'POST funasr_ensure'    => 'funasr_ensure',
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
            'resolveOrchestratorAsrPayload',
            'resolveOrchestratorEmbeddingPayload',
            'resolveOrchestratorVaultRagConfig',
            'resolveAllowedAgents',
            'resolveRunPlannerMode',
            'resolveOrchestratorPolishPayload',
            'resolveOrchestratorUiqePayload',
        ], true);
    }
};
