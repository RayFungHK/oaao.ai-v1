<?php

namespace Module\oaao\vault;

use oaaoai\chat\ChatOrchestratorBootstrap;
use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\vault\VaultGlossary;
use oaaoai\vault\VaultArangoResolver;
use oaaoai\vault\VaultDocumentHookRegister;
use oaaoai\vault\VaultQdrantCollectionResolver;
use oaaoai\vault\VaultQdrantPoints;
use oaaoai\vault\VaultTranscriptSummaryLanguages;
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
    protected function oaao_vault_core_api(): mixed
    {
        return $this->api('core');
    }

    protected function oaao_vault_tenant_id(): int
    {
        $core = $this->oaao_vault_core_api();

        return $core ? (int) $core->tenantContextId() : 0;
    }

    protected function oaao_vault_tenant_slug(): string
    {
        $core = $this->oaao_vault_core_api();

        return $core ? (string) $core->tenantContextSlug() : '';
    }

    /**
     * @param array<string, mixed>|null $data
     */
    private function oaao_vault_panel_json_exit(int $httpStatus, bool $success, string $message = '', ?array $data = null): never
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
     * @return array{mixed|null, object|null}
     */
    protected function oaao_vault_require_authenticated_only(): array
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return [null, null];
        }

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
     * @param array<string, mixed>|null $body
     */
    protected function oaao_vault_resolve_workspace_id(?array $body = null): ?int
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

    protected function oaao_vault_gate_workspace_scope(int $uid, ?int $wid): bool
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

        
        if (! \oaao_auth_database_is_pgsql($db)) {
            http_response_code(503);
            echo json_encode([
                'success' => false,
                'message' => 'Team workspaces require PostgreSQL as the canonical database.',
            ]);

            return false;
        }

        $core = $this->oaao_vault_core_api();
        if (! $core || ! $core->userHasWorkspaceAccess($db, $uid, $wid)) {
            http_response_code(403);
            echo json_encode([
                'success' => false,
                'message' => 'You do not have access to this workspace.',
            ]);

            return false;
        }

        return true;
    }

    protected function oaao_vault_backbone_root(): string
    {
        return dirname(__DIR__, 6);
    }

    protected function oaao_vault_storage_root(): string
    {
        $env = getenv('OAAO_VAULT_STORAGE');
        if ($env !== false && trim((string) $env) !== '') {
            return rtrim(trim((string) $env), '/');
        }

        return $this->oaao_vault_backbone_root() . '/storage/vault';
    }

    protected function oaao_vault_internal_token_ok(): bool
    {
        $secret = getenv('OAAO_ORCH_SHARED_SECRET');
        $secret = ($secret !== false && trim((string) $secret) !== '')
            ? trim((string) $secret)
            : 'oaao_dev_shared_secret';

        $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
        if (! \is_string($hdr) || $hdr === '') {
            return false;
        }

        return hash_equals($secret, $hdr);
    }

    /**
     * Resolve request tenant from Host; exits 404 when unknown, 403 when suspended.
     */
    protected function oaao_vault_bootstrap_tenant(\PDO $pdo): int
    {
        $core = $this->oaao_vault_core_api();
        if (! $core) {
            http_response_code(503);
            header('Content-Type: application/json; charset=UTF-8');
            echo json_encode(['success' => false, 'message' => 'Core unavailable']);
            exit;
        }

        $tid = (int) $core->requireTenantContext($pdo);
        $this->oaao_vault_prime_qdrant_tenant_slug();

        return $tid;
    }

    protected function oaao_vault_prime_qdrant_tenant_slug(): void
    {
        $slug = $this->oaao_vault_tenant_slug();
        if ($slug !== '') {
            VaultQdrantCollectionResolver::setTenantSlug($slug);
        }
    }

    /**
     * PostgreSQL vault APIs — workspace gate + DDL ensure + PDO handle.
     *
     * @param array<string, mixed>|null $body
     *
     * @return array{db: Database, pdo: \PDO, uid: int, wid: ?int, tid: int, auth: mixed}|null
     */
    protected function oaao_vault_require_pg_api_context(?array $body = null): ?array
    {
        [$auth, $user] = $this->oaao_vault_require_authenticated_only();
        if (! $auth || ! $user) {
            return null;
        }

        $uid = (int) ($user->user_id ?? 0);
        $wid = $this->oaao_vault_resolve_workspace_id($body);
        if (! $this->oaao_vault_gate_workspace_scope($uid, $wid)) {
            return null;
        }

        $db = $auth->getDB();
        if (! $db instanceof \Razy\Database) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $auth->ensurePgCoreTables($db);

        
        if (! \oaao_auth_database_is_pgsql($db)) {
            http_response_code(503);
            echo json_encode([
                'success' => false,
                'message' => 'Vault persistence requires PostgreSQL as the canonical database.',
            ]);

            return null;
        }

        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $tid = $this->oaao_vault_bootstrap_tenant($pdo);

        return ['db' => $db, 'pdo' => $pdo, 'uid' => $uid, 'wid' => $wid, 'tid' => $tid, 'auth' => $auth];
    }

    protected function oaao_vault_resolve_asr_summary_configured(Database $db): bool
    {
        return (new CanonicalEndpointsRepository($db))->resolveAsrSummaryBinding() !== null;
    }

    /**
     * Sidecar → PHP job APIs — PostgreSQL {@link Database} + adapter (no browser session).
     *
     * @return array{db: Database, pdo: \PDO, tid: int}|null
     */
    protected function oaao_vault_sidecar_pg_context(): ?array
    {
        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return null;
        }

        $db = $auth->getDB();
        if (! $db instanceof Database) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        
        if (! \oaao_auth_database_is_pgsql($db)) {
            http_response_code(503);
            echo json_encode([
                'success' => false,
                'message' => 'Vault jobs require PostgreSQL as the canonical database.',
            ]);

            return null;
        }

        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $this->api('auth')?->ensurePgWorkspaceTables($pdo);
        \oaao_auth_ensure_pg_vault_workspace_and_jobs($pdo);
        \oaao_auth_ensure_pg_vault_speaker_profiles($pdo);

        $tid = $this->oaao_vault_bootstrap_tenant($pdo);

        return ['db' => $db, 'pdo' => $pdo, 'tid' => $tid];
    }

    /**
     * Sidecar → PHP job APIs — DB only (no browser session).
     */
    protected function oaao_vault_sidecar_require_pdo(): ?\PDO
    {
        $ctx = $this->oaao_vault_sidecar_pg_context();

        return $ctx['pdo'] ?? null;
    }

    /**
     * Insert a queued ingest job using {@link Database} Statement ({@code insert → assign → query}); {@see lastID} for {@code BIGSERIAL job_id}.
     */
    protected function oaao_vault_insert_queued_job(Database $db, int $documentId, int $vaultId, ?int $workspaceId, string $hookId, string $payloadJson): int
    {
        $db->insert('vault_job', ['document_id', 'vault_id', 'workspace_id', 'hook_id', 'status', 'payload_json'])
            ->assign([
                'document_id'    => $documentId,
                'vault_id'       => $vaultId,
                'workspace_id'   => $workspaceId,
                'hook_id'        => $hookId,
                'status'         => 'queued',
                'payload_json'   => $payloadJson,
            ])
            ->query();

        return $db->lastID();
    }

    /**
     * @return array<string, mixed>|null
     */
    protected function oaao_vault_find_active_job(Database $db, int $documentId, string $hookId): ?array
    {
        $r = $db->prepare()
            ->select('job_id, status')
            ->from('vault_job')
            ->where('document_id=:d, hook_id=:h, status|=:st')
            ->assign(['d' => $documentId, 'h' => $hookId, 'st' => ['queued', 'running']])
            ->order('+job_id')
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r) ? $r : null;
    }

    /**
     * Best-effort purge of vectors for {@code vault_id}+{@code document_id} payloads (called on delete / re-embed).
     */
    protected function oaao_vault_best_effort_delete_qdrant_embeddings(Database $db, int $vaultId, int $documentId): void
    {
        if ($vaultId < 1 || $documentId < 1) {
            return;
        }

        /** @var array<string, mixed>|false $vr */
        $vr = $db->prepare()
            ->select('id, scope, workspace_id, owner_user_id, qdrant_url, qdrant_collection, qdrant_api_key_ref')
            ->from('vault')
            ->where('id=:vid')
            ->assign(['vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();

        if (! \is_array($vr)) {
            return;
        }

        VaultQdrantPoints::deleteEmbeddingsForDocument($vr, $vaultId, $documentId);
    }

    /**
     * Fail queued/running embed jobs so a manual re-queue can replace a stuck {@code embedding} row.
     */
    protected function oaao_vault_cancel_active_embed_jobs(Database $db, int $documentId): void
    {
        if ($documentId < 1) {
            return;
        }

        $ts = date('Y-m-d H:i:s');
        $db->update('vault_job', ['status', 'finished_at', 'last_error', 'updated_at'])
            ->where('document_id=:doc_id, hook_id=:hook_id, status|=:st')
            ->assign([
                'status'       => 'failed',
                'finished_at'  => $ts,
                'last_error'   => 'superseded_by_requeue',
                'updated_at'   => $ts,
                'doc_id'       => $documentId,
                'hook_id'      => 'vh.rag.document_embed',
                'st'           => ['queued', 'running'],
            ])
            ->query();
    }

    /**
     * Fail queued/running ASR jobs so a manual re-transcribe can replace an existing transcript.
     */
    protected function oaao_vault_cancel_active_asr_jobs(Database $db, int $documentId): void
    {
        if ($documentId < 1) {
            return;
        }

        $ts = date('Y-m-d H:i:s');
        $db->update('vault_job', ['status', 'finished_at', 'last_error', 'updated_at'])
            ->where('document_id=:doc_id, hook_id=:hook_id, status|=:st')
            ->assign([
                'status'       => 'failed',
                'finished_at'  => $ts,
                'last_error'   => 'superseded_by_retranscribe',
                'updated_at'   => $ts,
                'doc_id'       => $documentId,
                'hook_id'      => 'vh.rag.audio_asr',
                'st'           => ['queued', 'running'],
            ])
            ->query();
    }

    /**
     * Clear transcript + embed state before Speaker/normal ASR re-run (vectors removed separately).
     */
    protected function oaao_vault_prepare_document_re_asr(Database $db, int $documentId): void
    {
        if ($documentId < 1) {
            return;
        }

        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('meta_json')
            ->from('vault_document')
            ->where('id=:doc_id')
            ->assign(['doc_id' => $documentId])
            ->limit(1)
            ->query()
            ->fetch();

        $metaStr = null;
        if (\is_array($row)) {
            $metaRoot = [];
            $rawMeta = $row['meta_json'] ?? null;
            if (\is_array($rawMeta)) {
                $metaRoot = $rawMeta;
            } elseif (\is_string($rawMeta) && trim($rawMeta) !== '') {
                try {
                    $dec = json_decode(trim($rawMeta), true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($dec)) {
                        $metaRoot = $dec;
                    }
                } catch (\JsonException) {
                    $metaRoot = [];
                }
            }
            unset($metaRoot['asr']);
            if ($metaRoot !== []) {
                try {
                    $metaStr = json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $metaStr = null;
                }
            }
        }

        $ts = date('Y-m-d H:i:s');
        if ($metaStr !== null) {
            $db->update('vault_document', ['source_text', 'meta_json', 'embed_status', 'embed_error', 'embedded_chunks', 'embedded_at', 'updated_at'])
                ->where('id=:doc_id')
                ->assign([
                    'source_text'      => null,
                    'meta_json'        => $metaStr,
                    'embed_status'     => 'pending',
                    'embed_error'      => null,
                    'embedded_chunks'  => 0,
                    'embedded_at'      => null,
                    'updated_at'       => $ts,
                    'doc_id'           => $documentId,
                ])
                ->query();
        } else {
            $db->update('vault_document', ['source_text', 'meta_json', 'embed_status', 'embed_error', 'embedded_chunks', 'embedded_at', 'updated_at'])
                ->where('id=:doc_id')
                ->assign([
                    'source_text'      => null,
                    'meta_json'        => null,
                    'embed_status'     => 'pending',
                    'embed_error'      => null,
                    'embedded_chunks'  => 0,
                    'embedded_at'      => null,
                    'updated_at'       => $ts,
                    'doc_id'           => $documentId,
                ])
                ->query();
        }
    }

    protected function oaao_vault_user_can_touch_vault(Database $db, int $vaultId, int $uid, ?int $wid): bool
    {
        $tid = $this->oaao_vault_tenant_id();

        if ($wid === null) {
            $where = 'id=:vid, workspace_id IS NULL, owner_user_id=:uid';
            $assign = ['vid' => $vaultId, 'uid' => $uid];
            if ($tid > 0) {
                $where .= ', tenant_id=:tid';
                $assign['tid'] = $tid;
            }
            $r = $db->prepare()
                ->select('1 AS ok')
                ->from('vault')
                ->where($where)
                ->assign($assign)
                ->limit(1)
                ->query()
                ->fetch();

            return \is_array($r);
        }

        $where = 'v.id=?, v.workspace_id=?';
        $assign = [$uid, $vaultId, $wid];
        if ($tid > 0) {
            $where .= ', v.tenant_id=?';
            $assign[] = $tid;
        }

        $r = $db->prepare()
            ->select('1 AS ok')
            ->from('v.vault-m.workspace_member[?v.workspace_id=m.workspace_id, m.user_id=?]')
            ->where($where)
            ->assign($assign)
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r);
    }

    /**
     * Ensure one default vault row per personal user or workspace (first upload / tree viewer).
     */
    protected function oaao_vault_ensure_default_vault(Database $db, int $uid, ?int $wid): int
    {
        $ts = date('Y-m-d H:i:s');
        $tid = $this->oaao_vault_tenant_id();

        if ($wid === null) {
            $where = 'workspace_id IS NULL, owner_user_id=:uid';
            $assign = ['uid' => $uid];
            if ($tid > 0) {
                $where .= ', tenant_id=:tid';
                $assign['tid'] = $tid;
            }
            $found = $db->prepare()
                ->select('id')
                ->from('vault')
                ->where($where)
                ->assign($assign)
                ->order('+id')
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($found) && isset($found['id'])) {
                return (int) $found['id'];
            }
            $cols = ['name', 'scope', 'workspace_id', 'owner_user_id', 'created_by', 'created_at', 'updated_at'];
            $vals = [
                'name'           => 'Default',
                'scope'          => 'personal',
                'workspace_id'   => null,
                'owner_user_id'  => $uid,
                'created_by'     => $uid,
                'created_at'     => $ts,
                'updated_at'     => $ts,
            ];
            if ($tid > 0) {
                $cols[] = 'tenant_id';
                $vals['tenant_id'] = $tid;
            }
            $db->insert('vault', $cols)->assign($vals)->query();

            return $db->lastID();
        }

        $where = 'workspace_id=:wid';
        $assign = ['wid' => $wid];
        if ($tid > 0) {
            $where .= ', tenant_id=:tid';
            $assign['tid'] = $tid;
        }
        $found = $db->prepare()
            ->select('id')
            ->from('vault')
            ->where($where)
            ->assign($assign)
            ->order('+id')
            ->limit(1)
            ->query()
            ->fetch();
        if (\is_array($found) && isset($found['id'])) {
            return (int) $found['id'];
        }

        $cols = ['name', 'scope', 'workspace_id', 'owner_user_id', 'created_by', 'created_at', 'updated_at'];
        $vals = [
            'name'           => 'Default',
            'scope'          => 'workspace',
            'workspace_id'   => $wid,
            'owner_user_id'  => $uid,
            'created_by'     => $uid,
            'created_at'     => $ts,
            'updated_at'     => $ts,
        ];
        if ($tid > 0) {
            $cols[] = 'tenant_id';
            $vals['tenant_id'] = $tid;
        }
        $db->insert('vault', $cols)->assign($vals)->query();

        return $db->lastID();
    }

    /**
     * Insert an additional vault for the current shell scope (beyond {@see oaao_vault_ensure_default_vault}).
     *
     * @param non-empty-string $name Trimmed display name (caller validates length).
     */
    protected function oaao_vault_insert_named_vault(Database $db, int $uid, ?int $wid, string $name): int
    {
        $ts = date('Y-m-d H:i:s');
        $tid = $this->oaao_vault_tenant_id();
        $cols = ['name', 'scope', 'workspace_id', 'owner_user_id', 'created_by', 'created_at', 'updated_at'];

        if ($wid === null) {
            $vals = [
                'name'           => $name,
                'scope'          => 'personal',
                'workspace_id'   => null,
                'owner_user_id'  => $uid,
                'created_by'     => $uid,
                'created_at'     => $ts,
                'updated_at'     => $ts,
            ];
            if ($tid > 0) {
                $cols[] = 'tenant_id';
                $vals['tenant_id'] = $tid;
            }
            $db->insert('vault', $cols)->assign($vals)->query();

            return $db->lastID();
        }

        $vals = [
            'name'           => $name,
            'scope'          => 'workspace',
            'workspace_id'   => $wid,
            'owner_user_id'  => $uid,
            'created_by'     => $uid,
            'created_at'     => $ts,
            'updated_at'     => $ts,
        ];
        if ($tid > 0) {
            $cols[] = 'tenant_id';
            $vals['tenant_id'] = $tid;
        }
        $db->insert('vault', $cols)->assign($vals)->query();

        return $db->lastID();
    }

    /**
     * Queue ingest jobs for an existing document (manual actions from Vault UI).
     *
     * @param list<string> $hookIds
     * @param bool         $forceReembed When true, cancel queued/running {@code vh.rag.document_embed} jobs and queue a fresh run (clears stale {@code embedding} rows).
     * @param bool         $forceReAsr   When true, cancel ASR/embed jobs, clear transcript, and queue {@code vh.rag.audio_asr} again (Speaker/normal settings from Settings → ASR).
     *
     * @return list<array{job_id: int, hook_id: string}>
     */
    protected function oaao_vault_enqueue_jobs_for_document(Database $db, int $uid, ?int $wid, int $docId, array $hookIds, bool $forceReembed = false, bool $forceReAsr = false): array
    {
        /** @var list<string> $clean */
        $clean = [];
        foreach ($hookIds as $h) {
            $t = trim((string) $h);
            if ($t !== '') {
                $clean[] = $t;
            }
        }
        $clean = array_values(array_unique($clean));
        if ($clean === []) {
            return [];
        }

        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('d.id, d.vault_id, d.file_name, d.mime_type, d.byte_size, d.storage_path, d.source_text, v.workspace_id AS vault_workspace_id')
            ->from('d.vault_document-v.vault[?v.id=d.vault_id]')
            ->where('d.id=:doc_id')
            ->assign(['doc_id' => $docId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($row === false) {
            throw new \RuntimeException('Document not found');
        }

        $vaultId = (int) ($row['vault_id'] ?? 0);
        $vaultWid = isset($row['vault_workspace_id']) && $row['vault_workspace_id'] !== null
            ? (int) $row['vault_workspace_id']
            : null;

        if ($vaultWid === null && $wid !== null) {
            throw new \RuntimeException('Document is not in this workspace scope');
        }
        if ($vaultWid !== null && $wid !== $vaultWid) {
            throw new \RuntimeException('Document workspace mismatch');
        }

        if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
            throw new \RuntimeException('Forbidden');
        }

        $relPath = isset($row['storage_path']) ? trim((string) $row['storage_path']) : '';
        if ($relPath === '') {
            throw new \RuntimeException('Document has no stored file yet');
        }

        $storageRoot = $this->oaao_vault_storage_root();
        $mime = isset($row['mime_type']) ? (string) $row['mime_type'] : '';
        $byteSize = isset($row['byte_size']) && $row['byte_size'] !== null ? (int) $row['byte_size'] : 0;
        $origName = (string) ($row['file_name'] ?? '');
        $mime = oaao_vault_normalize_upload_mime($mime, $origName);
        $storedText = isset($row['source_text']) ? trim((string) $row['source_text']) : '';
        $isAudio = oaao_vault_is_audio_upload($mime, $origName);

        // Audio ingest: transcribe first; {@see vault_job_finish} enqueues embed after ASR.
        if ($isAudio && $storedText === '' && \in_array('vh.rag.document_embed', $clean, true)) {
            $clean = array_values(array_filter(
                $clean,
                static fn (string $h): bool => $h !== 'vh.rag.document_embed',
            ));
            if (! \in_array('vh.rag.audio_asr', $clean, true)) {
                $clean[] = 'vh.rag.audio_asr';
            }
        }

        if ($isAudio && \in_array('vh.rag.audio_asr', $clean, true)) {
            if ($storedText === '' || $forceReAsr) {
                $asrBind = (new CanonicalEndpointsRepository($db))->resolveAsrBinding();
                if ($asrBind === null) {
                    throw new \RuntimeException(
                        'Configure an enabled ASR purpose with a default endpoint (Settings → ASR) before ingesting audio.',
                    );
                }
            }
        }

        /** @var list<array{job_id: int, hook_id: string}> $out */
        $out = [];

        $hasGraphHook = false;
        foreach ($clean as $h) {
            if ($h === 'vh.rag.graph_index') {
                $hasGraphHook = true;
                break;
            }
        }

        $queuedNewDocumentEmbed = false;
        $queuedNewAudioAsr = false;

        foreach ($clean as $hookId) {
            if ($hookId === 'vh.rag.document_embed') {
                $active = $this->oaao_vault_find_active_job($db, $docId, 'vh.rag.document_embed');
                if (\is_array($active) && isset($active['job_id']) && (int) $active['job_id'] > 0) {
                    if ($forceReembed) {
                        $this->oaao_vault_cancel_active_embed_jobs($db, $docId);
                    } else {
                        $out[] = ['job_id' => (int) $active['job_id'], 'hook_id' => $hookId];

                        continue;
                    }
                }
            }

            if ($hookId === 'vh.rag.audio_asr') {
                if ($forceReAsr) {
                    $this->oaao_vault_cancel_active_asr_jobs($db, $docId);
                    $this->oaao_vault_cancel_active_embed_jobs($db, $docId);
                    $this->oaao_vault_best_effort_delete_qdrant_embeddings($db, $vaultId, $docId);
                    $this->oaao_vault_prepare_document_re_asr($db, $docId);
                    $storedText = '';
                    $row['source_text'] = null;
                } elseif ($storedText !== '') {
                    throw new \RuntimeException(
                        'Transcript already exists — use Re-transcribe to apply Speaker mode or replace the transcript.',
                    );
                }

                $activeAsr = $this->oaao_vault_find_active_job($db, $docId, 'vh.rag.audio_asr');
                if (\is_array($activeAsr) && isset($activeAsr['job_id']) && (int) $activeAsr['job_id'] > 0) {
                    if ($forceReAsr) {
                        $this->oaao_vault_cancel_active_asr_jobs($db, $docId);
                    } else {
                        $out[] = ['job_id' => (int) $activeAsr['job_id'], 'hook_id' => $hookId];

                        continue;
                    }
                }
            }

            $payload = [
                'relative_path'  => $relPath,
                'storage_root'   => $storageRoot,
                'mime_type'      => $mime,
                'byte_size'      => $byteSize,
                'original_name'  => $origName,
                'document_id'    => $docId,
                'vault_id'       => $vaultId,
            ];
            if ($hookId === 'vh.rag.graph_index' || $hookId === 'vh.rag.document_embed') {
                $payload = $this->oaao_vault_merge_graphrag_job_payload($db, $vaultId, $payload);
            }
            if ($hookId === 'vh.rag.audio_asr') {
                $payload = $this->oaao_vault_merge_asr_job_payload($db, $vaultId, $wid, $payload);
            }
            if ($hookId === 'vh.rag.document_embed') {
                $storedText = isset($row['source_text']) ? trim((string) $row['source_text']) : '';
                if ($storedText !== '') {
                    $payload['source_text'] = substr($storedText, 0, 500000);
                }
            }
            $pj = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

            $jid = $this->oaao_vault_insert_queued_job($db, $docId, $vaultId, $wid, $hookId, $pj);
            if ($jid > 0) {
                $out[] = ['job_id' => $jid, 'hook_id' => $hookId];
                if ($hookId === 'vh.rag.document_embed') {
                    $queuedNewDocumentEmbed = true;
                    $this->oaao_vault_best_effort_delete_qdrant_embeddings($db, $vaultId, $docId);
                } elseif ($hookId === 'vh.rag.audio_asr') {
                    $queuedNewAudioAsr = true;
                }
            }
        }

        $ts = date('Y-m-d H:i:s');
        if ($queuedNewDocumentEmbed) {
            $db->update('vault_document', ['embed_error', 'embed_status', 'updated_at'])
                ->where('id=:doc_id')
                ->assign([
                    'embed_error'  => null,
                    'embed_status' => 'pending',
                    'updated_at'   => $ts,
                    'doc_id'       => $docId,
                ])
                ->query();
        } elseif ($queuedNewAudioAsr) {
            $db->update('vault_document', ['embed_error', 'embed_status', 'updated_at'])
                ->where('id=:doc_id')
                ->assign([
                    'embed_error'  => null,
                    'embed_status' => 'pending',
                    'updated_at'   => $ts,
                    'doc_id'       => $docId,
                ])
                ->query();
        } elseif ($out !== []) {
            /** held / failed retry when enqueue did not insert a new embed job (e.g. graph-only). */
            $db->update('vault_document', ['embed_error', 'embed_status', 'updated_at'])
                ->where('id=:doc_id, embed_status|=:hs')
                ->assign([
                    'embed_error'  => null,
                    'embed_status' => 'pending',
                    'updated_at'   => $ts,
                    'doc_id'       => $docId,
                    'hs'           => ['held', 'failed'],
                ])
                ->query();
        }

        if ($hasGraphHook) {
            $db->update('vault_document', ['graph_status', 'graph_error', 'updated_at'])
                ->where('id=:id')
                ->assign([
                    'graph_status' => 'pending',
                    'graph_error'  => null,
                    'updated_at'   => date('Y-m-d H:i:s'),
                    'id'           => $docId,
                ])
                ->query();
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    protected function oaao_vault_merge_graphrag_job_payload(Database $db, int $vaultId, array $payload): array
    {
        /** @var array<string, mixed>|false $v */
        $v = $db->prepare()
            ->select('id, scope, workspace_id, owner_user_id, graph_mode, qdrant_url, qdrant_collection, qdrant_api_key_ref, arango_url, arango_database, arango_user_ref, arango_password_ref')
            ->from('vault')
            ->where('id=:vid')
            ->assign(['vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($v === false) {
            return $payload;
        }

        $qCol = VaultQdrantCollectionResolver::resolveEffectiveCollection($v);
        if ($this->oaao_vault_tenant_id() > 0) {
            $payload['tenant_id'] = $this->oaao_vault_tenant_id();
            $payload['tenant_slug'] = $this->oaao_vault_tenant_slug();
        }
        if ($qCol !== null && $qCol !== '') {
            $payload['qdrant_collection'] = $qCol;
        }

        $arangoCfg = VaultArangoResolver::resolveEffectiveConfig($v);
        $aUserRef = $arangoCfg['user_ref'] ?? null;
        $aPassRef = $arangoCfg['password_ref'] ?? null;

        $payload['graphrag'] = [
            'vault_graph_mode' => (int) ($v['graph_mode'] ?? 0),
            'arango'           => [
                'url'           => $arangoCfg['url'],
                'database'      => $arangoCfg['database'],
                'user_ref'      => $aUserRef,
                'password_ref'  => $aPassRef,
                'user_env'      => ($aUserRef !== null && $aUserRef !== '')
                    ? ChatOrchestratorBootstrap::inferApiKeyEnv($aUserRef) : null,
                'password_env'  => ($aPassRef !== null && $aPassRef !== '')
                    ? ChatOrchestratorBootstrap::inferApiKeyEnv($aPassRef) : null,
            ],
            'qdrant'           => [
                'url'         => isset($v['qdrant_url']) && $v['qdrant_url'] !== null && $v['qdrant_url'] !== ''
                    ? trim((string) $v['qdrant_url']) : null,
                'collection'  => VaultQdrantCollectionResolver::resolveEffectiveCollection($v),
                'api_key_ref' => isset($v['qdrant_api_key_ref']) && $v['qdrant_api_key_ref'] !== null && $v['qdrant_api_key_ref'] !== ''
                    ? trim((string) $v['qdrant_api_key_ref']) : null,
                'api_key_env' => (isset($v['qdrant_api_key_ref']) && trim((string) $v['qdrant_api_key_ref']) !== '')
                    ? ChatOrchestratorBootstrap::inferApiKeyEnv((string) $v['qdrant_api_key_ref'])
                    : null,
            ],
        ];

        $embRepo = new CanonicalEndpointsRepository($db);
        /** @var array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null $embBind */
        $embBind = $embRepo->resolveVaultIngestEmbeddingBinding();
        if ($embBind !== null) {
            $eref = trim($embBind['api_key_ref']);
            $payload['graphrag']['embedding'] = [
                'purpose_key' => $embBind['purpose_key'],
                'base_url'    => $embBind['base_url'],
                'model'       => $embBind['model'],
                'api_key_env' => ($eref !== '' ? ChatOrchestratorBootstrap::inferApiKeyEnv($eref) : null),
            ];
        }

        /** @var array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null $graphBind */
        $graphBind = $embRepo->resolveVaultGraphBinding();
        if ($graphBind !== null) {
            $gref = trim($graphBind['api_key_ref']);
            $payload['graphrag']['graph'] = [
                'purpose_key' => $graphBind['purpose_key'],
                'base_url'    => $graphBind['base_url'],
                'model'       => $graphBind['model'],
                'api_key_env' => ($gref !== '' ? ChatOrchestratorBootstrap::inferApiKeyEnv($gref) : null),
            ];
        }

        return $payload;
    }

    /**
     * ASR + polish endpoints and merged glossary for {@code vh.rag.audio_asr} jobs.
     *
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    protected function oaao_vault_merge_asr_job_payload(Database $db, int $vaultId, ?int $workspaceId, array $payload): array
    {
        $embRepo = new CanonicalEndpointsRepository($db);

        /** @var array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null $asrBind */
        $asrBind = $embRepo->resolveAsrBinding();
        if ($asrBind !== null) {
            $payload['asr'] = \oaaoai\endpoints\AsrPurposeConfig::jobPayloadFromBinding(
                $asrBind,
                static fn (string $ref): ?string => ChatOrchestratorBootstrap::inferApiKeyEnv($ref),
            );
        }

        /** @var array{purpose_key: string, base_url: string, model: string, api_key_ref: string}|null $polishBind */
        $polishBind = $embRepo->resolvePolishBinding();
        if ($polishBind !== null) {
            $pref = trim($polishBind['api_key_ref']);
            $payload['polish'] = [
                'purpose_key' => $polishBind['purpose_key'],
                'base_url'    => $polishBind['base_url'],
                'model'       => $polishBind['model'],
                'api_key_env' => ($pref !== '' ? ChatOrchestratorBootstrap::inferApiKeyEnv($pref) : null),
            ];
        }

        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $payload['glossary'] = VaultGlossary::mergedForVault($db, $pdo, $vaultId, $workspaceId);
        }

        return $payload;
    }

    /**
     * Speaker-mode ASR segments for segment-aware Qdrant ingest ({@see vault_document_embed}).
     *
     * @return array{asr_mode?: string, asr_segments?: list<array<string, mixed>>}
     */
    protected function oaao_vault_embed_asr_segments_for_payload(?string $metaJsonRaw): array
    {
        if ($metaJsonRaw === null || trim($metaJsonRaw) === '') {
            return [];
        }
        try {
            $meta = json_decode($metaJsonRaw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }
        if (! \is_array($meta)) {
            return [];
        }
        $asr = $meta['asr'] ?? null;
        if (! \is_array($asr)) {
            return [];
        }
        $rawSegs = $asr['segments'] ?? null;
        if (! \is_array($rawSegs) || $rawSegs === []) {
            return [];
        }
        $mode = strtolower(trim((string) ($asr['mode'] ?? 'speaker')));
        /** @var list<array<string, mixed>> $segments */
        $segments = [];
        foreach ($rawSegs as $seg) {
            if (! \is_array($seg)) {
                continue;
            }
            $text = trim((string) ($seg['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $segments[] = [
                'speaker_id'    => max(0, (int) ($seg['speaker_id'] ?? 0)),
                'speaker_label' => substr(trim((string) ($seg['speaker_label'] ?? '')), 0, 128),
                'begin_ms'      => max(0, (int) ($seg['begin_ms'] ?? 0)),
                'end_ms'        => max(0, (int) ($seg['end_ms'] ?? 0)),
                'text'          => substr($text, 0, 8000),
            ];
            if (\count($segments) >= 4000) {
                break;
            }
        }
        if ($segments === []) {
            return [];
        }

        return [
            'asr_mode'     => $mode !== '' ? $mode : 'speaker',
            'asr_segments' => $segments,
        ];
    }

    /**
     * Queue {@code vh.rag.document_embed} for a document with optional payload extras (e.g. transcript summary chunk).
     *
     * @param array<string, mixed> $payloadExtras
     */
    protected function oaao_vault_enqueue_document_embed_job(
        Database $db,
        int $docId,
        int $vaultId,
        ?int $wid,
        string $sourceText,
        array $payloadExtras = [],
        bool $forceReembed = false,
    ): bool {
        if ($docId < 1 || $vaultId < 1 || trim($sourceText) === '') {
            return false;
        }

        $active = $this->oaao_vault_find_active_job($db, $docId, 'vh.rag.document_embed');
        if (\is_array($active) && isset($active['job_id']) && (int) $active['job_id'] > 0) {
            if ($forceReembed) {
                $this->oaao_vault_cancel_active_embed_jobs($db, $docId);
                $this->oaao_vault_best_effort_delete_qdrant_embeddings($db, $vaultId, $docId);
            } else {
                return false;
            }
        }

        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('d.id, d.file_name, d.mime_type, d.byte_size, d.storage_path, d.meta_json, v.workspace_id AS vault_workspace_id')
            ->from('d.vault_document-v.vault[?v.id=d.vault_id]')
            ->where('d.id=:doc_id')
            ->assign(['doc_id' => $docId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($row === false) {
            return false;
        }

        $relPath = isset($row['storage_path']) ? trim((string) $row['storage_path']) : '';
        if ($relPath === '') {
            return false;
        }

        $storageRoot = $this->oaao_vault_storage_root();
        $payload = [
            'relative_path'  => $relPath,
            'storage_root'   => $storageRoot,
            'mime_type'      => (string) ($row['mime_type'] ?? 'audio/mpeg'),
            'byte_size'      => (int) ($row['byte_size'] ?? 0),
            'original_name'  => (string) ($row['file_name'] ?? ''),
            'document_id'    => $docId,
            'vault_id'       => $vaultId,
            'source_text'    => substr(trim($sourceText), 0, 500000),
        ];
        $asrPayload = $this->oaao_vault_embed_asr_segments_for_payload(
            isset($row['meta_json']) ? (string) $row['meta_json'] : null,
        );
        if ($asrPayload !== []) {
            $payload = array_merge($payload, $asrPayload);
        }
        foreach ($payloadExtras as $key => $val) {
            if ($val === null) {
                continue;
            }
            if (\is_string($val) && trim($val) === '') {
                continue;
            }
            $payload[(string) $key] = $val;
        }
        $payload = $this->oaao_vault_merge_graphrag_job_payload($db, $vaultId, $payload);
        $pj = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $jid = $this->oaao_vault_insert_queued_job($db, $docId, $vaultId, $wid, 'vh.rag.document_embed', $pj);
        if ($jid < 1) {
            return false;
        }

        $db->update('vault_document', ['embed_error', 'embed_status', 'updated_at'])
            ->where('id=:doc_id')
            ->assign([
                'embed_error'  => null,
                'embed_status' => 'pending',
                'updated_at'   => date('Y-m-d H:i:s'),
                'doc_id'       => $docId,
            ])
            ->query();

        return true;
    }

    /**
     * Queue {@code vh.rag.document_embed} after successful ASR (transcript in {@code source_text} / job payload).
     */
    protected function oaao_vault_enqueue_document_embed_after_asr(Database $db, int $docId, int $vaultId, ?int $wid, string $sourceText): void
    {
        $this->oaao_vault_enqueue_document_embed_job($db, $docId, $vaultId, $wid, $sourceText, [], false);
    }

    /**
     * Queue {@code vh.rag.transcript_summary} — async LLM summary for View Transcript dialog.
     *
     * @param array{id: string, label: string, emoji: string, prompt: string} $template
     * @param array{purpose_key: string, base_url: string, model: string, api_key_ref: string} $llmBind
     */
    protected function oaao_vault_enqueue_transcript_summary_job(
        Database $db,
        int $docId,
        int $vaultId,
        ?int $wid,
        array $template,
        string $summaryLanguage,
        bool $embedToRag,
        string $sourceText,
        string $fileName,
        array $llmBind,
    ): int {
        if ($docId < 1 || $vaultId < 1 || trim($sourceText) === '') {
            return 0;
        }

        $active = $this->oaao_vault_find_active_job($db, $docId, 'vh.rag.transcript_summary');
        if (\is_array($active) && isset($active['job_id']) && (int) $active['job_id'] > 0) {
            return (int) $active['job_id'];
        }

        $langLine = VaultTranscriptSummaryLanguages::promptSuffix($summaryLanguage);
        $system = trim((string) ($template['prompt'] ?? ''))
            . "\n\nLanguage: " . $langLine
            . "\n\nReturn only the summary in Markdown. Do not wrap in code fences.";
        $userContent = 'File: ' . ($fileName !== '' ? $fileName : ('Document #' . $docId))
            . "\nTemplate: " . (string) ($template['label'] ?? 'Summary')
            . "\n\nTranscript:\n" . substr(trim($sourceText), 0, 120000);

        $eref = trim((string) ($llmBind['api_key_ref'] ?? ''));
        $payload = [
            'document_id'      => $docId,
            'vault_id'         => $vaultId,
            'file_name'        => $fileName,
            'source_text'      => substr(trim($sourceText), 0, 120000),
            'template_id'      => (string) ($template['id'] ?? ''),
            'template_label'   => (string) ($template['label'] ?? ''),
            'template_emoji'   => (string) ($template['emoji'] ?? ''),
            'summary_language' => $summaryLanguage,
            'embed_to_rag'     => $embedToRag,
            'summary'          => [
                'llm' => [
                    'purpose_key' => (string) ($llmBind['purpose_key'] ?? ''),
                    'base_url'    => (string) ($llmBind['base_url'] ?? ''),
                    'model'       => (string) ($llmBind['model'] ?? ''),
                    'api_key_env' => ($eref !== '' ? ChatOrchestratorBootstrap::inferApiKeyEnv($eref) : null),
                ],
                'system_prompt' => $system,
                'user_content'  => $userContent,
            ],
        ];
        $pj = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $jid = $this->oaao_vault_insert_queued_job($db, $docId, $vaultId, $wid, 'vh.rag.transcript_summary', $pj);
        if ($jid < 1) {
            return 0;
        }

        $ts = date('Y-m-d H:i:s');
        /** @var array<string, mixed>|false $docRow */
        $docRow = $db->prepare()
            ->select('meta_json')
            ->from('vault_document')
            ->where('id=:id')
            ->assign(['id' => $docId])
            ->limit(1)
            ->query()
            ->fetch();
        /** @var array<string, mixed> $metaRoot */
        $metaRoot = [];
        if (\is_array($docRow) && isset($docRow['meta_json'])) {
            $rawMeta = $docRow['meta_json'];
            if (\is_array($rawMeta)) {
                $metaRoot = $rawMeta;
            } elseif (\is_string($rawMeta) && trim($rawMeta) !== '') {
                try {
                    $dec = json_decode(trim($rawMeta), true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($dec)) {
                        $metaRoot = $dec;
                    }
                } catch (\JsonException) {
                    $metaRoot = [];
                }
            }
        }

        $metaRoot['transcript_summary'] = [
            'status'           => 'queued',
            'template_id'      => (string) ($template['id'] ?? ''),
            'template_label'   => (string) ($template['label'] ?? ''),
            'template_emoji'   => (string) ($template['emoji'] ?? ''),
            'summary_language' => $summaryLanguage,
            'embed_to_rag'     => $embedToRag,
            'text'             => '',
            'queued_at'        => $ts,
            'job_id'           => $jid,
        ];

        $db->update('vault_document', ['meta_json', 'updated_at'])
            ->where('id=:id')
            ->assign([
                'meta_json'  => json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'updated_at' => $ts,
                'id'         => $docId,
            ])
            ->query();

        return $jid;
    }

    /**
     * Queue {@code vh.rag.graph_index} when {@code oaao_vault.graph_mode} is on (post-embed chain).
     */
    protected function oaao_vault_enqueue_graph_index_if_enabled(Database $db, int $docId, int $vaultId): void
    {
        if ($docId < 1 || $vaultId < 1) {
            return;
        }

        /** @var array<string, mixed>|false $gv */
        $gv = $db->prepare()
            ->select('graph_mode')
            ->from('vault')
            ->where('id=:vid')
            ->assign(['vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($gv === false || (int) ($gv['graph_mode'] ?? 0) < 1) {
            return;
        }

        $dup = $db->prepare()
            ->select('job_id')
            ->from('vault_job')
            ->where('document_id=:doc_id, hook_id=:hook_id, status|=:st')
            ->assign([
                'doc_id'  => $docId,
                'hook_id' => 'vh.rag.graph_index',
                'st'      => ['queued', 'running'],
            ])
            ->limit(1)
            ->query()
            ->fetch();
        if (\is_array($dup)) {
            return;
        }

        /** @var array<string, mixed>|false $row */
        $row = $db->prepare()
            ->select('d.id, d.file_name, d.mime_type, d.byte_size, d.storage_path, v.workspace_id AS vault_workspace_id')
            ->from('d.vault_document-v.vault[?v.id=d.vault_id]')
            ->where('d.id=:doc_id, d.vault_id=:vault_id')
            ->assign(['doc_id' => $docId, 'vault_id' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();
        if ($row === false) {
            return;
        }

        $relPath = isset($row['storage_path']) ? trim((string) $row['storage_path']) : '';
        if ($relPath === '') {
            return;
        }

        $wid = isset($row['vault_workspace_id']) && $row['vault_workspace_id'] !== null
            ? (int) $row['vault_workspace_id']
            : null;

        $storageRoot = $this->oaao_vault_storage_root();
        $payload = [
            'relative_path' => $relPath,
            'storage_root'  => $storageRoot,
            'mime_type'     => isset($row['mime_type']) ? (string) $row['mime_type'] : '',
            'byte_size'     => isset($row['byte_size']) && $row['byte_size'] !== null ? (int) $row['byte_size'] : 0,
            'original_name' => (string) ($row['file_name'] ?? ''),
            'document_id'   => $docId,
            'vault_id'      => $vaultId,
        ];
        $payload = $this->oaao_vault_merge_graphrag_job_payload($db, $vaultId, $payload);
        $pj = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $jid = $this->oaao_vault_insert_queued_job($db, $docId, $vaultId, $wid, 'vh.rag.graph_index', $pj);
        if ($jid < 1) {
            return;
        }

        $db->update('vault_document', ['graph_status', 'graph_error', 'updated_at'])
            ->where('id=:id')
            ->assign([
                'graph_status' => 'pending',
                'graph_error'  => null,
                'updated_at'   => date('Y-m-d H:i:s'),
                'id'           => $docId,
            ])
            ->query();
    }

    protected function oaao_vault_container_belongs_to_vault(Database $db, int $containerId, int $vaultId): bool
    {
        $r = $db->prepare()
            ->select('1 AS ok')
            ->from('vault_container')
            ->where('id=:cid, vault_id=:vid')
            ->assign(['cid' => $containerId, 'vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($r);
    }

    /**
     * All folder ids in the subtree rooted at {@code $rootContainerId} (inclusive), same vault only.
     *
     * @return list<int>
     */
    protected function oaao_vault_container_subtree_ids(Database $db, int $vaultId, int $rootContainerId): array
    {
        if ($rootContainerId < 1) {
            return [];
        }

        $sql = <<<'SQL'
WITH RECURSIVE sub AS (
    SELECT id FROM oaao_vault_container WHERE id = :rid AND vault_id = :v1
    UNION ALL
    SELECT c.id FROM oaao_vault_container c
    INNER JOIN sub s ON c.parent_container_id = s.id
    WHERE c.vault_id = :v2
)
SELECT id FROM sub
SQL;

        $q = $db->prepare($sql)
            ->assign([
                'rid' => $rootContainerId,
                'v1'  => $vaultId,
                'v2'  => $vaultId,
            ])
            ->query();
        /** @var list<int> $out */
        $out = [];
        while (($row = $q->fetch()) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $id = (int) ($row['id'] ?? 0);
            if ($id > 0) {
                $out[] = $id;
            }
        }

        return $out;
    }

    protected function oaao_vault_unlink_storage_file(string $storageRoot, ?string $relativePath): void
    {
        if ($relativePath === null || $relativePath === '') {
            return;
        }
        $rel = str_replace(["\0"], '', (string) $relativePath);
        $rel = ltrim($rel, '/');
        if ($rel === '' || str_contains($rel, '..')) {
            return;
        }
        $abs = rtrim($storageRoot, '/') . '/' . $rel;
        if (is_file($abs)) {
            @unlink($abs);
        }
    }

    /**
     * Stream a vault binary with optional HTTP Range support (audio seek in transcript UI).
     */
    protected function oaao_vault_stream_binary_file(string $absPath, string $mimeType, string $downloadName, int $size): void
    {
        if ($size < 1) {
            $probe = filesize($absPath);
            $size = $probe !== false ? (int) $probe : 0;
        }

        $safeName = preg_replace('/[^\w.\-]+/u', '_', $downloadName) ?: 'audio';
        header('Content-Type: ' . ($mimeType !== '' ? $mimeType : 'application/octet-stream'));
        header('Accept-Ranges: bytes');
        header('Cache-Control: private, max-age=3600');
        header('Content-Disposition: inline; filename="' . str_replace('"', '', $safeName) . '"');

        $rangeHdr = $_SERVER['HTTP_RANGE'] ?? '';
        if (\is_string($rangeHdr) && preg_match('/bytes=(\d*)-(\d*)/', $rangeHdr, $m) === 1 && $size > 0) {
            $start = $m[1] !== '' ? (int) $m[1] : 0;
            $end = $m[2] !== '' ? (int) $m[2] : ($size - 1);
            if ($start > $end || $start >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */{$size}");

                return;
            }
            $end = min($end, $size - 1);
            $length = $end - $start + 1;

            http_response_code(206);
            header("Content-Range: bytes {$start}-{$end}/{$size}");
            header('Content-Length: ' . (string) $length);

            $fh = fopen($absPath, 'rb');
            if ($fh === false) {
                http_response_code(500);

                return;
            }
            fseek($fh, $start);
            $remaining = $length;
            while ($remaining > 0 && ! feof($fh)) {
                $chunk = fread($fh, min(8192, $remaining));
                if ($chunk === false) {
                    break;
                }
                echo $chunk;
                $remaining -= \strlen($chunk);
            }
            fclose($fh);

            return;
        }

        header('Content-Length: ' . (string) $size);
        readfile($absPath);
    }

    /**
     * Whether uploads should auto-queue RAG ingest hooks ({@see document_upload.php}).
     *
     * Maps to {@code oaao_vault.is_enabled}: {@code 0} = storage-first; explicit enqueue or chat-selected retrieval applies separately.
     */
    protected function oaao_vault_auto_rag_ingest_enabled(Database $db, int $vaultId): bool
    {
        $r = $db->prepare()
            ->select('COALESCE(is_enabled, 1) AS en')
            ->from('vault')
            ->where('id=:id')
            ->assign(['id' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($r) || ! isset($r['en'])) {
            return true;
        }

        return (int) $r['en'] === 1;
    }

    /**
     * @param array{lite_documents?: bool} $options
     *
     * @return array{vaults: list<array<string, mixed>>, containers: list<array<string, mixed>>, documents: list<array<string, mixed>>, tree: list<array<string, mixed>>}
     */
    protected function oaao_vault_build_scope_payload(Database $db, int $uid, ?int $wid, array $options = []): array
    {
        $liteDocuments = ($options['lite_documents'] ?? true) === true;
        /** @var list<array<string, mixed>> $vaults */
        $tid = $this->oaao_vault_tenant_id();
        if ($wid === null) {
            $where = 'workspace_id IS NULL, owner_user_id=:uid';
            $assign = ['uid' => $uid];
            if ($tid > 0) {
                $where .= ', tenant_id=:tid';
                $assign['tid'] = $tid;
            }
            $vaults = $db->prepare()
                ->select('id, name, scope, workspace_id, owner_user_id, created_at, is_enabled, graph_mode, description')
                ->from('vault')
                ->where($where)
                ->assign($assign)
                ->order('+id')
                ->query()
                ->fetchAll();
        } else {
            $where = 'v.workspace_id=?';
            $assign = [$uid, $wid];
            if ($tid > 0) {
                $where .= ', v.tenant_id=?';
                $assign[] = $tid;
            }
            $vaults = $db->prepare()
                ->select('v.id, v.name, v.scope, v.workspace_id, v.owner_user_id, v.created_at, v.is_enabled, v.graph_mode, v.description')
                ->from('v.vault-m.workspace_member[?v.workspace_id=m.workspace_id, m.user_id=?]')
                ->where($where)
                ->assign($assign)
                ->order('+id')
                ->query()
                ->fetchAll();
        }

        if (! \is_array($vaults)) {
            $vaults = [];
        }
        if ($vaults === []) {
            return ['vaults' => [], 'containers' => [], 'documents' => [], 'tree' => []];
        }

        $vaultIds = [];
        foreach ($vaults as $row) {
            $vaultIds[] = (int) ($row['id'] ?? 0);
        }

        /** @var list<array<string, mixed>> $containers */
        $containers = $db->prepare()
            ->select('id, vault_id, name, parent_container_id, created_at')
            ->from('vault_container')
            ->where('vault_id|=:ids')
            ->assign(['ids' => $vaultIds])
            ->order('+id')
            ->query()
            ->fetchAll();
        if (! \is_array($containers)) {
            $containers = [];
        }

        /** @var list<array<string, mixed>> $documents */
        $docSelect = $liteDocuments
            ? 'id, vault_id, container_id, file_name, mime_type, embed_status, embed_attempts, graph_status, byte_size, created_at, (CASE WHEN source_text IS NOT NULL AND BTRIM(source_text) <> \'\' THEN 1 ELSE 0 END) AS has_transcript'
            : 'id, vault_id, container_id, file_name, mime_type, embed_status, embed_error, embed_attempts, graph_status, graph_error, byte_size, created_at, (CASE WHEN source_text IS NOT NULL AND BTRIM(source_text) <> \'\' THEN 1 ELSE 0 END) AS has_transcript';
        $documents = $db->prepare()
            ->select($docSelect)
            ->from('vault_document')
            ->where('vault_id|=:ids')
            ->assign(['ids' => $vaultIds])
            ->order('+id')
            ->query()
            ->fetchAll();
        if (! \is_array($documents)) {
            $documents = [];
        }

        $byVaultContainers = [];
        foreach ($containers as $c) {
            $vid = (int) ($c['vault_id'] ?? 0);
            $byVaultContainers[$vid][] = $c;
        }

        $byVaultDocs = [];
        foreach ($documents as $d) {
            $vid = (int) ($d['vault_id'] ?? 0);
            $byVaultDocs[$vid][] = $d;
        }

        $tree = [];
        foreach ($vaults as $vrow) {
            $vid = (int) ($vrow['id'] ?? 0);
            $vaultContainers = $byVaultContainers[$vid] ?? [];
            $vaultDocs = $byVaultDocs[$vid] ?? [];
            $vaultNode = [
                'kind'             => 'vault',
                'id'               => $vid,
                'name'             => (string) ($vrow['name'] ?? ''),
                'scope'            => (string) ($vrow['scope'] ?? ''),
                'workspace_id'     => isset($vrow['workspace_id']) && $vrow['workspace_id'] !== null ? (int) $vrow['workspace_id'] : null,
                'owner_user_id'    => isset($vrow['owner_user_id']) && $vrow['owner_user_id'] !== null ? (int) $vrow['owner_user_id'] : null,
                'created_at'       => $vrow['created_at'] ?? null,
                'is_enabled'       => (int) ($vrow['is_enabled'] ?? 1),
                'graph_mode'       => (int) ($vrow['graph_mode'] ?? 0),
                'description'      => isset($vrow['description']) && $vrow['description'] !== null && $vrow['description'] !== ''
                    ? (string) $vrow['description']
                    : null,
                'folder_count'     => \count($vaultContainers),
                'document_count'   => \count($vaultDocs),
                'children'         => $this->oaao_vault_build_vault_children(
                    $vaultContainers,
                    $vaultDocs,
                    (int) ($vrow['graph_mode'] ?? 0),
                    $liteDocuments,
                ),
            ];
            $tree[] = $vaultNode;
        }

        return [
            'vaults'      => $vaults,
            'containers'  => $containers,
            'documents'   => $documents,
            'tree'        => $tree,
        ];
    }

    /**
     * @param list<array<string, mixed>> $vaultContainers
     * @param list<array<string, mixed>> $vaultDocs
     *
     * @return list<array<string, mixed>>
     */
    protected function oaao_vault_build_vault_children(array $vaultContainers, array $vaultDocs, int $vaultGraphMode, bool $liteDocuments = true): array
    {
        /** @var array<int, array<string, mixed>> $metaByContainerId */
        $metaByContainerId = [];
        /** @var array<string, list<int>> $childIdsByParentKey */
        $childIdsByParentKey = [];

        foreach ($vaultContainers as $c) {
            $cid = (int) ($c['id'] ?? 0);
            if ($cid < 1) {
                continue;
            }

            $pid = isset($c['parent_container_id']) && $c['parent_container_id'] !== null
                ? (int) $c['parent_container_id']
                : null;
            $pk = $pid === null ? '__root__' : (string) $pid;
            $childIdsByParentKey[$pk][] = $cid;

            $metaByContainerId[$cid] = [
                'vault_id'            => (int) ($c['vault_id'] ?? 0),
                'name'                => (string) ($c['name'] ?? ''),
                'parent_container_id' => $pid,
                'created_at'          => $c['created_at'] ?? null,
            ];
        }

        /** @var array<int, list<array<string, mixed>>> $docsByContainerId */
        $docsByContainerId = [];
        /** @var list<array<string, mixed>> $vaultRootDocs */
        $vaultRootDocs = [];

        foreach ($vaultDocs as $d) {
            $docNode = [
                'kind'          => 'document',
                'id'            => (int) ($d['id'] ?? 0),
                'vault_id'      => (int) ($d['vault_id'] ?? 0),
                'container_id'  => isset($d['container_id']) && $d['container_id'] !== null ? (int) $d['container_id'] : null,
                'file_name'     => (string) ($d['file_name'] ?? ''),
                'mime_type'     => isset($d['mime_type']) ? (string) $d['mime_type'] : null,
                'embed_status'    => (string) ($d['embed_status'] ?? ''),
                'embed_attempts'  => isset($d['embed_attempts']) ? (int) $d['embed_attempts'] : 0,
                'graph_status'    => isset($d['graph_status']) && \is_string($d['graph_status']) ? trim($d['graph_status']) : null,
                'vault_graph_mode'=> $vaultGraphMode,
                'byte_size'       => isset($d['byte_size']) && $d['byte_size'] !== null ? (int) $d['byte_size'] : null,
                'created_at'      => $d['created_at'] ?? null,
                'has_transcript'  => (int) ($d['has_transcript'] ?? 0) === 1,
            ];
            if (! $liteDocuments) {
                $docNode['embed_error'] = isset($d['embed_error']) && \is_string($d['embed_error']) ? trim($d['embed_error']) : null;
                $docNode['graph_error'] = isset($d['graph_error']) && \is_string($d['graph_error']) ? trim($d['graph_error']) : null;
            }
            $cid = $docNode['container_id'];
            if ($cid !== null && isset($metaByContainerId[$cid])) {
                $docsByContainerId[$cid][] = $docNode;
            } else {
                $vaultRootDocs[] = $docNode;
            }
        }

        $buildContainerSubtree = function (int $cid) use (&$buildContainerSubtree, &$metaByContainerId, &$childIdsByParentKey, &$docsByContainerId): array {
            $meta = $metaByContainerId[$cid];
            /** @var list<array<string, mixed>> $kids */
            $kids = [];

            foreach ($childIdsByParentKey[(string) $cid] ?? [] as $childId) {
                $kids[] = $buildContainerSubtree((int) $childId);
            }

            foreach ($docsByContainerId[$cid] ?? [] as $docNode) {
                $kids[] = $docNode;
            }

            return [
                'kind'                => 'container',
                'id'                  => $cid,
                'vault_id'            => $meta['vault_id'],
                'name'                => $meta['name'],
                'parent_container_id' => $meta['parent_container_id'],
                'created_at'          => $meta['created_at'],
                'children'            => $kids,
            ];
        };

        /** @var list<array<string, mixed>> $roots */
        $roots = [];

        foreach ($childIdsByParentKey['__root__'] ?? [] as $cid) {
            $roots[] = $buildContainerSubtree((int) $cid);
        }

        foreach ($vaultRootDocs as $docNode) {
            $roots[] = $docNode;
        }

        return $roots;
    }

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
        $this->oaao_vault_prime_qdrant_tenant_slug();
        $chat = $this->api('chat');
        $infer = $chat
            ? static fn (string $ref): ?string => $chat->inferOrchestratorApiKeyEnv($ref)
            : static fn (string $ref): ?string => null;

        return \oaaoai\vault\VaultRetrievalProfiles::fromVaultIds($db, $vaultIds, $infer);
    }

    public function __onInit(Agent $agent): bool
    {
        $agent->addAPICommand([
            'getVaultDocumentHookRegistry'     => 'getVaultDocumentHookRegistry',
            'getWorkspaceGlossary'             => 'getWorkspaceGlossary',
            'saveWorkspaceGlossary'            => 'saveWorkspaceGlossary',
            'buildRetrievalProfilesFromVaultIds' => 'buildRetrievalProfilesFromVaultIds',
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
                'POST vault_container_create' => 'vault_container_create',
                'POST vault_auto_rag_set' => 'vault_auto_rag_set',
                'POST vault_graph_mode_set' => 'vault_graph_mode_set',
                'POST vault_create'    => 'vault_create',
                'POST document_upload' => 'document_upload',
                'POST document_enqueue' => 'document_enqueue',
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
        ], true);
    }
};
