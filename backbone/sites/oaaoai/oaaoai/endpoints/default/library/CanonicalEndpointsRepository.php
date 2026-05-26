<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use Oaaoai\Core\TenantContext;
use Razy\Database;

/**
 * Canonical LLM endpoint + purpose rows via {@see Database} fluent statements (prefix {@code oaao_} applied by driver).
 *
 * Loaded by Razy module library autoload: {@code oaaoai/endpoints/CanonicalEndpointsRepository}.
 */
final class CanonicalEndpointsRepository
{
    public function __construct(
        private readonly Database $db,
        private readonly ?object $coreApi = null,
    ) {
    }

    private function isPgsql(): bool
    {
        $pdo = $this->db->getDBAdapter();

        return $pdo instanceof \PDO && $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql';
    }

    private function scopedTenantId(): int
    {
        if (! $this->isPgsql()) {
            return 0;
        }

        $pdo = $this->db->getDBAdapter();
        if ($pdo instanceof \PDO && $this->coreApi && method_exists($this->coreApi, 'bootstrapTenantContext')) {
            return $this->coreApi->bootstrapTenantContext($pdo);
        }
        if ($pdo instanceof \PDO) {
            require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';
            TenantContext::bootstrap($pdo);
        }

        return TenantContext::id();
    }

    /**
     * @param array<string, mixed> $params
     *
     * @return array{where: string, params: array<string, mixed>}
     */
    private function tenantWhere(string $baseWhere, array $params = []): array
    {
        $tid = $this->scopedTenantId();
        if ($tid > 0) {
            return [
                'where'  => $baseWhere . ',tenant_id=:oaao_tid',
                'params' => array_merge($params, ['oaao_tid' => $tid]),
            ];
        }

        return ['where' => $baseWhere, 'params' => $params];
    }

    /**
     * Purpose rows for the active scope: platform rows ({@code tenant_id IS NULL}) plus tenant overrides.
     *
     * @param list<string> $columns empty = all columns
     *
     * @return list<array<string, mixed>>
     */
    private function listPurposeRowsForScope(array $columns = []): array
    {
        $select = $columns === [] ? '*' : implode(',', $columns);
        $tid = $this->scopedTenantId();

        if ($tid <= 0) {
            $raw = $this->db->prepare()
                ->select($select)
                ->from('purpose')
                ->where('tenant_id=NULL')
                ->order('<sort_order,<purpose_key')
                ->query()
                ->fetchAll();

            return \is_array($raw) ? $raw : [];
        }

        $tenantRaw = $this->db->prepare()
            ->select($select)
            ->from('purpose')
            ->where('tenant_id=:oaao_tid')
            ->assign(['oaao_tid' => $tid])
            ->order('<sort_order,<purpose_key')
            ->query()
            ->fetchAll();
        $globalRaw = $this->db->prepare()
            ->select($select)
            ->from('purpose')
            ->where('tenant_id=NULL')
            ->order('<sort_order,<purpose_key')
            ->query()
            ->fetchAll();

        return $this->mergeTenantPurposeRows(
            \is_array($globalRaw) ? $globalRaw : [],
            \is_array($tenantRaw) ? $tenantRaw : [],
        );
    }

    /**
     * @param list<array<string, mixed>> $global platform defaults ({@code tenant_id IS NULL})
     * @param list<array<string, mixed>> $tenant tenant-specific rows (override by {@code purpose_key})
     *
     * @return list<array<string, mixed>>
     */
    private function mergeTenantPurposeRows(array $global, array $tenant): array
    {
        /** @var array<string, array<string, mixed>> $byKey */
        $byKey = [];
        foreach ($global as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $pk = trim((string) ($row['purpose_key'] ?? ''));
            if ($pk !== '') {
                $byKey[$pk] = $row;
            }
        }
        foreach ($tenant as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $pk = trim((string) ($row['purpose_key'] ?? ''));
            if ($pk !== '') {
                $byKey[$pk] = $row;
            }
        }

        $merged = array_values($byKey);
        usort(
            $merged,
            static function (array $a, array $b): int {
                $so = ((int) ($a['sort_order'] ?? 500)) <=> ((int) ($b['sort_order'] ?? 500));
                if ($so !== 0) {
                    return $so;
                }

                return strcmp((string) ($a['purpose_key'] ?? ''), (string) ($b['purpose_key'] ?? ''));
            },
        );

        return $merged;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listEndpoints(): array
    {
        $q = $this->db->prepare()
            ->select('*')
            ->from('endpoint');
        $tid = $this->scopedTenantId();
        if ($tid > 0) {
            $q = $q->where('tenant_id=:oaao_tid')->assign(['oaao_tid' => $tid]);
        }

        return $q->order('+id')->query()->fetchAll();
    }

    public function endpointRowExists(int $id): bool
    {
        if ($id < 1) {
            return false;
        }

        $scoped = $this->tenantWhere('id=?', ['id' => $id]);
        $row = $this->db->prepare()
            ->select('id')
            ->from('endpoint')
            ->where($scoped['where'])
            ->assign($scoped['params'])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) && isset($row['id']);
    }

