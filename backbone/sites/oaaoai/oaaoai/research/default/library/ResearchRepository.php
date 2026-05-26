<?php

declare(strict_types=1);

namespace oaaoai\research;

use Razy\Database;

/**
 * CRUD for {@code oaao_research_*} tables.
 */
final class ResearchRepository
{
    public const REFETCH_OFF = 0;
    public const REFETCH_QUEUED = 1;
    public const REFETCH_RUNNING = 2;

    public function __construct(private readonly Database $db) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function listWatchesForUser(int $tenantId, int $userId): array
    {
        $rows = $this->db->prepare()
            ->select('*')
            ->from('research_watch')
            ->where('tenant_id=?,owner_user_id=?')
            ->assign(['tenant_id' => $tenantId, 'owner_user_id' => $userId])
            ->order('<created_at')
            ->query()
            ->fetchAll();

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getWatch(int $watchId, int $tenantId, int $userId): ?array
    {
        $row = $this->db->prepare()
            ->select('*')
            ->from('research_watch')
            ->where('watch_id=?,tenant_id=?,owner_user_id=?')
            ->assign([
                'watch_id'      => $watchId,
                'tenant_id'     => $tenantId,
                'owner_user_id' => $userId,
            ])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * Internal lookup (orchestrator callbacks) — no tenant/user scope.
     *
     * @return array<string, mixed>|null
     */
    public function getWatchById(int $watchId): ?array
    {
        $row = $this->db->prepare()
            ->select('*')
            ->from('research_watch')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listSources(int $watchId): array
    {
        $rows = $this->db->prepare()
            ->select('*')
            ->from('research_source')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->order('<sort_order,<source_id')
            ->query()
            ->fetchAll();

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getLatestRun(int $watchId): ?array
    {
        $row = $this->db->prepare()
            ->select('*')
            ->from('research_run')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->order('<created_at')
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertWatch(array $fields): int
    {
        $this->db->insert('research_watch', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function updateWatch(int $watchId, array $fields): void
    {
        if ($watchId < 1) {
            return;
        }
        $assign = $fields;
        $assign['watch_id'] = $watchId;
        $this->db->update('research_watch', array_keys($fields))
            ->where('watch_id=?')
            ->assign($assign)
            ->query();
    }

    public function deleteSourcesForWatch(int $watchId): void
    {
        if ($watchId < 1) {
            return;
        }
        $this->db->delete('research_source', ['watch_id' => $watchId])->query();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertSource(array $fields): int
    {
        $this->db->insert('research_source', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertRun(array $fields): int
    {
        $this->db->insert('research_run', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function updateRun(int $runId, array $fields): void
    {
        if ($runId < 1) {
            return;
        }
        $assign = $fields;
        $assign['run_id'] = $runId;
        $this->db->update('research_run', array_keys($fields))
            ->where('run_id=?')
            ->assign($assign)
            ->query();
    }

    /**
     * @return array<string, mixed>|null
     */
    public function findItemByUrl(int $watchId, string $url): ?array
    {
        $row = $this->db->prepare()
            ->select('*')
            ->from('research_item')
            ->where('watch_id=?,canonical_url=?')
            ->assign(['watch_id' => $watchId, 'canonical_url' => $url])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    public function listKnownUrls(int $watchId): array
    {
        $rows = $this->db->prepare()
            ->select('canonical_url')
            ->from('research_item')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $row) {
            if (\is_array($row) && isset($row['canonical_url'])) {
                $u = trim((string) $row['canonical_url']);
                if ($u !== '') {
                    $out[] = $u;
                }
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function upsertItem(int $watchId, string $url, array $fields): void
    {
        $existing = $this->findItemByUrl($watchId, $url);
        if ($existing !== null) {
            $fields['last_seen_at'] = gmdate('Y-m-d H:i:s');
            $assign = $fields;
            $assign['item_id'] = (int) ($existing['item_id'] ?? 0);
            $this->db->update('research_item', array_keys($fields))
                ->where('item_id=?')
                ->assign($assign)
                ->query();

            return;
        }

        $fields['watch_id'] = $watchId;
        $fields['canonical_url'] = $url;
        $fields['first_seen_at'] = gmdate('Y-m-d H:i:s');
        $fields['last_seen_at'] = $fields['first_seen_at'];
        $this->db->insert('research_item', array_keys($fields))
            ->assign($fields)
            ->query();
    }

    /**
     * Watches due for scheduled fetch (enabled + next_run_at <= now).
     *
     * @return list<array<string, mixed>>
     */
    public function listDueWatches(int $limit = 20): array
    {
        $limit = max(1, min(100, $limit));
        $pdo = $this->db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return [];
        }
        $sql = "SELECT * FROM oaao_research_watch
                WHERE is_enabled = 1
                  AND interval_minutes IS NOT NULL
                  AND interval_minutes > 0
                  AND next_run_at IS NOT NULL
                  AND next_run_at <= CURRENT_TIMESTAMP
                ORDER BY next_run_at ASC
                LIMIT {$limit}";
        $st = $pdo->query($sql);
        if ($st === false) {
            return [];
        }
        /** @var list<array<string, mixed>> $rows */
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        return $rows;
    }

    /**
     * @return array<string, string|null> url => content_hash
     */
    public function listKnownItemHashes(int $watchId): array
    {
        $rows = $this->db->prepare()
            ->select('canonical_url,content_hash')
            ->from('research_item')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return [];
        }
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $u = trim((string) ($row['canonical_url'] ?? ''));
            if ($u === '') {
                continue;
            }
            $hash = isset($row['content_hash']) ? trim((string) $row['content_hash']) : '';
            $out[$u] = $hash !== '' ? $hash : null;
        }

        return $out;
    }

    /** Clear stored content hashes so the worker re-fetches articles. */
    public function clearItemContentHashes(int $watchId): int
    {
        if ($watchId < 1) {
            return 0;
        }
        $this->db->update('research_item', ['content_hash'])
            ->where('watch_id=?')
            ->assign(['content_hash' => null, 'watch_id' => $watchId])
            ->query();

        return 1;
    }

    /**
     * @return list<int> unique vault document ids linked to this watch (article + summary).
     */
    public function listItemDocumentIds(int $watchId): array
    {
        if ($watchId < 1) {
            return [];
        }
        $rows = $this->db->prepare()
            ->select('document_id,summary_document_id')
            ->from('research_item')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return [];
        }
        /** @var array<int, true> $seen */
        $seen = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            foreach (['document_id', 'summary_document_id'] as $col) {
                $did = (int) ($row[$col] ?? 0);
                if ($did > 0) {
                    $seen[$did] = true;
                }
            }
        }

        return array_map('intval', array_keys($seen));
    }

    /** Clear vault links, hashes, and match metadata on all items for a watch. */
    public function clearItemStoredArtifacts(int $watchId): int
    {
        if ($watchId < 1) {
            return 0;
        }
        $this->db->update('research_item', [
            'document_id',
            'summary_document_id',
            'content_hash',
            'match_confidence',
            'match_reason',
            'match_hit',
        ])
            ->where('watch_id=?')
            ->assign([
                'document_id'         => null,
                'summary_document_id' => null,
                'content_hash'        => null,
                'match_confidence'    => null,
                'match_reason'        => null,
                'match_hit'           => null,
                'watch_id'            => $watchId,
            ])
            ->query();

        return 1;
    }

    /**
     * Queue every stored article on a watch for background refetch (one-at-a-time worker).
     */
    public function markAllItemsNeedRefetch(int $watchId): int
    {
        if ($watchId < 1) {
            return 0;
        }
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return 0;
        }
        $st = $pdo->prepare(
            'UPDATE oaao_research_item
             SET needs_refetch = :queued,
                 refetch_error = NULL
             WHERE watch_id = :watch_id
               AND TRIM(canonical_url) <> \'\'
               AND needs_refetch <> :running',
        );
        $st->execute([
            'queued'  => self::REFETCH_QUEUED,
            'running' => self::REFETCH_RUNNING,
            'watch_id'=> $watchId,
        ]);

        return (int) $st->rowCount();
    }

    /** @return array{queued: int, running: int} */
    public function countRefetchItems(int $watchId): array
    {
        $empty = ['queued' => 0, 'running' => 0];
        if ($watchId < 1) {
            return $empty;
        }
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return $empty;
        }
        $st = $pdo->prepare(
            'SELECT needs_refetch, COUNT(*)::int AS n
             FROM oaao_research_item
             WHERE watch_id = ? AND needs_refetch IN (1, 2)
             GROUP BY needs_refetch',
        );
        $st->execute([$watchId]);
        $out = $empty;
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $flag = (int) ($row['needs_refetch'] ?? 0);
            $n = (int) ($row['n'] ?? 0);
            if ($flag === self::REFETCH_QUEUED) {
                $out['queued'] = $n;
            } elseif ($flag === self::REFETCH_RUNNING) {
                $out['running'] = $n;
            }
        }

        return $out;
    }

    /** @return array<string, mixed>|null */
    public function getRefetchRunningItem(int $watchId): ?array
    {
        if ($watchId < 1) {
            return null;
        }
        /** @var array<string, mixed>|false $row */
        $row = $this->db->prepare()
            ->select('item_id, canonical_url, title, refetch_started_at')
            ->from('research_item')
            ->where('watch_id=?,needs_refetch=?')
            ->assign(['watch_id' => $watchId, 'needs_refetch' => self::REFETCH_RUNNING])
            ->limit(1)
            ->query()
            ->fetch();

        return $row !== false && \is_array($row) ? $row : null;
    }

    /** @return array{queued: int, running: int} */
    public function countAllRefetchItems(): array
    {
        $empty = ['queued' => 0, 'running' => 0];
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return $empty;
        }
        $st = $pdo->query(
            'SELECT needs_refetch, COUNT(*)::int AS n
             FROM oaao_research_item
             WHERE needs_refetch IN (1, 2)
             GROUP BY needs_refetch',
        );
        if ($st === false) {
            return $empty;
        }
        $out = $empty;
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $flag = (int) ($row['needs_refetch'] ?? 0);
            $n = (int) ($row['n'] ?? 0);
            if ($flag === self::REFETCH_QUEUED) {
                $out['queued'] = $n;
            } elseif ($flag === self::REFETCH_RUNNING) {
                $out['running'] = $n;
            }
        }

        return $out;
    }

    /**
     * Re-queue orphan refetch rows (orchestrator restart / worker died mid-item).
     *
     * @param int $maxAgeSec 0 = reset all running; otherwise only rows older than this many seconds
     */
    public function resetOrphanRefetchItems(int $maxAgeSec = 0): int
    {
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return 0;
        }
        if ($maxAgeSec < 1) {
            $st = $pdo->prepare(
                'UPDATE oaao_research_item
                 SET needs_refetch = :queued, refetch_started_at = NULL
                 WHERE needs_refetch = :running',
            );
            $st->execute(['queued' => self::REFETCH_QUEUED, 'running' => self::REFETCH_RUNNING]);
        } else {
            $st = $pdo->prepare(
                'UPDATE oaao_research_item
                 SET needs_refetch = :queued, refetch_started_at = NULL
                 WHERE needs_refetch = :running
                   AND refetch_started_at IS NOT NULL
                   AND refetch_started_at < CURRENT_TIMESTAMP - make_interval(secs => :max_age)',
            );
            $st->execute([
                'queued'   => self::REFETCH_QUEUED,
                'running'  => self::REFETCH_RUNNING,
                'max_age'  => max(1, $maxAgeSec),
            ]);
        }

        return (int) $st->rowCount();
    }

    /**
     * Claim one queued refetch item (global single-flight — at most one running).
     *
     * @return array<string, mixed>|null
     */
    public function claimRefetchItem(): ?array
    {
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return null;
        }

        $pdo->beginTransaction();
        try {
            $stale = $pdo->prepare(
                'UPDATE oaao_research_item
                 SET needs_refetch = :queued, refetch_started_at = NULL
                 WHERE needs_refetch = :running
                   AND refetch_started_at IS NOT NULL
                   AND refetch_started_at < CURRENT_TIMESTAMP - INTERVAL \'10 minutes\'',
            );
            $stale->execute([
                'queued'  => self::REFETCH_QUEUED,
                'running' => self::REFETCH_RUNNING,
            ]);

            $sql = <<<'SQL'
WITH busy AS (
    SELECT 1 FROM oaao_research_item WHERE needs_refetch = 2 LIMIT 1
),
picked AS (
    SELECT i.item_id
    FROM oaao_research_item i
    WHERE i.needs_refetch = 1
      AND NOT EXISTS (SELECT 1 FROM busy)
    ORDER BY i.last_seen_at ASC NULLS FIRST, i.item_id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE oaao_research_item i
SET needs_refetch = 2,
    refetch_started_at = CURRENT_TIMESTAMP,
    refetch_error = NULL
FROM picked p
INNER JOIN oaao_research_watch w ON w.watch_id = (
    SELECT ri.watch_id FROM oaao_research_item ri WHERE ri.item_id = p.item_id
)
WHERE i.item_id = p.item_id
RETURNING i.*,
          w.vault_id AS watch_vault_id,
          w.container_id AS watch_container_id,
          w.workspace_id AS watch_workspace_id,
          w.summary_language AS watch_summary_language,
          w.owner_user_id AS watch_owner_user_id,
          w.config_json AS watch_config_json
SQL;
            $claim = $pdo->query($sql);
            /** @var array<string, mixed>|false $row */
            $row = $claim ? $claim->fetch(\PDO::FETCH_ASSOC) : false;
            $pdo->commit();

            return $row !== false ? $row : null;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }
    }

    public function finishRefetchItem(int $itemId, string $status, ?string $errorText = null): void
    {
        if ($itemId < 1) {
            return;
        }
        $fields = [
            'needs_refetch'       => $status === 'done' ? self::REFETCH_OFF : self::REFETCH_QUEUED,
            'refetch_started_at'  => null,
            'refetch_error'       => $status === 'failed' && $errorText !== null && $errorText !== ''
                ? mb_substr($errorText, 0, 2000)
                : null,
        ];
        $assign = $fields;
        $assign['item_id'] = $itemId;
        $this->db->update('research_item', array_keys($fields))
            ->where('item_id=?')
            ->assign($assign)
            ->query();
    }

    /**
     * @param list<int> $vaultIds
     *
     * @return array<int, string> document_id => queued|running
     */
    public function refetchStatusByDocumentIds(array $vaultIds): array
    {
        $vaultIds = array_values(array_filter(array_map('intval', $vaultIds), static fn (int $id): bool => $id > 0));
        if ($vaultIds === []) {
            return [];
        }
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return [];
        }
        $ph = implode(',', array_fill(0, \count($vaultIds), '?'));
        $sql = "SELECT i.document_id, i.summary_document_id, i.needs_refetch
                FROM oaao_research_item i
                INNER JOIN oaao_research_watch w ON i.watch_id = w.watch_id
                WHERE w.vault_id IN ({$ph})
                  AND i.needs_refetch IN (1, 2)";
        $st = $pdo->prepare($sql);
        $st->execute($vaultIds);
        /** @var array<int, string> $out */
        $out = [];
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $flag = (int) ($row['needs_refetch'] ?? 0);
            $label = $flag === self::REFETCH_RUNNING ? 'running' : 'queued';
            foreach (['document_id', 'summary_document_id'] as $col) {
                $did = (int) ($row[$col] ?? 0);
                if ($did > 0) {
                    $out[$did] = $label;
                }
            }
        }

        return $out;
    }

    /** Clear vault links on one item after its files were purged pre-refetch. */
    public function clearItemArtifactLinks(int $itemId): void
    {
        if ($itemId < 1) {
            return;
        }
        $this->db->update('research_item', [
            'document_id',
            'summary_document_id',
            'content_hash',
            'match_confidence',
            'match_reason',
            'match_hit',
        ])
            ->where('item_id=?')
            ->assign([
                'document_id'         => null,
                'summary_document_id' => null,
                'content_hash'        => null,
                'match_confidence'    => null,
                'match_reason'        => null,
                'match_hit'           => null,
                'item_id'             => $itemId,
            ])
            ->query();
    }

    /**
     * Known articles to re-fetch (Refetch all — not limited to current index page).
     *
     * @return list<array{canonical_url: string, title: string|null, source_id: int|null}>
     */
    public function listItemsForRefetch(int $watchId): array
    {
        if ($watchId < 1) {
            return [];
        }
        $rows = $this->db->prepare()
            ->select('canonical_url,title')
            ->from('research_item')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return [];
        }
        /** @var list<array{canonical_url: string, title: string|null, source_id: int|null}> $out */
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $url = trim((string) ($row['canonical_url'] ?? ''));
            if ($url === '') {
                continue;
            }
            $title = isset($row['title']) ? trim((string) $row['title']) : '';
            $out[] = [
                'canonical_url' => $url,
                'title'         => $title !== '' ? $title : null,
                'source_id'     => null,
            ];
        }

        return $out;
    }

