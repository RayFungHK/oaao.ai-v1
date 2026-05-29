<?php

declare(strict_types=1);

/**
 * CS-2-S2 — Library documents + revisions (PostgreSQL).
 */
function oaao_auth_ensure_library_schema(\PDO $pdo): void
{
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS oaao_library_document (
            document_id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL,
            workspace_id BIGINT,
            title VARCHAR(512) NOT NULL DEFAULT \'\',
            status VARCHAR(32) NOT NULL DEFAULT \'draft\',
            created_by BIGINT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )',
    );
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS oaao_library_revision (
            revision_id BIGSERIAL PRIMARY KEY,
            document_id BIGINT NOT NULL REFERENCES oaao_library_document(document_id) ON DELETE CASCADE,
            version INT NOT NULL DEFAULT 1,
            blocks_json TEXT,
            markdown_mirror TEXT,
            created_by BIGINT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_library_document_tenant
         ON oaao_library_document (tenant_id, workspace_id)',
    );
    $pdo->exec(
        'ALTER TABLE oaao_library_document ADD COLUMN IF NOT EXISTS current_revision_id BIGINT DEFAULT NULL',
    );
    $pdo->exec(
        'ALTER TABLE oaao_library_document ADD COLUMN IF NOT EXISTS corpus_id BIGINT DEFAULT NULL',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_library_revision_doc_ver
         ON oaao_library_revision (document_id, version DESC)',
    );
}
