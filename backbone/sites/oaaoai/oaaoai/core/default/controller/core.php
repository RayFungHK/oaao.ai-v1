<?php

/**
 * oaao.ai Core (SPA shell)
 *
 * ## Tenancy (conceptual)
 *
 * A **tenant** is bound from the request host (apex domain or subdomain). Tenant policy includes signup mode
 * (**public** self-serve vs **private** admin-created accounts). Vector / vault partition slugs use the same host
 * binding via {@see \Oaaoai\Core\TenantHostResolver} (Razy {@code sites.inc.php} domain keys + alias; whitelabel FQDN entries).
 * Under a tenant, **workspaces** are isolated environments
 * (conversations, vault/RAG, invites, owner-capable roles). Capabilities without a workspace context run as **personal**
 * (user-global within the tenant boundary).
 *
 * Feature modules register workspace pages through {@see \Oaaoai\Core\SpaRegister}, administrator Settings panels through
 * {@see \Oaaoai\Core\SettingsRegister}, **user Preferences panels** through {@see \Oaaoai\Core\PreferencesRegister},
 * and **scope support** through {@see \Oaaoai\Core\FeatureScopeRegister}.
 *
 * Registration axes:
 * - **SPA shell:** {@code api('core')->registerSpaPage} → {@see SpaRegister} (sidebar + {@code workspace-module-mount}).
 * - **Settings dialog:** {@code api('core')->registerSettingsSection} → {@see SettingsRegister}; Core may also call {@see SettingsRegister::add} during bootstrap when load-order requires it.
 * - **Preferences dialog:** {@code api('core')->registerPreferencesSection} → {@see PreferencesRegister} (optional {@code extras.levels} per section).
 * - **Feature scopes:** {@code api('core')->registerFeatureScope} → {@see FeatureScopeRegister} ({@code tenant} / {@code workspace} / {@code personal}).
 *
 * ### Modular layering (relationship)
 *
 * 1. **Module → shell** — Feature modules call {@code $this->api('core')->registerSpaPage} / {@code registerPreferencesSection} / {@code registerFeatureScope}
 *    from {@code __onInit}. Core does **not** maintain a growing {@code listen()} map keyed by module code — new modules only touch their own controller.
 * 2. **Domain registry** — {@code oaaoai/endpoints} owns administrator APIs and static registries for canonical LLM endpoints and purpose-allocation *slots*
 *    ({@see \\oaaoai\\endpoints\\PurposeAllocationRegister}), embedded as JSON in the shell — separate from the generic Settings nav rows.
 * 3. **Purpose extension hook** — Modules fire {@code purpose_allocation.register} on their namespace (e.g. {@code oaaoai/chat}, {@code oaaoai/rag} for {@code rag.*}/{@code rerank.*}/{@code vault.*}, {@code oaaoai/vault} for vault ingest {@code embedding.*}, {@code oaaoai/slide-designer} for {@code slide_template.*}).
 *    to add or annotate slots; {@code oaaoai/endpoints} listens and merges into {@code PurposeAllocationRegister}. Modules that own specialised UX
 *    (e.g. Chat wiring multi-profile chat endpoints) should expose their own Settings panel / APIs and treat shared Purpose UI as root defaults only.
 * 4. **Vault document hooks** — {@code vault_document_hook.register} merges into {@see \\oaaoai\\vault\\VaultDocumentHookRegister} (listeners on {@code oaaoai/endpoints}); embedded as {@code #oaao-vault-document-hook-registry}. Examples: {@code audio_asr}, {@code text_embed_rag}.
 *
 * Passive listeners:
 * - (none for SPA / Preferences / Feature scopes — use {@code api('core')} registration commands from any {@code oaaoai/*} module.)
 *
 * Purpose-allocation **slot** extensions use {@code purpose_allocation.register} on module namespaces; {@code oaaoai/endpoints} listens and merges into {@code PurposeAllocationRegister} (see **Modular layering** above).
 *
 * Vault document hooks still use {@code vault_document_hook.register} → {@see \\oaaoai\\vault\\VaultDocumentHookRegister} (listeners registered on {@code oaaoai/endpoints}).
 *
 * Active Emitter API (when core + caller modules are loaded):
 * - {@code registerSpaPage}
 * - {@code registerSettingsSection}
 * - {@code registerPreferencesSection}
 * - {@code registerFeatureScope}
 *
 * Serves the SPA shell via Razy template engine.
 */

