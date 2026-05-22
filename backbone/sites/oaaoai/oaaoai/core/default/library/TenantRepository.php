<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/AuthSchemaBridge.php';

/**
 * PostgreSQL tenant registry ({@code oaao_tenant} + {@code oaao_tenant_host}).
 */
final class TenantRepository
{
    /**
     * @return array<string, mixed>|null
     */
    public static function resolveByHost(\PDO $pdo, string $host): ?array
    {
        $host = strtolower(trim($host));
        if ($host === '') {
            return null;
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        $row = self::fetchTenantByHost($pdo, $host);
        if ($row !== null) {
            return $row;
        }

        $aliasHost = TenantHostResolver::resolveDomainKey($host);
        if ($aliasHost !== '' && $aliasHost !== $host) {
            $row = self::fetchTenantByHost($pdo, strtolower($aliasHost));
            if ($row !== null) {
                return $row;
            }
        }

        return self::matchWildcardHost($pdo, $host);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function resolveBySlug(\PDO $pdo, string $slug): ?array
    {
        $slug = trim($slug);
        if ($slug === '') {
            return null;
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        $st = $pdo->prepare(
            'SELECT tenant_id, slug, display_name, kind, signup_mode, status, limits_json, branding_json, created_at, updated_at
             FROM oaao_tenant WHERE slug = ? LIMIT 1',
        );
        $st->execute([$slug]);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);

        return $row !== false ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function resolveById(\PDO $pdo, int $tenantId): ?array
    {
        if ($tenantId < 1) {
            return null;
        }

        $st = $pdo->prepare(
            'SELECT tenant_id, slug, display_name, kind, signup_mode, status, limits_json, branding_json, created_at, updated_at
             FROM oaao_tenant WHERE tenant_id = ? LIMIT 1',
        );
        $st->execute([$tenantId]);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);

        return $row !== false ? $row : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listTenants(\PDO $pdo): array
    {
        AuthSchemaBridge::ensureTenantSchema($pdo);

        /** @var list<array<string, mixed>> $rows */
        $rows = $pdo->query(
            'SELECT tenant_id, slug, display_name, kind, signup_mode, status, limits_json, branding_json, created_at, updated_at
             FROM oaao_tenant ORDER BY kind DESC, slug ASC',
        )->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        foreach ($rows as &$row) {
            $tid = (int) ($row['tenant_id'] ?? 0);
            $row['hosts'] = self::listHostsForTenant($pdo, $tid);
        }
        unset($row);

        return $rows;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function listHostsForTenant(\PDO $pdo, int $tenantId): array
    {
        if ($tenantId < 1) {
            return [];
        }

        $st = $pdo->prepare(
            'SELECT host_id, host, is_primary FROM oaao_tenant_host WHERE tenant_id = ? ORDER BY is_primary DESC, host ASC',
        );
        $st->execute([$tenantId]);
        /** @var list<array<string, mixed>> */
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        return $rows;
    }

    /**
     * @param array<string, mixed> $input
     *
     * @return array{tenant_id: int, created: bool}
     */
    public static function saveTenant(\PDO $pdo, array $input): array
    {
        AuthSchemaBridge::ensureTenantSchema($pdo);

        $tenantId = isset($input['tenant_id']) ? (int) $input['tenant_id'] : 0;
        $slug = isset($input['slug']) ? trim((string) $input['slug']) : '';
        $displayName = isset($input['display_name']) ? trim((string) $input['display_name']) : '';
        $kind = isset($input['kind']) ? strtolower(trim((string) $input['kind'])) : 'customer';
        $signupMode = isset($input['signup_mode']) ? strtolower(trim((string) $input['signup_mode'])) : 'private';
        $status = isset($input['status']) ? strtolower(trim((string) $input['status'])) : 'active';

        if ($slug === '') {
            throw new \InvalidArgumentException('slug is required');
        }
        if (! preg_match('/^[a-z0-9][a-z0-9_-]{0,47}$/', $slug)) {
            throw new \InvalidArgumentException('Invalid slug');
        }
        if (! \in_array($kind, ['customer', 'platform'], true)) {
            throw new \InvalidArgumentException('Invalid kind');
        }
        if (! \in_array($signupMode, ['public', 'private'], true)) {
            throw new \InvalidArgumentException('Invalid signup_mode');
        }
        if (! \in_array($status, ['active', 'suspended'], true)) {
            throw new \InvalidArgumentException('Invalid status');
        }

        $limitsJson = null;
        if (isset($input['limits_json']) && \is_array($input['limits_json'])) {
            $limitsJson = json_encode($input['limits_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } elseif (isset($input['limits_json']) && \is_string($input['limits_json']) && trim($input['limits_json']) !== '') {
            $limitsJson = trim($input['limits_json']);
        }

        $ts = date('c');

        if ($tenantId > 0) {
            $existing = self::resolveById($pdo, $tenantId);
            if ($existing !== null) {
                $kind = isset($existing['kind']) ? strtolower(trim((string) $existing['kind'])) : 'customer';
                if ($kind === 'platform') {
                    throw new \InvalidArgumentException('Platform tenant cannot be modified via customer save');
                }
            }

            $pdo->prepare(
                'UPDATE oaao_tenant SET slug = ?, display_name = ?, kind = ?, signup_mode = ?, status = ?,
                    limits_json = ?, updated_at = ?::timestamptz WHERE tenant_id = ?',
            )->execute([
                $slug,
                $displayName !== '' ? $displayName : $slug,
                $kind,
                $signupMode,
                $status,
                $limitsJson,
                $ts,
                $tenantId,
            ]);

            return ['tenant_id' => $tenantId, 'created' => false];
        }

        $pdo->prepare(
            'INSERT INTO oaao_tenant (slug, display_name, kind, signup_mode, status, limits_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)',
        )->execute([
            $slug,
            $displayName !== '' ? $displayName : $slug,
            $kind,
            $signupMode,
            $status,
            $limitsJson,
            $ts,
            $ts,
        ]);

        return ['tenant_id' => (int) $pdo->lastInsertId(), 'created' => true];
    }

    /**
     * @param list<string> $hosts
     *
     * @throws \InvalidArgumentException when a host is bound to another tenant
     */
    public static function assertHostsAvailable(\PDO $pdo, int $tenantId, array $hosts): void
    {
        foreach ($hosts as $rawHost) {
            $h = strtolower(trim((string) $rawHost));
            if ($h === '') {
                continue;
            }
            $st = $pdo->prepare('SELECT tenant_id FROM oaao_tenant_host WHERE host = ? LIMIT 1');
            $st->execute([$h]);
            $owner = $st->fetchColumn();
            if ($owner !== false && (int) $owner > 0 && (int) $owner !== $tenantId) {
                throw new \InvalidArgumentException('Host already bound to another tenant: ' . $h);
            }
        }
    }

    /**
     * Add host bindings without removing existing rows.
     *
     * @param list<string> $hosts
     *
     * @return list<string> newly added hosts
     */
    public static function addHosts(\PDO $pdo, int $tenantId, array $hosts): array
    {
        if ($tenantId < 1) {
            return [];
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        self::assertHostsAvailable($pdo, $tenantId, $hosts);

        $existing = self::listHostsForTenant($pdo, $tenantId);
        /** @var array<string, true> $seen */
        $seen = [];
        foreach ($existing as $row) {
            $h = strtolower(trim((string) ($row['host'] ?? '')));
            if ($h !== '') {
                $seen[$h] = true;
            }
        }

        $ins = $pdo->prepare('INSERT INTO oaao_tenant_host (tenant_id, host, is_primary) VALUES (?, ?, ?)');
        /** @var list<string> $added */
        $added = [];
        foreach ($hosts as $rawHost) {
            $h = strtolower(trim((string) $rawHost));
            if ($h === '' || isset($seen[$h])) {
                continue;
            }
            $seen[$h] = true;
            $isPrimary = $existing === [] && $added === [] ? 1 : 0;
            $ins->execute([$tenantId, $h, $isPrimary]);
            $added[] = $h;
        }

        return $added;
    }

    /**
     * @param list<string> $hosts
     */
    public static function replaceHosts(\PDO $pdo, int $tenantId, array $hosts): void
    {
        if ($tenantId < 1) {
            return;
        }

        self::assertHostsAvailable($pdo, $tenantId, $hosts);

        $pdo->prepare('DELETE FROM oaao_tenant_host WHERE tenant_id = ?')->execute([$tenantId]);

        $ins = $pdo->prepare('INSERT INTO oaao_tenant_host (tenant_id, host, is_primary) VALUES (?, ?, ?)');
        $seen = [];
        $first = true;
        foreach ($hosts as $rawHost) {
            $h = strtolower(trim((string) $rawHost));
            if ($h === '' || isset($seen[$h])) {
                continue;
            }
            $seen[$h] = true;
            $ins->execute([$tenantId, $h, $first ? 1 : 0]);
            $first = false;
        }
    }

    /**
     * @return array<string, int>
     */
    public static function usageSummary(\PDO $pdo): array
    {
        AuthSchemaBridge::ensureTenantSchema($pdo);

        /** @var list<array<string, mixed>> $tenants */
        $tenants = $pdo->query('SELECT tenant_id, slug, display_name, kind, status FROM oaao_tenant ORDER BY slug')->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        /** @var list<array<string, mixed>> $out */
        $out = [];
        foreach ($tenants as $t) {
            $tid = (int) ($t['tenant_id'] ?? 0);
            if ($tid < 1) {
                continue;
            }
            $users = (int) $pdo->query('SELECT COUNT(*) FROM oaao_user WHERE tenant_id = ' . $tid)->fetchColumn();
            $vaults = (int) $pdo->query('SELECT COUNT(*) FROM oaao_vault WHERE tenant_id = ' . $tid)->fetchColumn();
            $events = (int) $pdo->query('SELECT COUNT(*) FROM oaao_usage_event WHERE tenant_id = ' . $tid)->fetchColumn();

            $byKindSt = $pdo->prepare(
                'SELECT event_kind, COUNT(*) AS event_count, COALESCE(SUM(quantity), 0) AS quantity_sum
                 FROM oaao_usage_event WHERE tenant_id = ? GROUP BY event_kind ORDER BY event_kind',
            );
            $byKindSt->execute([$tid]);
            /** @var list<array<string, mixed>> $byKind */
            $byKind = $byKindSt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

            $out[] = [
                'tenant_id'     => $tid,
                'slug'          => (string) ($t['slug'] ?? ''),
                'display_name'  => (string) ($t['display_name'] ?? ''),
                'kind'          => (string) ($t['kind'] ?? ''),
                'status'        => (string) ($t['status'] ?? ''),
                'user_count'    => $users,
                'vault_count'   => $vaults,
                'usage_events'  => $events,
                'usage_by_kind' => $byKind,
            ];
        }

        return ['tenants' => $out];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function fetchTenantByHost(\PDO $pdo, string $host): ?array
    {
        $st = $pdo->prepare(
            'SELECT t.tenant_id, t.slug, t.display_name, t.kind, t.signup_mode, t.status, t.limits_json, t.branding_json, t.created_at, t.updated_at
             FROM oaao_tenant t
             INNER JOIN oaao_tenant_host h ON h.tenant_id = t.tenant_id
             WHERE h.host = ?
             LIMIT 1',
        );
        $st->execute([$host]);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);

        return $row !== false ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function matchWildcardHost(\PDO $pdo, string $host): ?array
    {
        $st = $pdo->query(
            'SELECT h.host, t.tenant_id, t.slug, t.display_name, t.kind, t.signup_mode, t.status, t.limits_json, t.branding_json, t.created_at, t.updated_at
             FROM oaao_tenant_host h
             INNER JOIN oaao_tenant t ON t.tenant_id = h.tenant_id
             WHERE h.host LIKE \'%*%\'',
        );
        if ($st === false) {
            return null;
        }

        while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $pattern = (string) ($row['host'] ?? '');
            if ($pattern === '' || ! str_contains($pattern, '*')) {
                continue;
            }
            $quoted = preg_quote($pattern, '/');
            $quoted = str_replace('\*', '[^.]+', $quoted);
            if (preg_match('/^' . $quoted . '$/', $host) === 1) {
                unset($row['host']);

                return $row;
            }
        }

        return null;
    }
}
