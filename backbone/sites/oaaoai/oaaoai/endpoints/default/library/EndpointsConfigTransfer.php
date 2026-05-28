<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Export / import {@code oaao_endpoint} + {@code oaao_purpose} for environment migration.
 *
 * Uses natural keys ({@code name}, {@code purpose_key}) — not surrogate IDs.
 * Secrets are never exported; only {@code api_key_ref} env/vault names.
 */
final class EndpointsConfigTransfer
{
    public const SCHEMA_VERSION = 1;

    public function __construct(
        private readonly \PDO $pdo,
        private readonly string $prefix = 'oaao_',
        private readonly int $tenantId = 0,
    ) {
        $this->pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    }

    public function isPgsql(): bool
    {
        return $this->pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql';
    }

    private function epTable(): string
    {
        return preg_replace('/[^a-zA-Z0-9_]/', '', $this->prefix) . 'endpoint';
    }

    private function puTable(): string
    {
        return preg_replace('/[^a-zA-Z0-9_]/', '', $this->prefix) . 'purpose';
    }

    /**
     * @return array<string, mixed>
     */
    public function export(): array
    {
        $endpoints = $this->fetchEndpointsForExport();
        $purposes = $this->isPgsql() ? $this->fetchPurposesForExport($endpoints) : [];

        return [
            'schema_version' => self::SCHEMA_VERSION,
            'exported_at'    => gmdate('c'),
            'database_driver' => $this->isPgsql() ? 'pgsql' : 'sqlite',
            'tenant_id'      => $this->tenantId > 0 ? $this->tenantId : null,
            'endpoints'      => $endpoints,
            'purposes'       => $purposes,
        ];
    }