    /** Drop stale queued jobs before a refetch run enqueues fresh work. */
    public function clearQueuedFetchJobs(int $watchId): int
    {
        if ($watchId < 1) {
            return 0;
        }
        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return 0;
        }
        $st = $pdo->prepare(
            "DELETE FROM oaao_research_fetch_job WHERE watch_id = ? AND status = 'queued'",
        );
        $st->execute([$watchId]);

        return (int) $st->rowCount();
    }

    /** Remove last_index_hash from all sources so index pages are re-scanned. */
    public function clearSourceIndexHashes(int $watchId): int
    {
        if ($watchId < 1) {
            return 0;
        }
        $rows = $this->db->prepare()
            ->select('source_id,config_json')
            ->from('research_source')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return 0;
        }
        $n = 0;
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $sourceId = (int) ($row['source_id'] ?? 0);
            if ($sourceId < 1) {
                continue;
            }
            $cfg = [];
            $raw = $row['config_json'] ?? null;
            if (\is_string($raw) && trim($raw) !== '') {
                try {
                    $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($dec)) {
                        $cfg = $dec;
                    }
                } catch (\JsonException) {
                    $cfg = [];
                }
            }
            unset($cfg['last_index_hash'], $cfg['html_hash']);
            try {
                $encoded = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            $this->db->update('research_source', ['config_json'])
                ->where('source_id=?')
                ->assign(['config_json' => $encoded, 'source_id' => $sourceId])
                ->query();
            $n++;
        }

        return $n;
    }

    /**
     * @param list<array{canonical_url: string, title?: string|null, source_id?: int|null, sort_order?: int}> $jobs
     */
    public function enqueueFetchJobs(int $runId, int $watchId, array $jobs): int
    {
        $n = 0;
        foreach ($jobs as $job) {
            if (! \is_array($job)) {
                continue;
            }
            $url = trim((string) ($job['canonical_url'] ?? ''));
            if ($url === '') {
                continue;
            }
            $sourceId = isset($job['source_id']) ? (int) $job['source_id'] : 0;
            $this->db->insert('research_fetch_job', [
                'run_id', 'watch_id', 'source_id', 'canonical_url', 'title', 'sort_order', 'status', 'created_at',
            ])->assign([
                'run_id'        => $runId,
                'watch_id'      => $watchId,
                'source_id'     => $sourceId > 0 ? $sourceId : null,
                'canonical_url' => $url,
                'title'         => isset($job['title']) ? (string) $job['title'] : null,
                'sort_order'    => (int) ($job['sort_order'] ?? $n),
                'status'        => 'queued',
                'created_at'    => gmdate('Y-m-d H:i:s'),
            ])->query();
            $n++;
        }

        return $n;
    }

    /**
     * @param array<string, mixed> $merge
     */
    public function patchSourceConfig(int $sourceId, array $merge): void
    {
        if ($sourceId < 1 || $merge === []) {
            return;
        }
        $row = $this->db->prepare()
            ->select('config_json')
            ->from('research_source')
            ->where('source_id=?')
            ->assign(['source_id' => $sourceId])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row)) {
            return;
        }
        $cfg = [];
        $raw = $row['config_json'] ?? null;
        if (\is_string($raw) && trim($raw) !== '') {
            try {
                $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($dec)) {
                    $cfg = $dec;
                }
            } catch (\JsonException) {
                $cfg = [];
            }
        }
        foreach ($merge as $k => $v) {
            $cfg[(string) $k] = $v;
        }
        try {
            $encoded = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return;
        }
        $this->db->update('research_source', ['config_json'])
            ->where('source_id=?')
            ->assign(['config_json' => $encoded, 'source_id' => $sourceId])
            ->query();
    }

    /**
     * @param array<string, mixed> $merge
     */
    public function patchWatchConfig(int $watchId, array $merge): void
    {
        if ($watchId < 1 || $merge === []) {
            return;
        }
        $row = $this->db->prepare()
            ->select('config_json')
            ->from('research_watch')
            ->where('watch_id=?')
            ->assign(['watch_id' => $watchId])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row)) {
            return;
        }
        $cfg = [];
        $raw = $row['config_json'] ?? null;
        if (\is_string($raw) && trim($raw) !== '') {
            try {
                $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($dec)) {
                    $cfg = $dec;
                }
            } catch (\JsonException) {
                $cfg = [];
            }
        }
        foreach ($merge as $k => $v) {
            $cfg[(string) $k] = $v;
        }
        try {
            $encoded = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return;
        }
        $this->db->update('research_watch', ['config_json'])
            ->where('watch_id=?')
            ->assign(['config_json' => $encoded, 'watch_id' => $watchId])
            ->query();
    }

    /**
     * @return array{
     *     counts: array<string, int>,
     *     pending_jobs: list<array<string, mixed>>,
     *     next_job: array<string, mixed>|null,
     *     last_enqueued: array<string, mixed>|null,
     *     last_finished: array<string, mixed>|null,
     *     pending: int
     * }
     */
    public function getFetchQueueStatus(int $watchId): array
    {
        $empty = [
            'counts'        => [],
            'pending_jobs'  => [],
            'next_job'      => null,
            'last_enqueued' => null,
            'last_finished' => null,
            'pending'       => 0,
        ];
        if ($watchId < 1) {
            return $empty;
        }

        $pdo = $this->db->getDBAdapter();
        if (! ($pdo instanceof \PDO)) {
            return $empty;
        }

        $counts = [
            'queued'  => 0,
            'running' => 0,
            'done'    => 0,
            'skipped' => 0,
            'failed'  => 0,
        ];
        $st = $pdo->prepare(
            'SELECT status, COUNT(*)::int AS n FROM oaao_research_fetch_job WHERE watch_id = ? GROUP BY status',
        );
        $st->execute([$watchId]);
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $key = (string) ($row['status'] ?? '');
            if ($key !== '') {
                $counts[$key] = (int) ($row['n'] ?? 0);
            }
        }

        $pendingSt = $pdo->prepare(
            "SELECT job_id, run_id, canonical_url, title, status, sort_order, created_at, claimed_at, error_text
             FROM oaao_research_fetch_job
             WHERE watch_id = ? AND status IN ('queued', 'running')
             ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, sort_order ASC, created_at ASC
             LIMIT 8",
        );
        $pendingSt->execute([$watchId]);
        /** @var list<array<string, mixed>> $pendingJobs */
        $pendingJobs = $pendingSt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        $lastEnqSt = $pdo->prepare(
            'SELECT job_id, run_id, canonical_url, title, status, created_at
             FROM oaao_research_fetch_job
             WHERE watch_id = ?
             ORDER BY created_at DESC, job_id DESC
             LIMIT 1',
        );
        $lastEnqSt->execute([$watchId]);
        /** @var array<string, mixed>|false $lastEnqueued */
        $lastEnqueued = $lastEnqSt->fetch(\PDO::FETCH_ASSOC);

        $lastFinSt = $pdo->prepare(
            "SELECT job_id, canonical_url, title, status, finished_at, error_text
             FROM oaao_research_fetch_job
             WHERE watch_id = ? AND finished_at IS NOT NULL
             ORDER BY finished_at DESC, job_id DESC
             LIMIT 1",
        );
        $lastFinSt->execute([$watchId]);
        /** @var array<string, mixed>|false $lastFinished */
        $lastFinished = $lastFinSt->fetch(\PDO::FETCH_ASSOC);

        $nextJob = $pendingJobs[0] ?? null;
        $pending = $counts['queued'] + $counts['running'];
        $refetch = $this->countRefetchItems($watchId);
        $refetchRunning = $this->getRefetchRunningItem($watchId);

        return [
            'counts'        => $counts,
            'pending_jobs'  => $pendingJobs,
            'next_job'      => \is_array($nextJob) ? $nextJob : null,
            'last_enqueued' => $lastEnqueued !== false ? $lastEnqueued : null,
            'last_finished' => $lastFinished !== false ? $lastFinished : null,
            'pending'       => $pending,
            'refetch'       => $refetch,
            'refetch_pending' => $refetch['queued'] + $refetch['running'],
            'refetch_running_item' => $refetchRunning,
        ];
    }
}
