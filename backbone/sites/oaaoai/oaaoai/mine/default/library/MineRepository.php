<?php

declare(strict_types=1);

namespace oaaoai\mine;

use Razy\Database;

/**
 * CRUD for {@code oaao_mine_*} tables.
 */
final class MineRepository
{
    public function __construct(private readonly Database $db) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function listMinesForUser(int $tenantId, int $userId): array
    {
        $rows = $this->db->prepare()
            ->select('*')
            ->from('mine')
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
    public function getMine(int $mineId, int $tenantId, int $userId): ?array
    {
        $row = $this->db->prepare()
            ->select('*')
            ->from('mine')
            ->where('mine_id=?,tenant_id=?,owner_user_id=?')
            ->assign([
                'mine_id'       => $mineId,
                'tenant_id'     => $tenantId,
                'owner_user_id' => $userId,
            ])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listSources(int $mineId): array
    {
        $rows = $this->db->prepare()
            ->select('*')
            ->from('mine_source')
            ->where('mine_id=?', ['mine_id' => $mineId])
            ->order('<sort_order,<source_id')
            ->query()
            ->fetchAll();

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getLatestRun(int $mineId): ?array
    {
        $row = $this->db->prepare()
            ->select('*')
            ->from('mine_run')
            ->where('mine_id=?', ['mine_id' => $mineId])
            ->order('<created_at')
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertMine(array $fields): int
    {
        $this->db->insert('mine', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function updateMine(int $mineId, array $fields): void
    {
        $this->db->update('mine', array_keys($fields))
            ->assign($fields)
            ->where('mine_id=?', ['mine_id' => $mineId])
            ->query();
    }

    public function deleteMine(int $mineId): void
    {
        $this->db->delete('mine', ['mine_id' => $mineId])->query();
    }

    public function deleteSourcesForMine(int $mineId): void
    {
        $this->db->delete('mine_source')
            ->where('mine_id=?', ['mine_id' => $mineId])
            ->query();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertSource(array $fields): int
    {
        $this->db->insert('mine_source', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertRun(array $fields): int
    {
        $this->db->insert('mine_run', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function updateRun(int $runId, array $fields): void
    {
        $this->db->update('mine_run', array_keys($fields))
            ->assign($fields)
            ->where('run_id=?', ['run_id' => $runId])
            ->query();
    }

    /**
     * Mines due for scheduled run (enabled + next_run_at <= now).
     *
     * @return list<array<string, mixed>>
     */
    public function listDueMines(int $limit = 20): array
    {
        $limit = max(1, min(100, $limit));
        $pdo = $this->db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return [];
        }
        $sql = "SELECT * FROM oaao_mine
                WHERE is_enabled = 1
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
}
