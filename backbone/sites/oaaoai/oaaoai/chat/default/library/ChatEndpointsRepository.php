<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Oaaoai\Core\TenantContext;
use oaaoai\endpoints\CanonicalEndpointsRepository;
use Razy\Database;

/**
 * Chat completion profiles on the canonical DB — logical tables {@code chat_endpoint} + {@code chat_endpoint_llm}
 * ({@code oaao_*} prefix via {@see Database::setPrefix}).
 */
final class ChatEndpointsRepository
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
            TenantContext::bootstrap($pdo);
        }

        return TenantContext::id();
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listProfiles(): array
    {
        $q = $this->db->prepare()
            ->select('*')
            ->from('chat_endpoint');
        $tid = $this->scopedTenantId();
        if ($tid > 0) {
            $q = $q->where('tenant_id=:oaao_tid')->assign(['oaao_tid' => $tid]);
        }
        $rawProfiles = $q->order('+id')->query()->fetchAll();
        $rows = \is_array($rawProfiles) ? $rawProfiles : [];
        if ($rows === []) {
            return [];
        }

        $canon = new CanonicalEndpointsRepository($this->db);
        /** @var array<int, array{endpoint_name: string, endpoint_model: string}> */
        $epMeta = [];
        foreach ($canon->listEndpoints() as $er) {
            if (! \is_array($er) || ! isset($er['id'])) {
                continue;
            }
            $eid = (int) $er['id'];
            if ($eid < 1) {
                continue;
            }
            $epMeta[$eid] = [
                'endpoint_name'  => (string) ($er['name'] ?? ''),
                'endpoint_model' => (string) ($er['model'] ?? ''),
            ];
        }

        $rawLlms = $this->db->prepare()
            ->select('id, chat_endpoint_id, endpoint_id, role')
            ->from('chat_endpoint_llm')
            ->order('+chat_endpoint_id,+id')
            ->query()
            ->fetchAll();

        /** @var array<int, list<array<string, mixed>>> */
        $byProfile = [];
        if (\is_array($rawLlms)) {
            foreach ($rawLlms as $lr) {
                if (! \is_array($lr)) {
                    continue;
                }
                $cid = (int) ($lr['chat_endpoint_id'] ?? 0);
                $eid = (int) ($lr['endpoint_id'] ?? 0);
                if ($cid < 1 || $eid < 1 || ! isset($epMeta[$eid])) {
                    continue;
                }
                $lr['endpoint_name'] = $epMeta[$eid]['endpoint_name'];
                $lr['endpoint_model'] = $epMeta[$eid]['endpoint_model'];
                $byProfile[$cid][] = $lr;
            }
        }

        $out = [];
        foreach ($rows as $r) {
            if (! \is_array($r) || ! isset($r['id'])) {
                continue;
            }
            $id = (int) $r['id'];
            $r['llms'] = $byProfile[$id] ?? [];
            $out[] = $r;
        }

        return $out;
    }

    public function profileExists(int $id): bool
    {
        if ($id < 1) {
            return false;
        }
        $where = 'id=?';
        $params = ['id' => $id];
        $tid = $this->scopedTenantId();
        if ($tid > 0) {
            $where .= ',tenant_id=:oaao_tid';
            $params['oaao_tid'] = $tid;
        }
        $row = $this->db->prepare()
            ->select('id')
            ->from('chat_endpoint')
            ->where($where)
            ->assign($params)
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) && isset($row['id']);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getProfile(int $id): ?array
    {
        if ($id < 1) {
            return null;
        }
        $where = 'id=?';
        $params = ['id' => $id];
        $tid = $this->scopedTenantId();
        if ($tid > 0) {
            $where .= ',tenant_id=:oaao_tid';
            $params['oaao_tid'] = $tid;
        }
        $row = $this->db->prepare()
            ->select('*')
            ->from('chat_endpoint')
            ->where($where)
            ->assign($params)
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @param list<array{endpoint_id: int, role: string}> $llms
     *
     * @return int new or updated profile id
     */
    public function saveProfile(
        int $id,
        string $name,
        string $type,
        int $isEnabled,
        int $isDefault,
        ?string $configJson,
        ?int $createdBy,
        string $nowUtc,
        array $llms,
    ): int {
        $canon = new CanonicalEndpointsRepository($this->db);

        foreach ($llms as $row) {
            $eid = (int) ($row['endpoint_id'] ?? 0);
            if ($eid < 1 || ! $canon->endpointRowExists($eid)) {
                throw new \InvalidArgumentException('Invalid endpoint_id in LLM binding');
            }
        }

        $pdo = $this->db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            throw new \RuntimeException('PDO adapter required');
        }

        $pdo->beginTransaction();
        try {
            $tid = $this->scopedTenantId();
            if ($isDefault === 1) {
                $idsQ = $this->db->prepare()->select('id')->from('chat_endpoint');
                if ($tid > 0) {
                    $idsQ = $idsQ->where('tenant_id=:oaao_tid')->assign(['oaao_tid' => $tid]);
                }
                $idsRaw = $idsQ->order('+id')->query()->fetchAll();
                foreach (\is_array($idsRaw) ? $idsRaw : [] as $idr) {
                    if (! \is_array($idr) || ! isset($idr['id'])) {
                        continue;
                    }
                    $rid = (int) $idr['id'];
                    $clearWhere = 'id=?';
                    $clearParams = ['is_default' => 0, 'id' => $rid];
                    if ($tid > 0) {
                        $clearWhere .= ',tenant_id=:oaao_tid';
                        $clearParams['oaao_tid'] = $tid;
                    }
                    $this->db->update('chat_endpoint', ['is_default'])
                        ->where($clearWhere)
                        ->assign($clearParams)
                        ->query();
                }
            }

            if ($id > 0) {
                $updWhere = 'id=?';
                $updParams = [
                    'name'        => $name,
                    'type'        => $type,
                    'is_enabled'  => $isEnabled,
                    'is_default'  => $isDefault,
                    'config_json' => $configJson,
                    'updated_at'  => $nowUtc,
                    'id'          => $id,
                ];
                if ($tid > 0) {
                    $updWhere .= ',tenant_id=:oaao_tid';
                    $updParams['oaao_tid'] = $tid;
                }
                $this->db->update('chat_endpoint', ['name', 'type', 'is_enabled', 'is_default', 'config_json', 'updated_at'])
                    ->where($updWhere)
                    ->assign($updParams)
                    ->query();
                $this->db->delete('chat_endpoint_llm', ['chat_endpoint_id' => $id])->query();
                $profileId = $id;
            } else {
                $cols = ['name', 'type', 'is_enabled', 'is_default', 'config_json', 'created_by', 'created_at', 'updated_at'];
                $insParams = [
                    'name'        => $name,
                    'type'        => $type,
                    'is_enabled'  => $isEnabled,
                    'is_default'  => $isDefault,
                    'config_json' => $configJson,
                    'created_by'  => $createdBy,
                    'created_at'  => $nowUtc,
                    'updated_at'  => $nowUtc,
                ];
                if ($tid > 0 && $this->isPgsql()) {
                    $cols[] = 'tenant_id';
                    $insParams['tenant_id'] = $tid;
                }
                $this->db->insert('chat_endpoint', $cols)
                    ->assign($insParams)
                    ->query();
                $profileId = (int) $this->db->lastID();
                if ($profileId < 1) {
                    throw new \RuntimeException('Insert did not return profile id');
                }
            }

            foreach ($llms as $row) {
                $role = strtolower(trim((string) ($row['role'] ?? '')));
                if ($role === '') {
                    $role = 'default';
                }
                $this->db->insert('chat_endpoint_llm', ['chat_endpoint_id', 'endpoint_id', 'role'])
                    ->assign([
                        'chat_endpoint_id' => $profileId,
                        'endpoint_id'      => (int) $row['endpoint_id'],
                        'role'             => $role,
                    ])
                    ->query();
            }

            $pdo->commit();

            return $profileId;
        } catch (\Throwable $e) {
            try {
                $pdo->rollBack();
            } catch (\Throwable) {
            }
            throw $e;
        }
    }

    public function deleteProfile(int $id): int
    {
        if ($id < 1) {
            return 0;
        }
        $tid = $this->scopedTenantId();
        $this->db->delete('chat_endpoint_llm', ['chat_endpoint_id' => $id])->query();

        if ($tid > 0 && $this->isPgsql()) {
            return $this->db->delete('chat_endpoint', ['id' => $id, 'tenant_id' => $tid])->query()->affected();
        }

        return $this->db->delete('chat_endpoint', ['id' => $id])->query()->affected();
    }
}
