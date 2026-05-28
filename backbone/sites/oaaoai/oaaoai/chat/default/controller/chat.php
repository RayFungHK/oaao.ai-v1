<?php

namespace Module\oaao\chat;

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\chat\ChatPipelineRegister;
use oaaoai\chat\ChatVaultScope;
use oaaoai\chat\PlannerAgentRegister;
use oaaoai\vault\VaultQdrantCollectionResolver;
use oaaoai\vault\VaultRetrievalProfiles;
use oaaoai\user\UserDisplayPreferences;
use Razy\Database;
use Razy\Agent;
use Razy\Controller;

/**
 * Workspace chat surface — registers SPA ({@code api('core')->registerSpaPage}), user Preferences panels ({@code registerPreferencesSection}),
 * and capability scopes ({@code registerFeatureScope}).
 *
 * **Modular extension:** Chat-owned endpoint / purpose UX (multi-profile selector, {@code chat.*} modes, …) may register via
 * {@code api('core')->registerSettingsSection} ({@code panel_js_module} / APIs) when exposed in the admin Settings dialog; heavy LLM row editing stays in {@code oaaoai/endpoints}.
 * Slot metadata may still be contributed with {@code purpose_allocation.register} so {@see \\oaaoai\\endpoints\\PurposeAllocationRegister} and downstream tools stay aligned (e.g. {@code planning.*} slot owned here).
 *
 * Chat persistence for **threads/messages** uses the auth module **split adjunct SQLite** ({@code getDBSplit()}),
 * not PostgreSQL — mirrors razit exposing a dedicated DB handle while identity stays canonical.
 *
 * **Chat completion profiles** ({@code oaao_chat_endpoint} / {@code oaao_chat_endpoint_llm}) live on the **canonical**
 * auth database ({@code getDB()}) alongside {@code oaao_endpoint}, same as the Endpoints administrator APIs.
 *
 * **Hard rule:** do not serve SSE or WebSocket from PHP/Razy closures — streaming terminals live on the Python orchestrator; PHP exposes JSON only (e.g. {@code stream_url} / {@code run_id} placeholders).
 */