    /**
     * @param array<string, mixed> $bundle
     *
     * @return array{
     *   endpoints_created: int,
     *   endpoints_updated: int,
     *   purposes_created: int,
     *   purposes_updated: int,
     *   warnings: list<string>
     * }
     */
    public function import(array $bundle, bool $dryRun = false): array
    {
        $result = [
            'endpoints_created' => 0,
            'endpoints_updated' => 0,
            'purposes_created'  => 0,
            'purposes_updated'  => 0,
            'warnings'          => [],
        ];

        if ((int) ($bundle['schema_version'] ?? 0) !== self::SCHEMA_VERSION) {
            throw new \InvalidArgumentException(
                'Unsupported schema_version: ' . (string) ($bundle['schema_version'] ?? 'missing')
            );
        }

        $endpointRows = $bundle['endpoints'] ?? [];
        $purposeRows = $bundle['purposes'] ?? [];
        if (! \is_array($endpointRows)) {
            throw new \InvalidArgumentException('endpoints must be an array');
        }
        if (! \is_array($purposeRows)) {
            throw new \InvalidArgumentException('purposes must be an array');
        }

        if ($purposeRows !== [] && ! $this->isPgsql()) {
            throw new \RuntimeException('Purposes require PostgreSQL (canonical auth database.driver=pgsql).');
        }

        if ($dryRun) {
            $this->pdo->beginTransaction();
        } else {
            $this->pdo->beginTransaction();
        }

        try {
            /** @var array<string, int> $idByName */
            $idByName = [];
            foreach ($endpointRows as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $action = $this->upsertEndpoint($row, $dryRun);
                if ($action === 'created') {
                    ++$result['endpoints_created'];
                } elseif ($action === 'updated') {
                    ++$result['endpoints_updated'];
                }
                $name = trim((string) ($row['name'] ?? ''));
                if ($name !== '') {
                    $resolved = $this->findEndpointIdByName($name, $this->resolveRowTenantId($row));
                    if ($resolved !== null) {
                        $idByName[$name] = $resolved;
                    }
                }
            }

            foreach ($purposeRows as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $action = $this->upsertPurpose($row, $idByName, $dryRun, $result['warnings']);
                if ($action === 'created') {
                    ++$result['purposes_created'];
                } elseif ($action === 'updated') {
                    ++$result['purposes_updated'];
                }
            }

            if ($dryRun) {
                $this->pdo->rollBack();
            } else {
                $this->pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return $result;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function fetchEndpointsForExport(): array
    {
        $table = $this->epTable();
        if ($this->tenantId > 0 && $this->isPgsql()) {
            $stmt = $this->pdo->prepare(
                "SELECT * FROM {$table} WHERE tenant_id = :tid ORDER BY id ASC"
            );
            $stmt->execute(['tid' => $this->tenantId]);
        } else {
            $stmt = $this->pdo->query("SELECT * FROM {$table} ORDER BY id ASC");
        }
        $rows = $stmt ? $stmt->fetchAll(\PDO::FETCH_ASSOC) : [];

        $out = [];
        foreach ($rows ?: [] as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $out[] = $this->normalizeEndpointExportRow($row);
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $exportedEndpoints
     *
     * @return list<array<string, mixed>>
     */
    private function fetchPurposesForExport(array $exportedEndpoints): array
    {
        $table = $this->puTable();
        /** @var array<int, string> $nameById */
        $nameById = [];
        $stmt = $this->pdo->query("SELECT id, name FROM {$this->epTable()}");
        foreach ($stmt ? $stmt->fetchAll(\PDO::FETCH_ASSOC) : [] as $epRow) {
            if (! \is_array($epRow)) {
                continue;
            }
            $nameById[(int) ($epRow['id'] ?? 0)] = (string) ($epRow['name'] ?? '');
        }

        if ($this->tenantId > 0) {
            $stmt = $this->pdo->prepare(
                "SELECT * FROM {$table} WHERE tenant_id IS NULL OR tenant_id = :tid ORDER BY sort_order ASC, purpose_key ASC"
            );
            $stmt->execute(['tid' => $this->tenantId]);
            $raw = $stmt->fetchAll(\PDO::FETCH_ASSOC);
            $rows = $this->mergePurposeRowsByKey(
                $this->filterPurposeRows($raw ?: [], null),
                $this->filterPurposeRows($raw ?: [], $this->tenantId),
            );
        } else {
            $stmt = $this->pdo->query("SELECT * FROM {$table} ORDER BY sort_order ASC, purpose_key ASC, tenant_id ASC NULLS FIRST");
            $rows = $stmt ? $stmt->fetchAll(\PDO::FETCH_ASSOC) : [];
        }

        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $deid = isset($row['default_endpoint_id']) ? (int) $row['default_endpoint_id'] : 0;
            $item = [
                'purpose_key'           => (string) ($row['purpose_key'] ?? ''),
                'label'                 => (string) ($row['label'] ?? ''),
                'description'           => isset($row['description']) ? (string) $row['description'] : null,
                'default_endpoint_name' => ($deid > 0 && isset($nameById[$deid])) ? $nameById[$deid] : null,
                'is_enabled'            => (int) ($row['is_enabled'] ?? 1),
                'sort_order'            => (int) ($row['sort_order'] ?? 500),
                'meta_json'             => $this->decodeJsonField($row['meta_json'] ?? null),
            ];
            $tidRaw = $row['tenant_id'] ?? null;
            if ($tidRaw !== null && $tidRaw !== '') {
                $item['tenant_id'] = (int) $tidRaw;
            }
            $out[] = $item;
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $rows
     *
     * @return list<array<string, mixed>>
     */
    private function filterPurposeRows(array $rows, ?int $tenantId): array
    {
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $tidRaw = $row['tenant_id'] ?? null;
            $isNull = $tidRaw === null || $tidRaw === '';
            if ($tenantId === null) {
                if ($isNull) {
                    $out[] = $row;
                }
            } elseif ((int) $tidRaw === $tenantId) {
                $out[] = $row;
            }
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $global
     * @param list<array<string, mixed>> $tenant
     *
     * @return list<array<string, mixed>>
     */
    private function mergePurposeRowsByKey(array $global, array $tenant): array
    {
        /** @var array<string, array<string, mixed>> $byKey */
        $byKey = [];
        foreach ($global as $row) {
            $key = (string) ($row['purpose_key'] ?? '');
            if ($key !== '') {
                $byKey[$key] = $row;
            }
        }
        foreach ($tenant as $row) {
            $key = (string) ($row['purpose_key'] ?? '');
            if ($key !== '') {
                $byKey[$key] = $row;
            }
        }
        $merged = array_values($byKey);
        usort(
            $merged,
            static fn(array $a, array $b): int => [($a['sort_order'] ?? 0), ($a['purpose_key'] ?? '')]
                <=> [($b['sort_order'] ?? 0), ($b['purpose_key'] ?? '')]
        );

        return $merged;
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>
     */
    private function normalizeEndpointExportRow(array $row): array
    {
        $item = [
            'name'          => (string) ($row['name'] ?? ''),
            'endpoint_type' => (string) ($row['endpoint_type'] ?? 'chat'),
            'base_url'      => isset($row['base_url']) ? (string) $row['base_url'] : null,
            'model'         => (string) ($row['model'] ?? ''),
            'api_key_ref'   => isset($row['api_key_ref']) ? (string) $row['api_key_ref'] : null,
            'is_enabled'    => (int) ($row['is_enabled'] ?? 1),
            'config_json'   => $this->decodeJsonField($row['config_json'] ?? null),
        ];
        $tidRaw = $row['tenant_id'] ?? null;
        if ($tidRaw !== null && $tidRaw !== '') {
            $item['tenant_id'] = (int) $tidRaw;
        }

        return $item;
    }

    /**
     * @return 'created'|'updated'|'skipped'
     */
    private function upsertEndpoint(array $row, bool $dryRun): string
    {
        $name = trim((string) ($row['name'] ?? ''));
        $model = trim((string) ($row['model'] ?? ''));
        if ($name === '' || $model === '') {
            return 'skipped';
        }

        $fields = [
            'name'          => $name,
            'endpoint_type' => trim((string) ($row['endpoint_type'] ?? 'chat')) ?: 'chat',
            'base_url'      => $this->nullableTrim($row['base_url'] ?? null),
            'model'         => $model,
            'api_key_ref'   => $this->nullableTrim($row['api_key_ref'] ?? null),
            'is_enabled'    => (int) ($row['is_enabled'] ?? 1) ? 1 : 0,
            'config_json'   => $this->encodeJsonField($row['config_json'] ?? null),
            'updated_at'    => gmdate('Y-m-d H:i:s'),
        ];

        $existingId = $this->findEndpointIdByName($name, $this->resolveRowTenantId($row));
        $table = $this->epTable();

        if ($existingId !== null) {
            if ($dryRun) {
                return 'updated';
            }
            $sets = [];
            foreach (array_keys($fields) as $col) {
                $sets[] = "{$col} = :{$col}";
            }
            $sql = "UPDATE {$table} SET " . implode(', ', $sets) . ' WHERE id = :id';
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute(array_merge($fields, ['id' => $existingId]));

            return 'updated';
        }

        if ($dryRun) {
            return 'created';
        }

        $fields['created_at'] = gmdate('Y-m-d H:i:s');
        $cols = array_keys($fields);
        $rowTenantId = $this->resolveRowTenantId($row);
        if ($rowTenantId !== null && $this->isPgsql()) {
            $fields['tenant_id'] = $rowTenantId;
            $cols[] = 'tenant_id';
        }
        $placeholders = array_map(static fn(string $c): string => ':' . $c, $cols);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $placeholders) . ')';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($fields);

        return 'created';
    }

    /**
     * @param array<string, int> $idByName
     * @param list<string>       $warnings
     *
     * @return 'created'|'updated'|'skipped'
     */
    private function upsertPurpose(array $row, array $idByName, bool $dryRun, array &$warnings): string
    {
        $purposeKey = trim((string) ($row['purpose_key'] ?? ''));
        $label = trim((string) ($row['label'] ?? ''));
        if ($purposeKey === '' || $label === '') {
            return 'skipped';
        }

        if (! preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/', $purposeKey)) {
            $warnings[] = "Skipped invalid purpose_key: {$purposeKey}";

            return 'skipped';
        }

        $defaultEndpointId = null;
        $defaultName = trim((string) ($row['default_endpoint_name'] ?? ''));
        if ($defaultName !== '') {
            $rowTenantId = $this->resolveRowTenantId($row);
            $defaultEndpointId = $idByName[$defaultName] ?? $this->findEndpointIdByName($defaultName, $rowTenantId);
            if ($defaultEndpointId === null) {
                $warnings[] = "Purpose {$purposeKey}: default_endpoint_name not found: {$defaultName}";
            }
        }

        $fields = [
            'purpose_key'         => $purposeKey,
            'label'               => $label,
            'description'         => $this->nullableTrim($row['description'] ?? null),
            'default_endpoint_id' => $defaultEndpointId,
            'is_enabled'          => (int) ($row['is_enabled'] ?? 1) ? 1 : 0,
            'sort_order'          => (int) ($row['sort_order'] ?? 500),
            'meta_json'           => $this->encodeJsonField($row['meta_json'] ?? null),
            'updated_at'          => gmdate('Y-m-d H:i:s'),
        ];

        $existingId = $this->findPurposeIdByKey($purposeKey, $this->resolveRowTenantId($row));
        $table = $this->puTable();

        if ($existingId !== null) {
            if ($dryRun) {
                return 'updated';
            }
            $sets = [];
            foreach (array_keys($fields) as $col) {
                $sets[] = "{$col} = :{$col}";
            }
            $sql = "UPDATE {$table} SET " . implode(', ', $sets) . ' WHERE id = :id';
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute(array_merge($fields, ['id' => $existingId]));

            return 'updated';
        }

        if ($dryRun) {
            return 'created';
        }

        $fields['created_at'] = gmdate('Y-m-d H:i:s');
        $cols = array_keys($fields);
        $rowTenantId = $this->resolveRowTenantId($row);
        if ($rowTenantId !== null && $this->isPgsql()) {
            $fields['tenant_id'] = $rowTenantId;
            $cols[] = 'tenant_id';
        }
        $placeholders = array_map(static fn(string $c): string => ':' . $c, $cols);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $placeholders) . ')';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($fields);

        return 'created';
    }

    /**
     * CLI --tenant-id wins; otherwise use tenant_id from the JSON row (if any).
     */
    private function resolveRowTenantId(array $row): ?int
    {
        if ($this->tenantId > 0) {
            return $this->tenantId;
        }
        $tidRaw = $row['tenant_id'] ?? null;
        if ($tidRaw === null || $tidRaw === '') {
            return null;
        }

        return (int) $tidRaw;
    }

    private function findEndpointIdByName(string $name, ?int $rowTenantId = null): ?int
    {
        $table = $this->epTable();
        if ($rowTenantId !== null && $this->isPgsql()) {
            $stmt = $this->pdo->prepare(
                "SELECT id FROM {$table} WHERE name = :name AND tenant_id = :tid LIMIT 1"
            );
            $stmt->execute(['name' => $name, 'tid' => $rowTenantId]);
        } elseif ($this->tenantId > 0 && $this->isPgsql()) {
            $stmt = $this->pdo->prepare(
                "SELECT id FROM {$table} WHERE name = :name AND tenant_id = :tid LIMIT 1"
            );
            $stmt->execute(['name' => $name, 'tid' => $this->tenantId]);
        } else {
            $stmt = $this->pdo->prepare(
                "SELECT id FROM {$table} WHERE name = :name ORDER BY (tenant_id IS NULL) DESC, id ASC LIMIT 1"
            );
            $stmt->execute(['name' => $name]);
        }
        $id = $stmt->fetchColumn();

        return $id !== false ? (int) $id : null;
    }

    private function findPurposeIdByKey(string $purposeKey, ?int $rowTenantId = null): ?int
    {
        $table = $this->puTable();
        $tenantId = $rowTenantId ?? ($this->tenantId > 0 ? $this->tenantId : null);
        if ($tenantId !== null && $this->isPgsql()) {
            $stmt = $this->pdo->prepare(
                "SELECT id FROM {$table} WHERE purpose_key = :pk AND tenant_id = :tid LIMIT 1"
            );
            $stmt->execute(['pk' => $purposeKey, 'tid' => $tenantId]);
            $id = $stmt->fetchColumn();
            if ($id !== false) {
                return (int) $id;
            }
        }

        $stmt = $this->pdo->prepare(
            "SELECT id FROM {$table} WHERE purpose_key = :pk AND tenant_id IS NULL LIMIT 1"
        );
        $stmt->execute(['pk' => $purposeKey]);
        $id = $stmt->fetchColumn();

        return $id !== false ? (int) $id : null;
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $s = trim((string) $value);

        return $s === '' ? null : $s;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function decodeJsonField(mixed $raw): ?array
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        if (\is_array($raw)) {
            return $raw;
        }
        $decoded = json_decode((string) $raw, true);

        return \is_array($decoded) ? $decoded : null;
    }

    private function encodeJsonField(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (\is_string($value)) {
            $trim = trim($value);
            if ($trim === '') {
                return null;
            }
            json_decode($trim, true);

            return json_last_error() === JSON_ERROR_NONE ? $trim : null;
        }
        if (! \is_array($value)) {
            return null;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