    /**
     * @param array<string, mixed> $fields keys: name, endpoint_type, base_url, model, api_key_ref, is_enabled, config_json, created_at, updated_at
     */
    public function insertEndpoint(array $fields): int
    {
        $cols = ['name', 'endpoint_type', 'base_url', 'model', 'api_key_ref', 'is_enabled', 'config_json', 'created_at', 'updated_at'];
        $tid = $this->scopedTenantId();
        if ($tid > 0 && $this->isPgsql()) {
            $cols[] = 'tenant_id';
            $fields['tenant_id'] = $tid;
        }
        $this->db->insert('endpoint', $cols)->assign($fields)->query();

        return $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields same keys as insert plus {@code id} for WHERE
     */
    public function updateEndpoint(array $fields): void
    {
        $scoped = $this->tenantWhere('id=?', ['id' => $fields['id'] ?? 0]);
        $this->db->update('endpoint', ['name', 'endpoint_type', 'base_url', 'model', 'api_key_ref', 'is_enabled', 'config_json', 'updated_at'])
            ->where($scoped['where'])
            ->assign(array_merge($fields, $scoped['params']))
            ->query();
    }

    public function deleteEndpointById(int $id): int
    {
        $tid = $this->scopedTenantId();
        if ($tid > 0 && $this->isPgsql()) {
            return $this->db->delete('endpoint', ['id' => $id, 'tenant_id' => $tid])->query()->affected();
        }

        return $this->db->delete('endpoint', ['id' => $id])->query()->affected();
    }

    /**
     * @return array<string, mixed>|null full {@code oaao_endpoint} row
     */
    public function getEndpointById(int $id): ?array
    {
        if ($id < 1) {
            return null;
        }

        $scoped = $this->tenantWhere('id=?', ['id' => $id]);
        $row = $this->db->prepare()
            ->select('*')
            ->from('endpoint')
            ->where($scoped['where'])
            ->assign($scoped['params'])
            ->limit(1)
            ->query()
            ->fetch();

        if (\is_array($row)) {
            return $row;
        }

        $tid = $this->scopedTenantId();
        if ($tid > 0) {
            $global = $this->db->prepare()
                ->select('*')
                ->from('endpoint')
                ->where('id=?,tenant_id=NULL')
                ->assign(['id' => $id])
                ->limit(1)
                ->query()
                ->fetch();

            return \is_array($global) ? $global : null;
        }

        return null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listPurposesWithDefaultEndpointName(): array
    {
        /** @var list<array<string, mixed>> $purposes */
        $purposes = $this->listPurposeRowsForScope();

        if ($purposes === []) {
            return [];
        }

        /** @var array<int, true> */
        $endpointIds = [];
        foreach ($purposes as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $deid = $row['default_endpoint_id'] ?? null;
            if ($deid === null || $deid === '') {
                continue;
            }
            $id = (int) $deid;
            if ($id > 0) {
                $endpointIds[$id] = true;
            }
        }

        /** @var array<int, string> */
        $nameByEndpointId = [];
        foreach (array_keys($endpointIds) as $eid) {
            $ep = $this->getEndpointById($eid);
            if (\is_array($ep) && isset($ep['name'])) {
                $nameByEndpointId[$eid] = (string) $ep['name'];
            }
        }

        $out = [];
        foreach ($purposes as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $deid = isset($row['default_endpoint_id']) ? (int) $row['default_endpoint_id'] : 0;
            $row['default_endpoint_name'] = ($deid > 0 && isset($nameByEndpointId[$deid])) ? $nameByEndpointId[$deid] : null;
            $out[] = $row;
        }

        return $out;
    }

    /**
     * Resolve {@code oaao_endpoint} for vault ingest / GraphRAG document embedding from {@code oaao_purpose} rows in the
     * {@code embedding} allocation slot ({@code embedding} or {@code embedding.*}).
     *
     * Prefers {@code embedding.primary}, then {@code embedding}, otherwise the first matching row (ordered by
     * {@code sort_order}, {@code purpose_key} — same ordering as Settings lists).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveVaultIngestEmbeddingBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('embedding', 'embedding.primary', 'embedding');
    }

    /**
     * Resolve rerank endpoint for vault RAG ({@code rerank.*} purpose keys).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveVaultRerankBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('rerank', 'rerank.primary', 'rerank');
    }

    /**
     * Resolve chat LLM for vault GraphRAG index jobs ({@code graph.*} purpose keys).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveVaultGraphBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('graph', 'graph.primary', 'graph');
    }

    /**
     * Resolve ASR endpoint for vault audio jobs and chat voice input ({@code asr.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveAsrBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('asr', 'asr.primary', 'asr');
    }

    /**
     * Resolve ASR-Live endpoint for Composer mic + Live Meeting ({@code asr.live.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveLiveAsrBinding(): ?array
    {
        require_once __DIR__ . '/AsrLivePurposeConfig.php';

        $bind = $this->resolveVaultPurposeBinding('asr.live', 'asr.live.primary', 'asr.live');
        if ($bind !== null) {
            return $bind;
        }

        return null;
    }

    /**
     * Settings panel row for ASR-Live pipeline meta ({@code purpose_key=asr.live}).
     *
     * @return array<string, mixed>|null
     */
    public function findAsrLivePurposeRowForSettings(): ?array
    {
        $row = $this->findPurposeRowByPrefix('asr.live', 'asr.live.primary', 'asr.live');
        if ($row !== null) {
            return $row;
        }
        $this->ensureAsrLivePurposeRow();

        return $this->findPurposeRowByPrefix('asr.live', 'asr.live.primary', 'asr.live');
    }

    /**
     * Bootstrap {@code asr.live} purpose when slot exists but no row saved yet.
     */
    public function ensureAsrLivePurposeRow(): void
    {
        if ($this->findPurposeRowByPrefix('asr.live', 'asr.live.primary', 'asr.live') !== null) {
            return;
        }

        require_once __DIR__ . '/AsrLivePurposeConfig.php';

        $endpointId = null;
        $asr = $this->resolveAsrBinding();
        if (\is_array($asr)) {
            $asrRow = $this->findPurposeRowByPrefix('asr', 'asr.primary', 'asr');
            if (\is_array($asrRow)) {
                $eid = (int) ($asrRow['default_endpoint_id'] ?? 0);
                if ($eid > 0 && $this->endpointRowExists($eid)) {
                    $endpointId = $eid;
                }
            }
        }
        if ($endpointId === null) {
            $endpointId = $this->resolveDefaultEndpointIdForPlanningBootstrap();
        }

        try {
            $metaJson = json_encode(AsrLivePurposeConfig::defaultLiveMeta(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $metaJson = null;
        }

        $now = gmdate('Y-m-d H:i:s');
        $this->insertPurpose([
            'purpose_key'         => 'asr.live',
            'label'               => 'ASR-Live',
            'description'         => 'Live streaming + composer voice (FunASR Nano)',
            'default_endpoint_id' => $endpointId,
            'is_enabled'          => 1,
            'sort_order'          => 510,
            'meta_json'           => $metaJson,
            'created_at'          => $now,
            'updated_at'          => $now,
        ]);
    }

    /**
     * Resolve transcript polishing LLM ({@code polish.*}) after ASR.
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolvePolishBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('polish', 'polish.primary', 'polish');
    }

    /**
     * Resolve post-stream quality scoring LLM ({@code uiqe.*} — IQS / ACCS workers).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveUiqeBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('uiqe', 'uiqe.primary', 'uiqe');
    }

    /**
     * Resolve chat run task planner LLM ({@code planning.*} — Settings → Task planner).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolvePlanningBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('planning', 'planning.primary', 'planning');
    }

    /**
     * Resolve vault-grounded summarisation LLM ({@code vault.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveVaultSummaryBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('vault', 'vault.primary', 'vault');
    }

    /**
     * Resolve transcript summarisation LLM for View Transcript ({@code asr_summary.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null
     */
    public function resolveAsrSummaryBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('asr_summary', 'asr_summary.primary', 'asr_summary');
    }

    /**
     * Primary chat LLM for auxiliary tasks (e.g. research summary).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveChatBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('chat', 'chat.primary', 'chat');
    }

    /**
     * Article Research — source discover / page classify ({@code research.discover.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveResearchDiscoverBinding(): ?array
    {
        return $this->resolvePurposeBindingWithChatFallback(
            'research.discover',
            'research.discover.primary',
            'research.discover',
        );
    }

    /**
     * Article Research — per-article summarisation ({@code research.summary.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveResearchSummaryBinding(): ?array
    {
        return $this->resolvePurposeBindingWithChatFallback(
            'research.summary',
            'research.summary.primary',
            'research.summary',
        );
    }

    /**
     * Article Research — match prompt normalize + hit scoring ({@code research.match.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveResearchMatchBinding(): ?array
    {
        return $this->resolvePurposeBindingWithChatFallback(
            'research.match',
            'research.match.primary',
            'research.match',
        );
    }

    /**
     * Data Mining — schema/row JSON extract ({@code mine.*}).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveMineBinding(): ?array
    {
        return $this->resolvePurposeBindingWithChatFallback('mine', 'mine.primary', 'mine');
    }

    /**
     * Slide template import analyze / preview / fix LLM ({@code slide_template.*} purpose keys).
     *
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    public function resolveSlideTemplateAnalyzeBinding(): ?array
    {
        return $this->resolveVaultPurposeBinding('slide_template', 'slide_template.primary', 'slide_template');
    }

    /**
     * Chat vault retrieval tuning from {@code embedding.*} {@code meta_json.vault_rag} (Settings → RAG).
     * Falls back to legacy {@code rag.*} row if present, then defaults.
     *
     * @return array{qdrant_limit: int, min_score: float, graph_limit: int, transcript_summary_boost: float, asr_transcript_boost: float}
     */
    public function resolveRagRetrievalConfig(): array
    {
        foreach (
            [
                $this->findPurposeRowByPrefix('embedding', 'embedding.primary', 'embedding'),
                $this->findPurposeRowByPrefix('rag', 'rag.primary', 'rag'),
            ] as $row
        ) {
            if ($row === null) {
                continue;
            }
            $cfg = RagPurposeConfig::chatPayloadFromMeta(
                RagPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null),
            );
            $meta = RagPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null);
            $nested = \is_array($meta['vault_rag'] ?? null) ? $meta['vault_rag'] : $meta;
            $hasExplicit = isset($nested['qdrant_limit'])
                || isset($nested['min_score'])
                || isset($nested['graph_limit'])
                || isset($nested['transcript_summary_boost'])
                || isset($nested['asr_transcript_boost'])
                || isset($nested['vault_rag_qdrant_limit'])
                || isset($nested['vault_rag_min_score'])
                || isset($nested['vault_rag_graph_limit']);
            if ($hasExplicit) {
                return $cfg;
            }
        }

        return RagPurposeConfig::defaultsForChat();
    }

    /**
     * Chat run task planner mode from {@code planning.*} {@code meta_json.run_planner} (Settings → Task planner).
     * Falls back to {@code OAAO_RUN_PLANNER_MODE} env when unset.
     */
    public function resolveRunPlannerMode(): string
    {
        $row = $this->findPurposeRowByPrefix('planning', 'planning.primary', 'planning');
        if ($row === null) {
            return ChatRunPlannerPurposeConfig::defaultMode();
        }
        $meta = ChatRunPlannerPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null);
        $explicit = ChatRunPlannerPurposeConfig::modeFromMeta($meta);
        if ($explicit !== null) {
            return $explicit;
        }

        return ChatRunPlannerPurposeConfig::defaultMode();
    }

