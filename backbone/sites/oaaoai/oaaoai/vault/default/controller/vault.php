<?php

namespace Module\oaao\vault;

require_once __DIR__ . '/api/_vault_hook_jobs.php';
require_once __DIR__ . '/../library/VaultControllerSupportTrait.php';

use oaaoai\vault\VaultControllerSupportTrait;
use oaaoai\vault\VaultDocumentHookRegister;
use oaaoai\vault\VaultGlossary;
use oaaoai\vault\VaultRetrievalProfiles;
use Razy\Agent;
use Razy\Controller;
use Razy\Database;

/**
 * Vault workspace surface — tree document shell ({@code Workspace|Personal → Vault → Container → documents}).
 *
 * **Ingest hooks** ({@code vault_document_hook.register}) for files are owned by {@code oaaoai/rag} ({@code vh.rag.*}) — embedding / ASR queue jobs on {@code oaao_vault_job}; completion updates {@code oaao_vault_document.embed_status} via {@see vault_job_finish.php}.
 *
 * This module registers purpose-allocation slots for vault ingest ({@code pa-embedding}, {@code pa-asr-summary}) and document-action hooks; rerank / vault-summary slots live under {@code oaaoai/rag}.
 *
 * PostgreSQL-backed persistence live here ({@code vault_tree}, {@code document_upload}); ingest jobs enqueue {@code oaao_vault_job} for the Python sidecar (claim/finish via shared secret header).
 *
 * {@code oaao_vault.is_enabled}: when {@code 0}, uploads are stored but ingest hooks are **not** auto-queued (documents start as {@code embed_status held}); users may queue manually ({@code document_enqueue}) or rely on chat flows that explicitly target this vault as a source.
 */