return new class extends Controller {
    /**
     * Workspace shell panel loader returns JSON only ({@code success}, {@code message}, {@code data}).
     * Razy {@see Controller::xhr()} always emits HTTP 200 — use explicit JSON headers here for correct status codes.
     *
     * @param array<string, mixed>|null $data
     */
    private function oaao_workspace_panel_json_exit(int $httpStatus, bool $success, string $message = '', ?array $data = null): never
    {
        http_response_code($httpStatus);
        header('Content-Type: application/json; charset=UTF-8');
        $payload = ['success' => $success];
        if ($message !== '') {
            $payload['message'] = $message;
        }
        if ($data !== null) {
            $payload['data'] = $data;
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    /**
     * Signed-in session only — does **not** require adjunct SQLite (workspace routing picker reads canonical DB).
     *
     * @return array{mixed|null, object|null} Auth emitter (API), user entity
     */
    protected function oaao_chat_require_authenticated_only(): array
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        // Emitter delegates via __call — method_exists() is always false for API commands.
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return [null, null];
        }

        // Same session gate as razit-style {@code restrict(true)} — exits with JSON 401 if anonymous.
        $auth->restrict(true);

        $user = $auth->getUser();
        $uid = (int) ($user->user_id ?? 0);
        if ($uid < 1) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Invalid session']);

            return [null, null];
        }

        return [$auth, $user];
    }

    /**
     * Authenticated user + PDO on **split** SQLite for chat persistence rows.
     *
     * @return array{\Razy\Database|null, object|null, \PDO|null}
     */
    protected function oaao_chat_require_user(): array
    {
        [$auth, $user] = $this->oaao_chat_require_authenticated_only();
        if (! $auth || ! $user) {
            return [null, null, null];
        }

        $splitDb = $auth->getDBSplit();
        if (! $splitDb || ! $splitDb->getDBAdapter() instanceof \PDO) {
            $auth->ensureAdjunctSqliteLoaded();
            $splitDb = $auth->getDBSplit();
        }

        if (! $splitDb || ! $splitDb->getDBAdapter() instanceof \PDO) {
            http_response_code(503);
            $detail = '';
            try {
                $detail = trim((string) $auth->getAdjunctSqliteLastError());
            } catch (\Throwable) {
                // emitter edge case — omit detail
            }
            $payload = [
                'success' => false,
                'message' => 'Split database unavailable — adjunct SQLite could not open. With Docker bind mounts, files live on the host but PHP uses paths inside the container; ensure ./docker/data/auth-local (or your OAAO_AUTH_SQLITE_PATH) is writable by www-data, or set OAAO_ADJUNCT_SQLITE to a writable path (see docker/env.example). On bare-metal PHP, auth falls back beside the auth module.',
            ];
            if ($detail !== '') {
                $payload['adjunct_detail'] = $detail;
            }
            echo json_encode($payload);

            return [null, null, null];
        }

        return [$splitDb, $user, $splitDb->getDBAdapter()];
    }

    /**
     * Canonical auth PDO ({@code oaao_user}, …) — not split adjunct SQLite used for chat threads.
     */
    protected function oaao_chat_canonical_pdo(): ?\PDO
    {
        $auth = $this->api('auth');
        if (! $auth) {
            return null;
        }
        $pdo = $auth->getDB()?->getDBAdapter();

        return $pdo instanceof \PDO ? $pdo : null;
    }

    /**
     * Administrator session + canonical {@see \Razy\Database} — JSON errors already emitted when returning null.
     */
    protected function oaao_chat_require_admin(): ?\Razy\Database
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
     * Optional workspace dimension for split-chat rows — {@code null} means personal (user-global shell).
     *
     * @param array<string, mixed>|null $body Parsed JSON body for POST handlers; {@code null} reads GET/query only.
     */
    protected function oaao_chat_resolve_workspace_id(?array $body = null): ?int
    {
        $raw = null;
        if ($body !== null && \array_key_exists('workspace_id', $body)) {
            $raw = $body['workspace_id'];
        }
        if ($raw === null && isset($_GET['workspace_id'])) {
            $raw = $_GET['workspace_id'];
        }
        if ($raw === '' || $raw === false) {
            return null;
        }
        if ($raw === null) {
            return null;
        }
        if (\is_string($raw)) {
            $raw = trim($raw);
            if ($raw === '') {
                return null;
            }
        }
        if (! is_numeric($raw)) {
            return null;
        }

        $n = (int) $raw;

        return $n > 0 ? $n : null;
    }

    /**
     * When {@code workspace_id} is set, require PostgreSQL canonical DB + membership row.
     *
     * Emits JSON error and returns {@code false} when denied.
     */
    protected function oaao_chat_gate_workspace_scope(int $uid, ?int $wid): bool
    {
        if ($wid === null) {
            return true;
        }
        if ($uid < 1) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Invalid session']);

            return false;
        }

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return false;
        }

        $db = $auth->getDB();
        if (! $db instanceof \Razy\Database) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return false;
        }

        $auth->ensurePgCoreTables($db);

        if (! $auth->databaseIsPgsql($db)) {
            http_response_code(503);
            echo json_encode([
                'success' => false,
                'message' => 'Team workspaces require PostgreSQL as the canonical database.',
            ]);

            return false;
        }

        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return false;
        }

        $auth->ensurePgWorkspaceTables($pdo);

        require_once __DIR__ . '/api/_workspace_membership.php';

        if (! \oaao_chat_user_has_workspace_access($db, $uid, $wid)) {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'message' => 'You do not have access to this workspace.',
            ]);

            return false;
        }

        return true;
    }

    /**
     * 1-based assistant turn index for {@code oaao_turn_score.turn_index}.
     */
    protected function oaao_chat_turn_index_for_message(\Razy\Database $splitDb, int $conversationId, int $assistantMessageId): int
    {
        if ($conversationId < 1 || $assistantMessageId < 1) {
            return 0;
        }

        $exists = $splitDb->prepare()
            ->select('id')
            ->from('message')
            ->where('id=?,conversation_id=?,role=?')
            ->assign([
                'id'              => $assistantMessageId,
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
            ])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($exists)) {
            return 0;
        }

        $row = $splitDb->prepare()
            ->select('COUNT(*) AS turn_index')
            ->from('message')
            ->where('conversation_id=?,role=?,id<=?')
            ->assign([
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
                'id'              => $assistantMessageId,
            ])
            ->query()
            ->fetch();
        if (! \is_array($row)) {
            return 0;
        }

        return max(1, (int) ($row['turn_index'] ?? 0));
    }

    /**
     * Built-in planner agents — feature modules may override via {@code planner_agent.register}.
     */
    protected function oaao_chat_seed_planner_agents(): void
    {
        PlannerAgentRegister::add(
            'vault_rag',
            'Knowledge base',
            'Retrieve grounded passages from vault sources',
            [
                'sort'            => 10,
                'module_code'     => 'oaaoai/chat',
                'i18n_label_key'  => 'settings.planner.agent.vault_rag',
                'i18n_desc_key'   => 'workspace.task.agent_desc.vault_rag',
                'planner_hint'    => 'Use when the user needs document or knowledge-base retrieval (not for pure general knowledge without sources). '
                    . 'On continue/regenerate/retry, prior vault grounding may already be in conversation_material_grounding — still include vault_rag when vault_scope=yes to refresh, not to ignore stored excerpts.',
            ],
        );
        PlannerAgentRegister::add(
            'sandbox_code',
            'Sandbox code',
            'Write and run code in an isolated environment',
            [
                'sort'            => 20,
                'module_code'     => 'oaaoai/chat',
                'i18n_label_key'  => 'settings.planner.agent.sandbox_code',
                'i18n_desc_key'   => 'workspace.task.agent_desc.sandbox_code',
                'planner_hint'    => 'Use for calculations, data transforms, file generation, or validating code before downstream steps. '
                    . 'Place before slide_designer when numeric/tabular prep is needed.',
                'ask_enabled'     => true,
                'ask_hint'        => 'Set requires_ask=true when code execution is optional or the user only asked for an explanation. '
                    . 'In desk/slide mode, suggest forking to a new chat if they need heavy sandbox work alongside a deck.',
                'ask_default_message' => 'I can run sandbox code for calculations or file transforms. Proceed?',
            ],
        );
        PlannerAgentRegister::add(
            'slides',
            'Slides (legacy)',
            'Generate presentation decks (legacy stub)',
            [
                'sort'            => 30,
                'module_code'     => 'oaaoai/chat',
                'i18n_label_key'  => 'settings.planner.agent.slides',
                'i18n_desc_key'   => 'workspace.task.agent_desc.slides',
                'planner_hint'    => 'Legacy slide stub — prefer slide_designer for new decks.',
                'deprecated'      => true,
            ],
        );
        PlannerAgentRegister::add(
            'image_gen',
            'Image generation',
            'Generate images from prompts',
            [
                'sort'            => 40,
                'module_code'     => 'oaaoai/chat',
                'i18n_label_key'  => 'settings.planner.agent.image_gen',
                'i18n_desc_key'   => 'workspace.task.agent_desc.image_gen',
                'planner_hint'    => 'Use when the user explicitly wants generated images or illustrations. Prefer mm_generate when Settings allocates mm.generate.',
                'ask_enabled'     => true,
                'ask_hint'        => 'Set requires_ask=true unless the user clearly requested image generation. '
                    . 'Fork to a new chat when desk mode needs a non-slide visual workflow.',
                'ask_default_message' => 'I can generate images from your prompt. Proceed?',
            ],
        );
        PlannerAgentRegister::add(
            'web_search',
            'Web search',
            'Search the public web for live information',
            [
                'sort'            => 50,
                'module_code'     => 'oaaoai/chat',
                'i18n_label_key'  => 'settings.planner.agent.web_search',
                'i18n_desc_key'   => 'workspace.task.agent_desc.web_search',
                'planner_hint'    => 'Use for time-sensitive or public-web facts not covered by vault sources. '
                    . 'Prefer after vault_rag when both document and live web context matter. '
                    . 'Set requires_ask=false — web search runs immediately when scheduled.',
                'ask_enabled'     => false,
            ],
        );
        PlannerAgentRegister::add(
            'mcp_tool',
            'MCP integrations',
            'Call connected MCP tools',
            [
                'sort'            => 60,
                'module_code'     => 'oaaoai/chat',
                'i18n_label_key'  => 'settings.planner.agent.mcp_tool',
                'i18n_desc_key'   => 'workspace.task.agent_desc.mcp_tool',
                'planner_hint'    => 'Use when a connected integration or MCP tool is the right execution path.',
                'ask_enabled'     => true,
                'ask_hint'        => 'Set requires_ask=true when an integration call is not explicitly requested. '
                    . 'Fork when desk mode would mix unrelated MCP work with an in-progress slide deck.',
                'ask_default_message' => 'I can call a connected integration for this step. Proceed?',
            ],
        );
    }

    /**
     * Frozen Chat pipeline registry rows ({@see ChatPipelineRegister}) — embedded in SPA shell JSON.
     *
     * @return list<array<string, mixed>>
     */
    public function getChatPipelineRegistry(): array
    {
        $this->api('endpoints')?->ensureFeatureRegistries();

        return ChatPipelineRegister::allSorted();
    }

    /**
     * Frozen planner agent registry ({@see PlannerAgentRegister}) — embedded in SPA shell JSON.
     *
     * @return list<array<string, mixed>>
     */
    public function getPlannerAgentRegistry(): array
    {
        $this->api('endpoints')?->ensureFeatureRegistries();

        return PlannerAgentRegister::allSorted();
    }

    public function getOrchestratorInternalBase(): string
    {
        return ChatOrchestratorApi::internalBase();
    }

    public function getOrchestratorSharedSecret(): string
    {
        return ChatOrchestratorApi::sharedSecret();
    }

    /**
     * @param array<string, mixed>|null $payload
     *
     * @return array<string, mixed>|null
     */
    public function postOrchestratorInternalJson(string $path, ?array $payload = null, int $timeoutSec = 45): ?array
    {
        return ChatOrchestratorApi::postInternalJson($path, $payload, $timeoutSec);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getOrchestratorInternalJson(string $path, int $timeoutSec = 30): ?array
    {
        return ChatOrchestratorApi::getInternalJson($path, $timeoutSec);
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array{run_id: string, stream_token: string}|null
     */
    public function startOrchestratorChatRun(array $payload): ?array
    {
        return ChatOrchestratorApi::startChatRun($payload);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function cancelOrchestratorChatRun(string $runId): ?array
    {
        return ChatOrchestratorApi::cancelChatRun($runId);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolveOrchestratorAgentAsk(string $runId, string $taskId, string $decision): ?array
    {
        return ChatOrchestratorApi::resolveAgentAsk($runId, $taskId, $decision);
    }

    /**
     * @param array<string, string> $funasrEnv
     *
     * @return array<string, mixed>|null
     */
    public function ensureOrchestratorFunasr(bool $pull = true, array $funasrEnv = [], bool $recreate = false): ?array
    {
        return ChatOrchestratorApi::ensureFunasr($pull, $funasrEnv, $recreate);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function orchestratorFunasrStatus(): ?array
    {
        return ChatOrchestratorApi::funasrStatus();
    }

    public function inferOrchestratorApiKeyEnv(string $apiKeyRef): ?string
    {
        return ChatOrchestratorApi::inferApiKeyEnv($apiKeyRef);
    }

    /**
     * @return list<int>
     */
    public function embeddedVaultIdsForUserWorkspace(int $uid, ?int $workspaceId): array
    {
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return [];
        }
        $auth = $this->api('auth');
        $ids = ChatVaultScope::vaultIdsForRetrieval($db, $uid, $workspaceId, $auth);

        return ChatVaultScope::filterVaultIdsWithEmbeddedDocuments($db, $ids);
    }

    /**
     * @param list<int> $vaultIds
     *
     * @return list<array<string, mixed>>
     */
    public function vaultRetrievalProfilesForVaultIds(int $uid, ?int $workspaceId, array $vaultIds): array
    {
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return [];
        }
        /** @var list<int> $clean */
        $clean = [];
        foreach ($vaultIds as $v) {
            $n = \is_int($v) ? $v : (int) $v;
            if ($n > 0) {
                $clean[] = $n;
            }
            if (\count($clean) >= 24) {
                break;
            }
        }
        $clean = array_values(array_unique($clean, SORT_NUMERIC));
        if ($clean === []) {
            return [];
        }

        $auth = $this->api('auth');
        $allowed = array_fill_keys(ChatVaultScope::vaultIdsForRetrieval($db, $uid, $workspaceId, $auth), true);
        /** @var list<int> $filtered */
        $filtered = [];
        foreach ($clean as $vid) {
            if (isset($allowed[$vid])) {
                $filtered[] = $vid;
            }
        }
        if ($filtered === []) {
            return [];
        }

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $core = $this->api('core');
            if ($core) {
                $core->bootstrapTenantContext($pdo);
                $slug = trim((string) $core->tenantContextSlug());
                if ($slug !== '') {
                    VaultQdrantCollectionResolver::setTenantSlug($slug);
                }
            }
        }

        $infer = fn (string $ref): ?string => $this->inferOrchestratorApiKeyEnv($ref);

        return VaultRetrievalProfiles::fromVaultIds($db, $filtered, $infer);
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function vaultRetrievalProfilesForUserWorkspace(int $uid, ?int $workspaceId): array
    {
        return $this->vaultRetrievalProfilesForVaultIds(
            $uid,
            $workspaceId,
            $this->embeddedVaultIdsForUserWorkspace($uid, $workspaceId),
        );
    }

    /**
     * User Preferences → display locale and voice polish style.
     *
     * @return array{locale: string, polish_style: string}
     */
    private function userDisplayPreferences(int $uid): array
    {
        if ($uid < 1) {
            return UserDisplayPreferences::fromPreferences([]);
        }
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return UserDisplayPreferences::fromPreferences([]);
        }
        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return UserDisplayPreferences::fromPreferences([]);
        }
        $stmt = $pdo->prepare('SELECT preferences_json FROM oaao_user WHERE user_id = ? LIMIT 1');
        $stmt->execute([$uid]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (! \is_array($row)) {
            return UserDisplayPreferences::fromPreferences([]);
        }
        $rawPrefs = $row['preferences_json'] ?? '';
        if (! \is_string($rawPrefs) || trim($rawPrefs) === '') {
            return UserDisplayPreferences::fromPreferences([]);
        }
        try {
            $decoded = json_decode($rawPrefs, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return UserDisplayPreferences::fromPreferences([]);
        }
        if (! \is_array($decoded)) {
            return UserDisplayPreferences::fromPreferences([]);
        }

        return UserDisplayPreferences::fromPreferences($decoded);
    }

    /**
     * User Preferences → Personalization display locale (e.g. en, zh-Hant).
     */
    private function userDisplayLocale(int $uid): string
    {
        return $this->userDisplayPreferences($uid)['locale'];
    }

    /**
     * ASR, embedding, vault RAG config, glossary, retrieval profiles for live meeting session_start.
     *
     * @return array<string, mixed>
     */
    public function buildLiveMeetingOrchestratorExtras(int $uid, int $workspaceId): array
    {
        $extras = [];
        $endpoints = $this->api('endpoints');
        if ($endpoints) {
            $liveAsr = $endpoints->resolveOrchestratorLiveAsrPayload();
            $batchAsr = $endpoints->resolveOrchestratorAsrPayload();
            $asr = $liveAsr ?? $batchAsr;
            if ($asr !== null) {
                $extras['asr'] = $asr;
            }
            if ($liveAsr !== null && $batchAsr !== null) {
                $fallback = ! \array_key_exists('input_fallback', $liveAsr) || (bool) $liveAsr['input_fallback'];
                if ($fallback) {
                    $extras['asr_fallback'] = $batchAsr;
                }
            }
            $emb = $endpoints->resolveOrchestratorEmbeddingPayload();
            if ($emb !== null) {
                $extras['embedding'] = $emb;
            }
            $rag = $endpoints->resolveOrchestratorVaultRagConfig();
            if ($rag !== []) {
                $extras['vault_rag'] = $rag;
            }
            $polish = $endpoints->resolveOrchestratorPolishPayload();
            if ($polish !== null) {
                $extras['polish'] = $polish;
            }
        }
        if ($workspaceId > 0) {
            $vault = $this->api('vault');
            if ($vault) {
                $glossary = $vault->getWorkspaceGlossary($workspaceId);
                if ($glossary !== []) {
                    $extras['glossary'] = $glossary;
                }
            }
        }
        $profiles = $this->vaultRetrievalProfilesForUserWorkspace($uid, $workspaceId > 0 ? $workspaceId : null);
        if ($profiles !== []) {
            $extras['vault_retrieval_profiles'] = $profiles;
        }
        $displayPrefs = $this->userDisplayPreferences($uid);
        if ($displayPrefs['locale'] !== '') {
            $extras['locale'] = $displayPrefs['locale'];
        }
        if (! empty($extras['polish']) && \is_array($extras['polish'])) {
            $extras['polish_style'] = $displayPrefs['polish_style'];
        }

        return $extras;
    }

    public function userHasWorkspaceAccess(int $userId, int $workspaceId): bool
    {
        if ($userId < 1 || $workspaceId < 1) {
            return false;
        }
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return false;
        }
        require_once __DIR__ . '/api/_workspace_membership.php';

        return \oaao_chat_user_has_workspace_access($db, $userId, $workspaceId);
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
            'getChatPipelineRegistry',
            'getPlannerAgentRegistry',
            'getOrchestratorInternalBase',
            'getOrchestratorSharedSecret',
            'postOrchestratorInternalJson',
            'getOrchestratorInternalJson',
            'startOrchestratorChatRun',
            'cancelOrchestratorChatRun',
            'resolveOrchestratorAgentAsk',
            'ensureOrchestratorFunasr',
            'orchestratorFunasrStatus',
            'inferOrchestratorApiKeyEnv',
            'embeddedVaultIdsForUserWorkspace',
            'vaultRetrievalProfilesForVaultIds',
            'vaultRetrievalProfilesForUserWorkspace',
            'buildLiveMeetingOrchestratorExtras',
            'userHasWorkspaceAccess',
        ], true);
    }

    public function __onInit(Agent $agent): bool
    {
        // Shell registries via Core Emitter — avoids growing {@code Core::__onInit listen()} maps when adding modules.
        $coreApi = $this->api('core');

        // Root-relative paths — subdirectory installs resolve via {@code data-oaao-mount-prefix} + {@see shell-registry-url.js}.
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/chat',
                'Chat',
                'Ask anything — conversations stay in your workspace',
                'message-circle-more',
                [
                    'shell_panel_url' => '/chat/workspace-panel',
                    'shell_js_module' => '/webassets/chat/default/js/chat-panel.js',
                ],
            );

            $coreApi->registerSpaPage(
                'workspace/agents',
                'Agents',
                'Orchestrator capabilities in this workspace',
                'bot',
                [
                    'shell_panel_url' => '/chat/workspace-agents-panel',
                    'shell_js_module' => '/webassets/chat/default/js/agents-panel.js',
                ],
            );

            $coreApi->registerFeatureScope(
                'conversation',
                'Conversations',
                'Chat threads can bind to a workspace (isolated env) or personal shell context; tenant-wide policy may apply.',
                ['tenant', 'workspace', 'personal'],
                20,
            );
        }

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addAPICommand([
            'getChatPipelineRegistry'              => 'getChatPipelineRegistry',
            'getPlannerAgentRegistry'              => 'getPlannerAgentRegistry',
            'getOrchestratorInternalBase'          => 'getOrchestratorInternalBase',
            'getOrchestratorSharedSecret'          => 'getOrchestratorSharedSecret',
            'postOrchestratorInternalJson'         => 'postOrchestratorInternalJson',
            'getOrchestratorInternalJson'          => 'getOrchestratorInternalJson',
            'startOrchestratorChatRun'             => 'startOrchestratorChatRun',
            'cancelOrchestratorChatRun'            => 'cancelOrchestratorChatRun',
            'resolveOrchestratorAgentAsk'          => 'resolveOrchestratorAgentAsk',
            'ensureOrchestratorFunasr'             => 'ensureOrchestratorFunasr',
            'orchestratorFunasrStatus'             => 'orchestratorFunasrStatus',
            'inferOrchestratorApiKeyEnv'           => 'inferOrchestratorApiKeyEnv',
            'embeddedVaultIdsForUserWorkspace'     => 'embeddedVaultIdsForUserWorkspace',
            'vaultRetrievalProfilesForVaultIds'      => 'vaultRetrievalProfilesForVaultIds',
            'vaultRetrievalProfilesForUserWorkspace' => 'vaultRetrievalProfilesForUserWorkspace',
            'buildLiveMeetingOrchestratorExtras'   => 'buildLiveMeetingOrchestratorExtras',
            'userHasWorkspaceAccess'               => 'userHasWorkspaceAccess',
        ]);

        // Controller-root closures need a `{className}.` filename prefix; subfolder paths (`panel/…`) skip that and avoid name clashes.
        $agent->addRoute('GET /chat/workspace-panel', 'panel/workspace_panel');
        $agent->addRoute('GET /chat/workspace-agents-panel', 'panel/workspace_agents_panel');

        // {@code 'api' => [ … ]} → {@code /chat/api/…}; handler filenames live under {@code controller/api/} without repeating {@code api/}.
        $agent->addLazyRoute([
            'api' => [
                'GET conversations'           => 'conversations',
                'GET conversation'           => 'conversation',
                'GET messages'               => 'messages',
                'GET chat_preferences'       => 'chat_preferences',
                'POST chat_preferences'      => 'chat_preferences',
                'GET turn_scores'            => 'turn_scores',
                'GET conversation_health'    => 'conversation_health',
                'GET conversation_fork_suggestions' => 'conversation_fork_suggestions',
                'GET evolution_queue_status' => 'evolution_queue_status',
                'POST turn_scores_rescore'   => 'turn_scores_rescore',
                'GET resolve_share'          => 'resolve_share',
                'POST send'                  => 'send',
                'POST cancel_run'            => 'cancel_run',
                'POST agent_ask'             => 'agent_ask',
                'POST attachment_upload'     => 'attachment_upload',
                'POST attachments_dispose'   => 'attachments_dispose',
                'POST asr_transcribe'        => 'asr_transcribe',
                'GET workspace_glossary'     => 'workspace_glossary',
                'POST workspace_glossary'    => 'workspace_glossary',
                'POST assistant_patch'       => 'assistant_patch',
                'POST assistant_internal_sync' => 'assistant_internal_sync',
                'POST turn_score_upsert'       => 'turn_score_upsert',
                'POST conversation_archive'  => 'conversation_archive',
                'POST conversation_delete'   => 'conversation_delete',
                'POST conversation_fork'     => 'conversation_fork',
                'POST conversation_mode'     => 'conversation_mode',
                'POST conversation_share'    => 'conversation_share',
                'POST message_feedback'      => 'message_feedback',
                'GET task_artifacts'        => 'task_artifacts',
                'GET message_materials'    => 'message_materials',
                'GET materials_zip'        => 'materials_zip',
                'GET material_media'       => 'material_media',
                'GET conversation_materials' => 'conversation_materials',
                'GET skills_list'            => 'skills_list',
                'GET skills_admin'           => 'skills_admin',
                'POST skills_save'           => 'skills_save',
                'POST tool_servers_save'     => 'tool_servers_save',
                'POST skills_manifest_save'  => 'skills_manifest_save',
                'GET crystallized_skills_admin' => 'crystallized_skills_admin',
                'POST crystallized_skills_admin' => 'crystallized_skills_admin',
                'POST evolution_cron_run'    => 'evolution_cron_run',
                'GET evolution_reports'      => 'evolution_reports',
                'POST evolution_reports'     => 'evolution_reports',
                'GET evolution_patches'      => 'evolution_patches',
                'POST evolution_patches'     => 'evolution_patches',
                'POST skills_discover'       => 'skills_discover',
                'GET routing_purposes'       => 'routing_purposes',
                'GET routing_profiles'       => 'routing_profiles',
                'GET orchestrator_stream'    => 'orchestrator_stream',
                'GET workspaces'             => 'workspaces',
                'POST workspace_create'      => 'workspace_create',
                'POST workspace_update'      => 'workspace_update',
                'POST workspace_delete'      => 'workspace_delete',
                'GET workspace_team'         => 'workspace_team',
                'POST workspace_member_invite' => 'workspace_member_invite',
                'POST workspace_member_remove' => 'workspace_member_remove',
                'POST workspace_invitation_revoke' => 'workspace_invitation_revoke',
                'POST workspace_invite_accept' => 'workspace_invite_accept',
                'GET chat_endpoints_list'    => 'chat_endpoints_list',
                'POST chat_endpoints_save'   => 'chat_endpoints_save',
                'POST chat_endpoints_delete' => 'chat_endpoints_delete',
            ],
        ]);

        return true;
    }

    public function __onReady(): void
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $generalJs = '/webassets/chat/default/js/oaao-chat-admin-general-panel.js';
            $coreApi->registerSettingsSection(
                'settings-chat-general',
                'Chat',
                'General',
                'Tenant-wide thread page size (3–10) and LLM context cap — administrator only.',
                'message-circle-more',
                [
                    'sort'            => 27,
                    'panel_js_module' => $generalJs,
                    'label_key'       => 'settings.nav.chat_general.label',
                    'title_key'       => 'settings.nav.chat_general.title',
                    'sub_key'         => 'settings.nav.chat_general.sub',
                ],
            );

            $plannerJs = '/webassets/chat/default/js/oaao-chat-planner-settings-panel.js';
            $coreApi->registerSettingsSection(
                'settings-chat-planner',
                'Task planner',
                'Run task planner',
                'LLM checklist vs fixed pipeline — stored on your planning purpose (<code class="font-mono text-xs">planning.*</code>).',
                'list-checks',
                [
                    'sort'            => 28,
                    'panel_js_module' => $plannerJs,
                    'label_key'       => 'settings.nav.planner.label',
                    'title_key'       => 'settings.nav.planner.title',
                    'sub_key'         => 'settings.nav.planner.sub',
                ],
            );

            $skillsAdminJs = '/webassets/core/default/js/oaao-skills-admin-settings-panel.js';
            $coreApi->registerSettingsSection(
                'settings-skills-admin',
                'Skills & tools',
                'Skills and tool servers',
                'Micro-skill providers, OpenAPI tool servers, and evolution cron controls — administrator only.',
                'puzzle',
                [
                    'sort'            => 30,
                    'panel_js_module' => $skillsAdminJs,
                    'label_key'       => 'settings.nav.skills_admin.label',
                    'title_key'       => 'settings.nav.skills_admin.title',
                    'sub_key'         => 'settings.nav.skills_admin.sub',
                ],
            );
        }
    }
};
