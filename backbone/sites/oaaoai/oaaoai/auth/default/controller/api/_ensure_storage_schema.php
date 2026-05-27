<?php

declare(strict_types=1);

/**
 * Per-tenant object storage DDL: {@code storage_json}, locators on blob tables, migration audit.
 *
 * Idempotent — safe from {@see oaao_auth_ensure_tenant_schema}.
 */
function oaao_auth_ensure_storage_schema(\PDO $pdo): void
{
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        return;
    }

    try {
        $pdo->exec('ALTER TABLE oaao_tenant ADD COLUMN storage_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_vault_document ADD COLUMN storage_locator_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_slide_project ADD COLUMN storage_locator_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('ALTER TABLE oaao_mine ADD COLUMN storage_locator_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_storage_migration_item (
        item_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE,
        domain TEXT NOT NULL,
        object_id TEXT NOT NULL,
        src_locator_json TEXT NOT NULL,
        dst_locator_json TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT \'pending\',
        error_text TEXT DEFAULT NULL,
        byte_size BIGINT DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT NULL
    )');

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_storage_mig_tenant ON oaao_storage_migration_item(tenant_id, status)');
    } catch (\Throwable) {
    }

    try {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_storage_mig_object ON oaao_storage_migration_item(tenant_id, domain, object_id)');
    } catch (\Throwable) {
    }
}