    /**
     * {@code planning.*} purpose row for Settings → Task planner.
     *
     * @return array<string, mixed>|null
     */
    public function findPlanningPurposeRowForSettings(): ?array
    {
        $row = $this->findPurposeRowByPrefix('planning', 'planning.primary', 'planning');
        if ($row !== null) {
            return $row;
        }
        $this->ensurePlanningPurposeRow();

        return $this->findPurposeRowByPrefix('planning', 'planning.primary', 'planning');
    }

    /**
     * Create {@code planning.primary} when the Planning slot exists but no purpose row was saved yet.
     */
    public function ensurePlanningPurposeRow(): void
    {
        if ($this->findPurposeRowByPrefix('planning', 'planning.primary', 'planning') !== null) {
            return;
        }

        $endpointId = $this->resolveDefaultEndpointIdForPlanningBootstrap();
        $enabledMap = [];
        foreach (ChatAllowedAgentsPurposeConfig::allKinds() as $kind) {
            $enabledMap[$kind] = true;
        }
        $meta = ChatRunPlannerPurposeConfig::mergeModeIntoMeta(
            [],
            ChatRunPlannerPurposeConfig::defaultMode(),
        );
        $meta = ChatAllowedAgentsPurposeConfig::mergeAllowedIntoMeta($meta, $enabledMap);

        try {
            $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $metaJson = null;
        }

        $now = gmdate('Y-m-d H:i:s');
        $this->insertPurpose([
            'purpose_key'         => 'planning.primary',
            'label'               => 'Planning',
            'description'         => 'Chat run task planner (auto-created)',
            'default_endpoint_id' => $endpointId,
            'is_enabled'          => 1,
            'sort_order'          => 50,
            'meta_json'           => $metaJson,
            'created_at'          => $now,
            'updated_at'          => $now,
        ]);
    }