return new class extends Controller {
    use VaultControllerSupportTrait;

    /**
     * @return list<array<string, mixed>>
     */
    public function getVaultDocumentHookRegistry(): array
    {
        $this->api('endpoints')?->ensureFeatureRegistries();

        return VaultDocumentHookRegister::allSorted();
    }

    /**
     * @return array{terms: list<array<string, mixed>>}
     */
    public function getWorkspaceGlossary(int $workspaceId): array
    {
        if ($workspaceId < 1) {
            return ['terms' => []];
        }
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
            return ['terms' => []];
        }
        return \oaaoai\vault\VaultGlossary::loadWorkspaceGlossary($db->getDBAdapter(), $workspaceId);
    }

    /**
     * @param array{terms: list<array<string, mixed>>} $glossary
     */
    public function saveWorkspaceGlossary(int $workspaceId, array $glossary): bool
    {
        if ($workspaceId < 1) {
            return false;
        }
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        $pdo = $db?->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return false;
        }
        $encoded = \oaaoai\vault\VaultGlossary::encode(
            \oaaoai\vault\VaultGlossary::parseJson(json_encode($glossary, JSON_THROW_ON_ERROR)),
        );
        $st = $pdo->prepare('UPDATE oaao_workspace SET glossary_json = ?, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?');
        $st->execute([$encoded, $workspaceId]);

        return true;
    }

    /**
     * @param list<int> $vaultIds
     *
     * @return list<array<string, mixed>>
     */
    public function buildRetrievalProfilesFromVaultIds(array $vaultIds): array
    {
        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof \Razy\Database) {
            return [];
        }
        $auth->ensurePgCoreTables($db);
        if (! \oaao_auth_database_is_pgsql($db)) {
            return [];
        }
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $core = $this->oaao_vault_core_api();
            if ($core) {
                $core->bootstrapTenantContext($pdo);
            }
            $this->oaao_vault_prime_qdrant_tenant_slug($pdo);
        } else {
            $this->oaao_vault_prime_qdrant_tenant_slug();
        }
        $chat = $this->api('chat');
        $infer = $chat
            ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
            : static fn (string $ref): ?string => null;

        return \oaaoai\vault\VaultRetrievalProfiles::fromVaultIds($db, $vaultIds, $infer);
    }

    /**
     * Intersect requested vault ids with vaults the user may access (personal + member workspaces).
     *
     * @param list<int> $vaultIds
     *
     * @return list<int>
     */
    public function intersectAccessibleVaultIds(int $uid, array $vaultIds): array
    {
        if ($uid < 1 || $vaultIds === []) {
            return [];
        }

        /** @var list<int> $requested */
        $requested = [];
        foreach ($vaultIds as $vid) {
            $n = \is_int($vid) ? $vid : (int) $vid;
            if ($n > 0) {
                $requested[] = $n;
            }
        }
        $requested = array_values(array_unique($requested, SORT_NUMERIC));
        if ($requested === []) {
            return [];
        }

        $auth = $this->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return [];
        }

        $auth->ensurePgCoreTables($db);
        if (! \oaao_auth_database_is_pgsql($db)) {
            return [];
        }

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $core = $this->oaao_vault_core_api();
            if ($core) {
                $core->bootstrapTenantContext($pdo);
            }
            $this->oaao_vault_prime_qdrant_tenant_slug($pdo);
        } else {
            $this->oaao_vault_prime_qdrant_tenant_slug();
        }

        $payload = $this->oaao_vault_build_all_accessible_payload($db, $uid, ['lite_documents' => true]);
        /** @var array<int, true> $allowed */
        $allowed = [];
        foreach ($payload['vaults'] as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $vid = (int) ($row['id'] ?? 0);
            if ($vid > 0) {
                $allowed[$vid] = true;
            }
        }

        /** @var list<int> $out */
        $out = [];
        foreach ($requested as $vid) {
            if (isset($allowed[$vid])) {
                $out[] = $vid;
            }
        }

        return $out;
    }

    public function __onInit(Agent $agent): bool
    {
        $agent->addAPICommand([
            'getVaultDocumentHookRegistry'     => 'getVaultDocumentHookRegistry',
            'getWorkspaceGlossary'             => 'getWorkspaceGlossary',
            'saveWorkspaceGlossary'            => 'saveWorkspaceGlossary',
            'buildRetrievalProfilesFromVaultIds' => 'buildRetrievalProfilesFromVaultIds',
            'intersectAccessibleVaultIds'      => 'intersectAccessibleVaultIds',
        ]);

        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/vault',
                'Vault',
                'Containers and documents — workspace or personal',
                'folder-archive',
                [
                    'shell_panel_url' => '/vault/workspace-panel',
                    'shell_js_module' => '/webassets/vault/default/js/vault-panel.js',
                ],
            );

            $coreApi->registerFeatureScope(
                'vault',
                'Vault',
                'Knowledge vaults and tree documents bind to workspace isolation or personal shell context.',
                ['tenant', 'workspace', 'personal'],
                30,
            );
        }

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addRoute('GET /vault/workspace-panel', 'panel/workspace_vault_panel');

        $agent->addLazyRoute([
            'api' => [
                'GET vault_hooks'       => 'vault_hooks',
                'GET vault_tree'      => 'vault_tree',
                'GET document_status' => 'document_status',
                'GET document_transcript' => 'document_transcript',
                'GET transcript_summary_templates' => 'transcript_summary_templates',
                'POST document_transcript_summary' => 'document_transcript_summary',
                'POST document_transcript_speakers' => 'document_transcript_speakers',
                'GET speaker_profiles' => 'speaker_profiles',
                'POST vault_speaker_match' => 'vault_speaker_match',
                'GET document_media' => 'document_media',
                'GET document_text' => 'document_text',
                'POST vault_container_create' => 'vault_container_create',
                'POST vault_auto_rag_set' => 'vault_auto_rag_set',
                'POST vault_graph_mode_set' => 'vault_graph_mode_set',
                'POST vault_create'    => 'vault_create',
                'POST document_upload'      => 'document_upload',
                'POST document_upload_text' => 'document_upload_text',
                'POST document_enqueue' => 'document_enqueue',
                'POST ingest_stream_token' => 'ingest_stream_token',
                'GET vault_status' => 'vault_status',
                'POST document_delete' => 'document_delete',
                'GET document_embed_chunks' => 'document_embed_chunks',
                'POST document_rename' => 'document_rename',
                'POST document_move' => 'document_move',
                'POST vault_delete' => 'vault_delete',
                'GET glossary' => 'glossary',
                'POST glossary' => 'glossary',
                'POST glossary_import' => 'glossary_import',
                'POST vault_container_delete' => 'vault_container_delete',
                'POST vault_container_rename' => 'vault_container_rename',
                'POST vault_container_move' => 'vault_container_move',
                'POST vault_job_claim' => 'vault_job_claim',
                'POST vault_job_finish' => 'vault_job_finish',
                'POST vault_job_reclaim_orphans' => 'vault_job_reclaim_orphans',
                'POST usage_record' => 'usage_record',
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
            'getVaultDocumentHookRegistry',
            'getWorkspaceGlossary',
            'saveWorkspaceGlossary',
            'buildRetrievalProfilesFromVaultIds',
            'intersectAccessibleVaultIds',
        ], true);
    }
};