namespace Module\oaao\app;

require_once __DIR__ . '/../library/SpaRegister.php';
require_once __DIR__ . '/../library/SettingsRegister.php';
require_once __DIR__ . '/../library/FeatureScopeRegister.php';
require_once __DIR__ . '/../library/PreferencesRegister.php';

use Oaaoai\Core\FeatureScopeRegister;
use Oaaoai\Core\PreferencesRegister;
use Oaaoai\Core\SettingsRegister;
use Oaaoai\Core\SpaRegister;
use Razy\Agent;
use Razy\Controller;

return new class extends Controller {
    /**
     * SPA registry hook for other modules ({@code api('core')}).
     *
     * @param array<string, mixed> $extras shell_panel_url, shell_js_module, … — see {@see SpaRegister::add}
     */
    public function registerSpaPage(string $page_id, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        SpaRegister::add($page_id, $title, $sub, $icon, $extras);
    }

    /**
     * @return list<array{page_id: string, title: string, sub: string, icon: string}>
     */
    public function getSPAPages(): array
    {
        return SpaRegister::allSorted();
    }

    /**
     * @param array<string, mixed> $extras sort, panel_html, panel_url, panel_js_module
     */
    public function registerSettingsSection(string $section_id, string $label, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        SettingsRegister::add($section_id, $label, $title, $sub, $icon, $extras);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getSettingsSections(): array
    {
        return SettingsRegister::allSorted();
    }

    /**
     * @param array<string, mixed> $extras sort, levels (list), panel_html, panel_url, panel_js_module
     */
    public function registerPreferencesSection(string $section_id, string $label, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        PreferencesRegister::add($section_id, $label, $title, $sub, $icon, $extras);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getPreferencesSections(): array
    {
        return PreferencesRegister::allSorted();
    }

    /**
     * @param list<string> $levels {@see FeatureScopeRegister} — {@code tenant}, {@code workspace}, {@code personal}
     * @param array<string, mixed> $extras reserved for forward-compatible hints (ignored today)
     */
    public function registerFeatureScope(string $feature_id, string $label, string $description = '', array $levels = [], int $sort = 500, array $extras = []): void
    {
        unset($extras);
        FeatureScopeRegister::add($feature_id, $label, $description, $levels, $sort);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function getFeatureScopes(): array
    {
        return FeatureScopeRegister::allSorted();
    }

    public function bootstrapTenantContext(\PDO $pdo): int
    {
        require_once __DIR__ . '/../library/TenantContext.php';

        \Oaaoai\Core\TenantContext::bootstrap($pdo);

        return \Oaaoai\Core\TenantContext::id();
    }

    public function tenantContextId(): int
    {
        require_once __DIR__ . '/../library/TenantContext.php';

        return \Oaaoai\Core\TenantContext::id();
    }

    public function tenantIsPlatform(): bool
    {
        require_once __DIR__ . '/../library/TenantContext.php';

        return \Oaaoai\Core\TenantContext::isPlatform();
    }

    public function rejectCustomerProductApi(\PDO $pdo): void
    {
        require_once __DIR__ . '/../library/PlatformProductGuard.php';
        \Oaaoai\Core\PlatformProductGuard::rejectCustomerProductApi($pdo);
    }

    /**
     * @param array<string, mixed> $meta
     */
    public function recordUsageChatCompletion(\PDO $pdo, int $tenantId, array $meta, ?int $userId = null): void
    {
        require_once __DIR__ . '/../library/UsageEventRepository.php';
        \Oaaoai\Core\UsageEventRepository::recordChatCompletion($pdo, $tenantId, $meta, $userId);
    }

    /**
     * @param array<string, mixed> $asrData
     */
    public function recordUsageChatAsr(\PDO $pdo, int $tenantId, array $asrData, ?int $userId = null): void
    {
        require_once __DIR__ . '/../library/UsageEventRepository.php';
        \Oaaoai\Core\UsageEventRepository::recordChatAsr($pdo, $tenantId, $asrData, $userId);
    }

    /**
     * @param array<string, mixed>|null $meta
     */
    public function recordUsageEvent(
        \PDO $pdo,
        int $tenantId,
        string $eventKind,
        ?float $quantity = null,
        ?string $unit = null,
        ?array $meta = null,
        ?int $userId = null,
    ): void {
        require_once __DIR__ . '/../library/UsageEventRepository.php';
        \Oaaoai\Core\UsageEventRepository::record($pdo, $tenantId, $eventKind, $quantity, $unit, $meta, $userId);
    }

    /**
     * @param array<string, mixed> $body
     * @param array<string, mixed> $job
     */
    public function recordVaultJobFinishUsage(
        \PDO $pdo,
        int $tenantId,
        string $hookId,
        string $status,
        array $body,
        array $job,
        ?int $userId = null,
    ): void {
        require_once __DIR__ . '/../library/UsageEventRepository.php';
        \Oaaoai\Core\UsageEventRepository::recordVaultJobFinish($pdo, $tenantId, $hookId, $status, $body, $job, $userId);
    }

    public function requireTenantContext(\PDO $pdo): int
    {
        require_once __DIR__ . '/../library/TenantContext.php';
        \Oaaoai\Core\TenantContext::require($pdo);
        if (! \Oaaoai\Core\TenantContext::isActive()) {
            http_response_code(403);
            header('Content-Type: application/json; charset=UTF-8');
            echo json_encode(['success' => false, 'message' => 'Tenant is suspended'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            exit;
        }

        return \Oaaoai\Core\TenantContext::id();
    }

    public function tenantContextSlug(): string
    {
        require_once __DIR__ . '/../library/TenantContext.php';

        return \Oaaoai\Core\TenantContext::slug();
    }

    public function userHasWorkspaceAccess(\Razy\Database $db, int $userId, int $workspaceId): bool
    {
        require_once __DIR__ . '/../library/WorkspaceMembership.php';

        return \Oaaoai\Core\WorkspaceMembership::userHasAccess($db, $userId, $workspaceId);
    }

    /**
     * @return array<string, int|null>
     */
    public function groupLimitsForUser(\PDO $pdo, int $userId): array
    {
        require_once __DIR__ . '/../library/GroupLimitEnforcer.php';

        return \Oaaoai\Core\GroupLimitEnforcer::limitsForUser($pdo, $userId);
    }

    /**
     * @param array<string, int|null> $limits
     */
    public function assertCanCreateVault(\PDO $pdo, int $userId, array $limits): ?string
    {
        require_once __DIR__ . '/../library/GroupLimitEnforcer.php';

        return \Oaaoai\Core\GroupLimitEnforcer::assertCanCreateVault($pdo, $userId, $limits);
    }

    /**
     * @param array<string, int|null> $limits
     */
    public function assertCanUploadVaultDocument(\PDO $pdo, int $userId, array $limits, int $byteSize): ?string
    {
        require_once __DIR__ . '/../library/GroupLimitEnforcer.php';

        return \Oaaoai\Core\GroupLimitEnforcer::assertCanUploadDocument($pdo, $userId, $limits, $byteSize);
    }

    public function __onInit(Agent $agent): bool
    {
        /* Required for {@see Emitter}: {@code $this->api('core')->registerSpaPage(...)} resolves API commands, not raw Controller methods. */
        $agent->addAPICommand([
            'registerSpaPage'                => 'registerSpaPage',
            'registerSettingsSection'        => 'registerSettingsSection',
            'registerPreferencesSection'     => 'registerPreferencesSection',
            'registerFeatureScope'           => 'registerFeatureScope',
            'bootstrapTenantContext'         => 'bootstrapTenantContext',
            'requireTenantContext'           => 'requireTenantContext',
            'tenantContextId'                => 'tenantContextId',
            'tenantContextSlug'              => 'tenantContextSlug',
            'tenantIsPlatform'               => 'tenantIsPlatform',
            'userHasWorkspaceAccess'         => 'userHasWorkspaceAccess',
            'groupLimitsForUser'             => 'groupLimitsForUser',
            'assertCanCreateVault'           => 'assertCanCreateVault',
            'assertCanUploadVaultDocument'   => 'assertCanUploadVaultDocument',
            'rejectCustomerProductApi'       => 'rejectCustomerProductApi',
            'recordUsageChatCompletion'      => 'recordUsageChatCompletion',
            'recordUsageChatAsr'             => 'recordUsageChatAsr',
            'recordUsageEvent'               => 'recordUsageEvent',
            'recordVaultJobFinishUsage'      => 'recordVaultJobFinishUsage',
        ]);

        /**
         * Admin Settings JSON is embedded during {@code main} render ({@see core.main.php}). With non-greedy module loads,
         * {@code oaaoai/endpoints} might not have fired registration APIs yet — register panels here as well.
         */
        /** Shell loads this path on every install; keep it under {@code core} webassets (not {@code oaaoai/endpoints}) so dev proxies that only expose {@code /webassets/core/*} still resolve the admin panel. */
        $epJs = '/webassets/core/default/js/oaao-endpoints-settings-panel.js';

        SettingsRegister::add(
            'settings-endpoints',
            'Endpoints',
            'LLM endpoints',
            'Canonical provider rows (<code class="font-mono text-xs">oaao_endpoint</code>) on the auth canonical database.',
            'plug',
            [
                'sort'            => 24,
                'panel_js_module' => $epJs,
                'label_key'       => 'settings.nav.endpoints.label',
                'title_key'       => 'settings.nav.endpoints.title',
                'sub_key'         => 'settings.nav.endpoints.sub',
            ]
        );

        $asrJs = '/webassets/core/default/js/oaao-asr-settings-panel.js';

        SettingsRegister::add(
            'settings-asr',
            'ASR',
            'Speech pipeline',
            'Batch pipeline (mode, diarization) and Live ASR preferences — endpoints under Purpose allocation.',
            'mic',
            [
                'sort'            => 25,
                'panel_js_module' => $asrJs,
                'label_key'       => 'settings.nav.asr.label',
                'title_key'       => 'settings.nav.asr.title',
                'sub_key'         => 'settings.nav.asr.sub',
            ]
        );

        $mmJs = '/webassets/core/default/js/oaao-mm-settings-panel.js';

        SettingsRegister::add(
            'settings-mm',
            'Multimodal',
            'Multimodal',
            'Understand / generate / edit backends — HTTP endpoint or Python module (Lance). Routing under Purpose allocation.',
            'scan-eye',
            [
                'sort'            => 27,
                'panel_js_module' => $mmJs,
                'label_key'       => 'settings.nav.mm.label',
                'title_key'       => 'settings.nav.mm.title',
                'sub_key'         => 'settings.nav.mm.sub',
            ]
        );

        $creditJs = '/webassets/core/default/js/oaao-credit-settings-panel.js';

        SettingsRegister::add(
            'settings-credit',
            'Credits',
            'Credit factors',
            'Token→credit ratios, purpose multipliers, and multimodal resolution billing.',
            'coins',
            [
                'sort'            => 28,
                'panel_js_module' => $creditJs,
                'label_key'       => 'settings.nav.credit.label',
                'title_key'       => 'settings.nav.credit.title',
                'sub_key'         => 'settings.nav.credit.sub',
            ]
        );

        $storageJs = '/webassets/core/default/js/oaao-storage-settings-panel.js';

        SettingsRegister::add(
            'settings-storage',
            'Storage',
            'Object storage',
            'Per-tenant blob backends (local, S3, GCS, Hugging Face) and migration.',
            'hard-drive',
            [
                'sort'            => 29,
                'panel_js_module' => $storageJs,
                'label_key'       => 'settings.nav.storage.label',
                'title_key'       => 'settings.nav.storage.title',
                'sub_key'         => 'settings.nav.storage.sub',
            ]
        );

        SettingsRegister::add(
            'settings-purposes',
            'Purpose allocation',
            'Purpose allocation',
            'Slots are <strong>registered pipeline groups</strong> (from <code class="font-mono text-xs">oaaoai/endpoints</code> <code class="font-mono text-xs">PurposeAllocationRegister</code>). This panel sets root default LLMs via <code class="font-mono text-xs">oaao_purpose</code> (PostgreSQL). Chat-specific modes and selector profiles are configured by the <strong>Chat</strong> module. Downstream tools consume the registry together with purpose rows.',
            'signpost',
            [
                'sort'            => 26,
                'panel_js_module' => $epJs,
                'label_key'       => 'settings.nav.purposes.label',
                'title_key'       => 'settings.nav.purposes.title',
                'sub_key'         => 'settings.nav.purposes.sub',
            ]
        );

        $accessJs = '/webassets/core/default/js/oaao-access-settings-panel.js';

        SettingsRegister::add(
            'settings-users',
            'Users',
            'User management',
            'Create accounts, assign permission groups, and manage access.',
            'users',
            [
                'sort'            => 16,
                'panel_js_module' => $accessJs,
                'label_key'       => 'settings.nav.users.label',
                'title_key'       => 'settings.nav.users.title',
                'sub_key'         => 'settings.nav.users.sub',
            ]
        );

        SettingsRegister::add(
            'settings-permission-groups',
            'Permission groups',
            'Permission groups',
            'Feature access, workspace limits, and storage quotas per group.',
            'shield-check',
            [
                'sort'            => 18,
                'panel_js_module' => $accessJs,
                'label_key'       => 'settings.nav.groups.label',
                'title_key'       => 'settings.nav.groups.title',
                'sub_key'         => 'settings.nav.groups.sub',
            ]
        );

        $evoQueueJs = '/webassets/core/default/js/oaao-evolution-queue-settings-panel.js';

        SettingsRegister::add(
            'settings-evolution-queue',
            'Evolution',
            'Evolution',
            'Queue status, patches, crystallization, and IQS governance.',
            'layers',
            [
                'sort'            => 29,
                'panel_js_module' => $evoQueueJs,
                'label_key'       => 'settings.nav.evolution_queue.label',
                'title_key'       => 'settings.nav.evolution_queue.title',
                'sub_key'         => 'settings.nav.evolution_queue.sub',
            ]
        );

        /**
         * Preferences dialog — seed Dashboard + Settings here (same rationale as Settings rows).
         * Shell JS lives under {@code core} webassets so every install resolves {@code panel_js_module} without {@code oaaoai/user} load-order drift.
         */
        $prefJs = '/webassets/core/default/js/user-preferences-panels.js';

        PreferencesRegister::add(
            'pref-dashboard',
            'Dashboard',
            'Dashboard',
            'Token usage and credit balance for your account (last 30 days).',
            'layout-grid',
            [
                'sort'            => 0,
                'levels'          => ['personal'],
                'panel_js_module' => $prefJs,
                'label_key'       => 'preferences.nav.dashboard.label',
                'title_key'       => 'preferences.nav.dashboard.title',
                'sub_key'         => 'preferences.nav.dashboard.sub',
            ],
        );

        PreferencesRegister::add(
            'pref-personalization',
            'Personalization',
            'Personalization',
            'Manage who you are and what the assistant remembers.',
            'sparkles',
            [
                'sort'            => 5,
                'levels'          => ['personal'],
                'panel_js_module' => $prefJs,
                'label_key'       => 'preferences.nav.personalization.label',
                'title_key'       => 'preferences.nav.personalization.title',
                'sub_key'         => 'preferences.nav.personalization.sub',
            ],
        );

        $asrPrefJs = '/webassets/live-meeting/default/js/asr-user-preferences-panel.js';

        PreferencesRegister::add(
            'pref-asr',
            'Speech',
            'Speech & ASR',
            'Voice input polish and related ASR preferences.',
            'mic',
            [
                'sort'            => 8,
                'levels'          => ['personal'],
                'panel_js_module' => $asrPrefJs,
                'label_key'       => 'preferences.nav.asr.label',
                'title_key'       => 'preferences.nav.asr.title',
                'sub_key'         => 'preferences.nav.asr.sub',
            ],
        );

        PreferencesRegister::add(
            'pref-personal',
            'Settings',
            'Settings',
            'Profile, password, and display language.',
            'user-circle',
            [
                'sort'            => 10,
                'levels'          => ['personal'],
                'panel_js_module' => $prefJs,
                'label_key'       => 'preferences.nav.personal.label',
                'title_key'       => 'preferences.nav.personal.title',
                'sub_key'         => 'preferences.nav.personal.sub',
            ],
        );

        /**
         * Seed primary SPA row here (parity with Settings rows above). Ensures {@code #oaao-spa-registry} includes Chat even when
         * downstream module {@code __onInit} order/load differs — otherwise {@code workspace-chat-sidebar-section} stays hidden and the shell looks empty.
         * {@code oaaoai/chat} keeps registering the same page id for labels/extras drift parity.
         */
        SpaRegister::add(
            'workspace/chat',
            'Chat',
            'Ask anything — conversations stay in your workspace',
            'message-circle-more',
            [
                'shell_panel_url' => '/chat/workspace-panel',
                'shell_js_module' => '/webassets/chat/default/js/chat-panel.js',
            ]
        );

        /**
         * Vault shell SPA — same bootstrap rationale as Chat: rail + Apps nav read {@code OAAO_SPA_REGISTRY} before optional {@code api('core')} wiring order issues.
         */
        SpaRegister::add(
            'workspace/vault',
            'Vault',
            'Containers and documents — workspace or personal',
            'folder-archive',
            [
                'shell_panel_url' => '/vault/workspace-panel',
                'shell_js_module' => '/webassets/vault/default/js/vault-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/rag-explore',
            'RAG Explore',
            'Hybrid vector search and knowledge-graph visualization',
            'share-2',
            [
                'shell_panel_url' => '/rag/workspace-panel',
                'shell_js_module' => '/webassets/rag/default/js/rag-explore-panel.js',
            ]
        );

        /**
         * Agents catalog SPA — seeded like Chat/Vault so {@code #workspace-rail-agents} is not left {@code hidden}
         * when {@code oaaoai/chat} {@code __onInit} order differs from {@see core.main.php} JSON embed.
         */
        SpaRegister::add(
            'workspace/agents',
            'Agents',
            'Orchestrator capabilities in this workspace',
            'bot',
            [
                'shell_panel_url' => '/chat/workspace-agents-panel',
                'shell_js_module' => '/webassets/chat/default/js/agents-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/templates',
            'Templates',
            'Import and publish slide deck templates',
            'square-dashed-kanban',
            [
                'shell_panel_url' => '/slide-designer/workspace-templates-panel',
                'shell_js_module'  => '/webassets/slide-designer/default/js/template-gallery-sidebar.js',
            ]
        );

        /**
         * Corpus Studio — seeded like Vault/Research so {@code #workspace-rail-corpus} and {@code /workspace/corpus}
         * work even when {@code oaaoai/corpus} {@code __onInit} order or load differs from shell JSON embed.
         */
        SpaRegister::add(
            'workspace/corpus',
            'Corpus',
            'Style profiles from uploads or Vault sources',
            'book-marked',
            [
                'shell_panel_url' => '/corpus/workspace-panel',
                'shell_js_module' => '/webassets/corpus/default/js/corpus-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/library',
            'Library',
            'Documents with blocks + markdown mirror',
            'file-text',
            [
                'shell_panel_url' => '/library/workspace-panel',
                'shell_js_module' => '/webassets/library/default/js/library-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/calendar',
            'Calendar',
            'Events and schedule',
            'calendar',
            [
                'shell_panel_url' => '/calendar/workspace-panel',
                'shell_js_module' => '/webassets/calendar/default/js/calendar-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/live-meeting',
            'Live meeting',
            'Streaming meeting transcript — audio via orchestrator',
            'mic',
            [
                'shell_panel_url' => '/live-meeting/workspace-panel',
                'shell_js_module' => '/webassets/live-meeting/default/js/live-meeting-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/research',
            'Article Research',
            'Fetch articles → Vault markdown + summary',
            'microscope',
            [
                'shell_panel_url' => '/research/workspace-panel',
                'shell_js_module' => '/webassets/research/default/js/research-panel.js',
            ]
        );

        SpaRegister::add(
            'workspace/mines',
            'Data Mining',
            'Scheduled fetch → structured SQLite tables',
            'database',
            [
                'shell_panel_url' => '/mine/workspace-panel',
                'shell_js_module' => '/webassets/mine/default/js/mine-panel.js',
            ]
        );

        // Literal routes must sit in the same {@code addRoute} batch as {@code /:a+} so sort order keeps them ahead of the SPA catch-all.
        $agent->addRoute([
            'GET /health'                   => 'health',
            'GET /api/build_info'            => 'api/build_info',
            'GET /api/storage_settings'      => 'api/storage_settings',
            'POST /api/storage_settings'     => 'api/storage_settings',
            'POST /api/storage_test'         => 'api/storage_test',
            'POST /api/storage_migrate'        => 'api/storage_migrate',
            'GET /api/storage_migrate_status'  => 'api/storage_migrate_status',
            '/:a+'                           => 'main',
            '/'                              => 'main',
        ]);

        return true;
    }

    public function __onReady(): void
    {
        require_once __DIR__ . '/../library/AuthSchemaBridge.php';
        $auth = $this->api('auth');
        if ($auth && method_exists($auth, 'ensureTenantSchema')) {
            \Oaaoai\Core\AuthSchemaBridge::setEnsureTenantSchema(
                static function (\PDO $pdo) use ($auth): void {
                    $auth->ensureTenantSchema($pdo);
                },
            );
        }
        if ($auth && method_exists($auth, 'ensurePermissionGroupSchema')) {
            \Oaaoai\Core\AuthSchemaBridge::setEnsurePermissionGroupSchema(
                static function (\PDO $pdo) use ($auth): void {
                    $auth->ensurePermissionGroupSchema($pdo);
                },
            );
        }
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

        return \in_array(
            $method,
            [
                'registerSpaPage',
                'registerSettingsSection',
                'registerPreferencesSection',
                'registerFeatureScope',
                'bootstrapTenantContext',
                'requireTenantContext',
                'tenantContextId',
                'tenantContextSlug',
                'tenantIsPlatform',
                'userHasWorkspaceAccess',
                'groupLimitsForUser',
                'assertCanCreateVault',
                'assertCanUploadVaultDocument',
                'rejectCustomerProductApi',
                'recordUsageChatCompletion',
                'recordUsageChatAsr',
                'recordUsageEvent',
                'recordVaultJobFinishUsage',
            ],
            true,
        );
    }
};
