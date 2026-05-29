<?php

declare(strict_types=1);

/**
 * PLAT-1-S1 — Platform release posts (global, not tenant-scoped).
 */
function oaao_auth_ensure_release_post_schema(\PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS oaao_release_post (
            release_post_id BIGSERIAL PRIMARY KEY,
            slug VARCHAR(128) NOT NULL DEFAULT \'\',
            post_type VARCHAR(32) NOT NULL DEFAULT \'changelog\',
            locale VARCHAR(16) NOT NULL DEFAULT \'en\',
            version VARCHAR(64) NOT NULL DEFAULT \'\',
            build_id VARCHAR(128) NOT NULL DEFAULT \'\',
            title VARCHAR(512) NOT NULL DEFAULT \'\',
            body_md TEXT NOT NULL DEFAULT \'\',
            status VARCHAR(32) NOT NULL DEFAULT \'draft\',
            published_at TIMESTAMPTZ,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )',
    );
    // Legacy index allowed only one row per slug; bilingual posts need (slug, locale).
    $pdo->exec('DROP INDEX IF EXISTS idx_oaao_release_post_slug');
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_release_post_slug_locale
         ON oaao_release_post (slug, locale) WHERE slug <> \'\'',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_release_post_published
         ON oaao_release_post (status, published_at DESC, locale)',
    );
}