    private function resolveDefaultEndpointIdForPlanningBootstrap(): ?int
    {
        $chat = $this->findPurposeRowByPrefix('chat', 'chat.primary', 'chat');
        if (\is_array($chat)) {
            $eid = (int) ($chat['default_endpoint_id'] ?? 0);
            if ($eid > 0 && $this->endpointRowExists($eid)) {
                return $eid;
            }
        }

        foreach ($this->listEndpoints() as $ep) {
            if (! \is_array($ep)) {
                continue;
            }
            if ((int) ($ep['is_enabled'] ?? 1) !== 1) {
                continue;
            }
            $id = (int) ($ep['id'] ?? 0);
            if ($id > 0) {
                return $id;
            }
        }

        return null;
    }

    /**
     * Agent kinds permitted for chat run planner + registry ({@code planning.*} meta, Settings → Task planner).
     *
     * @return list<string>
     */
    public function resolveAllowedAgents(): array
    {
        $row = $this->findPlanningPurposeRowForSettings();
        if ($row === null) {
            return ChatAllowedAgentsPurposeConfig::defaultAllowed();
        }
        $meta = ChatRunPlannerPurposeConfig::decodePurposeMeta($row['meta_json'] ?? null);

        return ChatAllowedAgentsPurposeConfig::allowedFromMeta($meta);
    }

