<?php

declare(strict_types=1);

/**
 * Multi-tenant DDL: {@code oaao_tenant}, host bindings, {@code tenant_id} on core tables, default seed.
 *
 * Idempotent — safe from {@see oaao_auth_ensure_pg_core_tables}.
 */
function oaao_auth_ensure_tenant_schema(\PDO $pdo): void
{
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        return;
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_tenant (
        tenant_id BIGSERIAL PRIMARY KEY,
        slug TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT \'\',
        kind TEXT NOT NULL DEFAULT \'customer\',
        signup_mode TEXT NOT NULL DEFAULT \'private\',
        status TEXT NOT NULL DEFAULT \'active\',
        limits_json TEXT DEFAULT NULL,
        branding_json TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    try {
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_tenant_slug ON oaao_tenant(slug)');
    } catch (\Throwable) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_tenant_host (
        host_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE,
        host TEXT NOT NULL,
        is_primary SMALLINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    try {
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_tenant_host_host ON oaao_tenant_host(host)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_tenant_host_tid ON oaao_tenant_host(tenant_id)');
    } catch (\Throwable) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_usage_event (
        event_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE,
        event_kind TEXT NOT NULL,
        quantity NUMERIC DEFAULT NULL,
        unit TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_usage_event_tenant_day ON oaao_usage_event(tenant_id, created_at DESC)');
    } catch (\Throwable) {
    }

    $tenantCols = [
        'oaao_user'           => 'ALTER TABLE oaao_user ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE RESTRICT',
        'oaao_vault'          => 'ALTER TABLE oaao_vault ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE RESTRICT',
        'oaao_purpose'        => 'ALTER TABLE oaao_purpose ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE',
        'oaao_endpoint'       => 'ALTER TABLE oaao_endpoint ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE',
        'oaao_group'          => 'ALTER TABLE oaao_group ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE',
        'oaao_workspace'      => 'ALTER TABLE oaao_workspace ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE',
        'oaao_chat_endpoint'  => 'ALTER TABLE oaao_chat_endpoint ADD COLUMN tenant_id BIGINT DEFAULT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE',
    ];

    foreach ($tenantCols as $_table => $ddl) {
        try {
            $pdo->exec($ddl);
        } catch (\Throwable) {
        }
    }

    try {
        $pdo->exec('DROP INDEX IF EXISTS oaao_user_login_name_key');
    } catch (\Throwable) {
    }
    try {
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_user_tenant_login ON oaao_user(tenant_id, login_name)');
    } catch (\Throwable) {
    }

    oaao_auth_seed_default_tenants($pdo);
    oaao_auth_ensure_platform_host_bindings($pdo);
    oaao_auth_ensure_customer_host_bindings($pdo);
    oaao_auth_ensure_platform_admin_user($pdo);
    oaao_auth_backfill_tenant_ids($pdo);

    require_once __DIR__ . '/_ensure_credit_schema.php';
    oaao_auth_ensure_credit_schema($pdo);

    require_once __DIR__ . '/_ensure_storage_schema.php';
    oaao_auth_ensure_storage_schema($pdo);
}

/** Primary platform admin hostname ({@code OAAO_PLATFORM_ADMIN_HOST}, default {@code admin.localhost}). */
function oaao_platform_admin_host(): string
{
    $env = getenv('OAAO_PLATFORM_ADMIN_HOST');
    if ($env !== false && trim((string) $env) !== '') {
        return strtolower(trim((string) $env));
    }

    return 'admin.localhost';
}

/**
 * Idempotent: bind env-configured platform admin host(s) to the platform tenant.
 */
function oaao_auth_ensure_platform_host_bindings(\PDO $pdo): void
{
    $platformId = (int) $pdo->query("SELECT tenant_id FROM oaao_tenant WHERE slug = 'platform' LIMIT 1")->fetchColumn();
    if ($platformId < 1) {
        return;
    }

    $primary = oaao_platform_admin_host();
    $pdo->prepare(
        'INSERT INTO oaao_tenant_host (tenant_id, host, is_primary) VALUES (?, ?, 1)
         ON CONFLICT (host) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, is_primary = EXCLUDED.is_primary',
    )->execute([$platformId, $primary]);

    $extra = getenv('OAAO_PLATFORM_HOSTS');
    if ($extra === false || trim((string) $extra) === '') {
        return;
    }

    $ins = $pdo->prepare(
        'INSERT INTO oaao_tenant_host (tenant_id, host, is_primary) VALUES (?, ?, 0)
         ON CONFLICT (host) DO UPDATE SET tenant_id = EXCLUDED.tenant_id',
    );
    foreach (preg_split('/[\s,]+/', trim((string) $extra)) ?: [] as $h) {
        $h = strtolower(trim((string) $h));
        if ($h === '' || $h === $primary) {
            continue;
        }
        $ins->execute([$platformId, $h]);
    }
}

/**
 * Idempotent: bind env-configured customer / apex hosts to the default {@code localhost} tenant.
 *
 * {@code OAAO_APEX_DOMAIN} adds apex + {@code *.{apex}} wildcard rows.
 * {@code OAAO_CUSTOMER_HOSTS} adds explicit FQDNs (comma/space separated).
 */
function oaao_auth_ensure_customer_host_bindings(\PDO $pdo): void
{
    $localId = (int) $pdo->query("SELECT tenant_id FROM oaao_tenant WHERE slug = 'localhost' LIMIT 1")->fetchColumn();
    if ($localId < 1) {
        return;
    }

    /** @var list<string> $hosts */
    $hosts = [];

    $apex = getenv('OAAO_APEX_DOMAIN');
    if ($apex !== false && ($apex = strtolower(trim($apex))) !== '') {
        $hosts[] = $apex;
        $hosts[] = '*.' . $apex;
    }

    $extra = getenv('OAAO_CUSTOMER_HOSTS');
    if ($extra !== false && trim((string) $extra) !== '') {
        foreach (preg_split('/[\s,]+/', trim((string) $extra)) ?: [] as $h) {
            $h = strtolower(trim((string) $h));
            if ($h !== '') {
                $hosts[] = $h;
            }
        }
    }

    if ($hosts === []) {
        return;
    }

    $platformPrimary = oaao_platform_admin_host();
    $ins = $pdo->prepare(
        'INSERT INTO oaao_tenant_host (tenant_id, host, is_primary) VALUES (?, ?, 0)
         ON CONFLICT (host) DO UPDATE SET tenant_id = EXCLUDED.tenant_id',
    );
    foreach (array_unique($hosts) as $h) {
        if ($h === $platformPrimary) {
            continue;
        }
        $ins->execute([$localId, $h]);
    }
}

/**
 * Idempotent: dedicated {@code platform_admin} on the platform tenant (not shared with customer {@code admin}).
 */
function oaao_auth_ensure_platform_admin_user(\PDO $pdo): void
{
    $platformId = (int) $pdo->query("SELECT tenant_id FROM oaao_tenant WHERE slug = 'platform' LIMIT 1")->fetchColumn();
    if ($platformId < 1) {
        return;
    }

    $st = $pdo->prepare('SELECT user_id FROM oaao_user WHERE login_name = ? AND tenant_id = ? LIMIT 1');
    $st->execute(['platform_admin', $platformId]);
    if ($st->fetchColumn() !== false) {
        return;
    }

    $envPw = getenv('OAAO_PLATFORM_ADMIN_PASSWORD');
    $plain = ($envPw !== false && trim((string) $envPw) !== '') ? trim((string) $envPw) : 'platform_admin';
    $hash = password_hash($plain, PASSWORD_BCRYPT, ['cost' => 12]);
    if (! \is_string($hash)) {
        return;
    }

    $now = date('Y-m-d H:i:s');
    $pdo->prepare(
        'INSERT INTO oaao_user (login_name, password, display_name, email, role, disabled, tenant_id, created_at)
         VALUES (?, ?, ?, NULL, ?, 0, ?, ?)',
    )->execute(['platform_admin', $hash, 'Platform Admin', 'platform_admin', $platformId, $now]);
}

/**
 * @return array<string, mixed>|null
 */
function oaao_auth_seed_default_tenants(\PDO $pdo): ?array
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM oaao_tenant')->fetchColumn();
    if ($count > 0) {
        return null;
    }

    $ts = date('c');
    $pdo->prepare(
        'INSERT INTO oaao_tenant (slug, display_name, kind, signup_mode, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)',
    )->execute(['localhost', 'Local development', 'customer', 'public', 'active', $ts, $ts]);

    $localId = (int) $pdo->query("SELECT tenant_id FROM oaao_tenant WHERE slug = 'localhost' LIMIT 1")->fetchColumn();

    $pdo->prepare(
        'INSERT INTO oaao_tenant (slug, display_name, kind, signup_mode, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)',
    )->execute(['platform', 'Platform control plane', 'platform', 'private', 'active', $ts, $ts]);

    $platformId = (int) $pdo->query("SELECT tenant_id FROM oaao_tenant WHERE slug = 'platform' LIMIT 1")->fetchColumn();

    /** @var list<array{0: int, 1: string, 2: int}> $hosts */
    $hosts = [
        [$localId, 'localhost', 1],
        [$localId, '127.0.0.1', 0],
        [$localId, 'web', 0],
        [$localId, 'host.docker.internal', 0],
        [$localId, '[::1]', 0],
        [$localId, '*.localhost', 0],
        [$localId, '*.invalid', 0],
        [$platformId, oaao_platform_admin_host(), 1],
    ];

    $platformHosts = getenv('OAAO_PLATFORM_HOSTS');
    if ($platformHosts !== false && trim((string) $platformHosts) !== '') {
        foreach (preg_split('/[\s,]+/', trim((string) $platformHosts)) ?: [] as $h) {
            $h = strtolower(trim($h));
            if ($h !== '') {
                $hosts[] = [$platformId, $h, 0];
            }
        }
    }

    $ins = $pdo->prepare(
        'INSERT INTO oaao_tenant_host (tenant_id, host, is_primary) VALUES (?, ?, ?)
         ON CONFLICT (host) DO NOTHING',
    );
    foreach ($hosts as [$tid, $host, $primary]) {
        $ins->execute([$tid, $host, $primary]);
    }

    return ['localhost_id' => $localId, 'platform_id' => $platformId];
}

function oaao_auth_backfill_tenant_ids(\PDO $pdo): void
{
    $localId = (int) $pdo->query("SELECT tenant_id FROM oaao_tenant WHERE slug = 'localhost' LIMIT 1")->fetchColumn();
    if ($localId < 1) {
        return;
    }

    foreach (['oaao_user', 'oaao_vault', 'oaao_purpose', 'oaao_endpoint', 'oaao_group', 'oaao_workspace', 'oaao_chat_endpoint'] as $table) {
        try {
            $pdo->exec('UPDATE ' . $table . ' SET tenant_id = ' . $localId . ' WHERE tenant_id IS NULL');
        } catch (\Throwable) {
        }
    }

    try {
        $pdo->exec('DROP INDEX IF EXISTS idx_oaao_purpose_key');
    } catch (\Throwable) {
    }
    try {
        $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_purpose_tenant_key ON oaao_purpose(tenant_id, purpose_key)');
    } catch (\Throwable) {
    }
}