    /**
     * {@code embedding.*} purpose row for Settings → RAG (requires configured embedding endpoint).
     *
     * @return array<string, mixed>|null
     */
    public function findEmbeddingPurposeRowForSettings(): ?array
    {
        return $this->findPurposeRowByPrefix('embedding', 'embedding.primary', 'embedding');
    }

    /**
     * Purpose row by prefix (endpoint optional).
     *
     * @return array<string, mixed>|null
     */
    public function findPurposeRowByPrefix(string $prefix, string $primaryKey, string $exactKey): ?array
    {
        $raw = $this->listPurposeRowsForScope([
            'id',
            'purpose_key',
            'label',
            'description',
            'default_endpoint_id',
            'is_enabled',
            'sort_order',
            'meta_json',
        ]);

        /** @var list<array<string, mixed>> $candidates */
        $candidates = [];
        foreach ($raw as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $pk = trim((string) ($row['purpose_key'] ?? ''));
            if ($pk === '') {
                continue;
            }
            if ($pk !== $exactKey && ! str_starts_with($pk, $prefix . '.')) {
                continue;
            }
            $candidates[] = $row;
        }
        if ($candidates === []) {
            return null;
        }

        foreach ($candidates as $c) {
            if (($c['purpose_key'] ?? '') === $primaryKey) {
                return $c;
            }
        }
        foreach ($candidates as $c) {
            if (($c['purpose_key'] ?? '') === $exactKey) {
                return $c;
            }
        }

        return $candidates[0];
    }

    /**
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    private function resolvePurposeBindingWithChatFallback(string $prefix, string $primaryKey, string $exactKey): ?array
    {
        $bind = $this->resolveVaultPurposeBinding($prefix, $primaryKey, $exactKey);
        if ($bind !== null) {
            return $bind;
        }

        return $this->resolveChatBinding();
    }

    /**
     * @return array{purpose_key: string, base_url: string, model: string, api_key_ref: string, purpose_meta: array<string, mixed>}|null
     */
    private function resolveVaultPurposeBinding(string $prefix, string $primaryKey, string $exactKey): ?array
    {
        $purposes = $this->listPurposeRowsForScope([
            'purpose_key',
            'default_endpoint_id',
            'is_enabled',
            'meta_json',
            'sort_order',
        ]);

        /** @var list<array{purpose_key: string, endpoint_id: int, meta_json: mixed}> $candidates */
        $candidates = [];
        foreach ($purposes as $row) {
            if (! \is_array($row)) {
                continue;
            }
            if ((int) ($row['is_enabled'] ?? 1) !== 1) {
                continue;
            }
            $pk = trim((string) ($row['purpose_key'] ?? ''));
            if ($pk === '') {
                continue;
            }
            if ($pk !== $exactKey && ! str_starts_with($pk, $prefix . '.')) {
                continue;
            }
            $eid = (int) ($row['default_endpoint_id'] ?? 0);
            if ($eid < 1) {
                continue;
            }
            $candidates[] = [
                'purpose_key'  => $pk,
                'endpoint_id'  => $eid,
                'meta_json'    => $row['meta_json'] ?? null,
            ];
        }

        if ($candidates === []) {
            return null;
        }

        $picked = null;
        foreach ($candidates as $c) {
            if ($c['purpose_key'] === $primaryKey) {
                $picked = $c;

                break;
            }
        }
        if ($picked === null) {
            foreach ($candidates as $c) {
                if ($c['purpose_key'] === $exactKey) {
                    $picked = $c;

                    break;
                }
            }
        }
        if ($picked === null) {
            $picked = $candidates[0];
        }

        $endpoint = $this->getEndpointById($picked['endpoint_id']);
        if ($endpoint === null || (int) ($endpoint['is_enabled'] ?? 1) !== 1) {
            return null;
        }

        $bu = trim((string) ($endpoint['base_url'] ?? ''));
        $model = trim((string) ($endpoint['model'] ?? ''));
        $ref = isset($endpoint['api_key_ref']) ? trim((string) $endpoint['api_key_ref']) : '';
        if ($bu === '' || $model === '') {
            return null;
        }

        return [
            'purpose_key'  => $picked['purpose_key'],
            'base_url'     => $bu,
            'model'        => $model,
            'api_key_ref'  => $ref,
            'purpose_meta' => AsrPurposeConfig::decodePurposeMeta($picked['meta_json'] ?? null),
        ];
    }

    public function purposeRowExists(int $id): bool
    {
        if ($id < 1) {
            return false;
        }

        $scoped = $this->tenantWhere('id=?', ['id' => $id]);
        $row = $this->db->prepare()
            ->select('id')
            ->from('purpose')
            ->where($scoped['where'])
            ->assign($scoped['params'])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) && isset($row['id']);
    }

    /**
     * @param array<string, mixed> $fields purpose_key, label, description, default_endpoint_id, is_enabled, sort_order, meta_json, created_at, updated_at
     */
    public function insertPurpose(array $fields): int
    {
        $cols = ['purpose_key', 'label', 'description', 'default_endpoint_id', 'is_enabled', 'sort_order', 'meta_json', 'created_at', 'updated_at'];
        $tid = $this->scopedTenantId();
        if ($tid > 0 && $this->isPgsql()) {
            $cols[] = 'tenant_id';
            $fields['tenant_id'] = $tid;
        }
        $this->db->insert('purpose', $cols)->assign($fields)->query();

        return $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields columns + {@code id}
     */
    public function updatePurpose(array $fields): void
    {
        $scoped = $this->tenantWhere('id=?', ['id' => $fields['id'] ?? 0]);
        $this->db->update('purpose', ['purpose_key', 'label', 'description', 'default_endpoint_id', 'is_enabled', 'sort_order', 'meta_json', 'updated_at'])
            ->where($scoped['where'])
            ->assign(array_merge($fields, $scoped['params']))
            ->query();
    }

    public function deletePurposeById(int $id): int
    {
        $tid = $this->scopedTenantId();
        if ($tid > 0 && $this->isPgsql()) {
            return $this->db->delete('purpose', ['id' => $id, 'tenant_id' => $tid])->query()->affected();
        }

        return $this->db->delete('purpose', ['id' => $id])->query()->affected();
    }
}
