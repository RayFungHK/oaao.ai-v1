<?php

declare(strict_types=1);

/** Tenant invitations + password reset tokens ({@see auth} {@code ensureUserInvitationSchema}). */
return function (\PDO $pdo): void {
    if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
        return;
    }

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_user_invitation (
        invitation_id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES oaao_tenant(tenant_id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT \'user\',
        permission_group_id BIGINT DEFAULT NULL,
        invited_by_user_id BIGINT NOT NULL REFERENCES oaao_user(user_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT \'pending\',
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ DEFAULT NULL,
        accepted_user_id BIGINT DEFAULT NULL REFERENCES oaao_user(user_id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_user_inv_token_hash ON oaao_user_invitation(token_hash)',
    );
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_user_inv_pending_email ON oaao_user_invitation(tenant_id, email) WHERE status = \'pending\'',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_user_inv_tenant_status ON oaao_user_invitation(tenant_id, status)',
    );

    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_password_reset (
        reset_id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES oaao_user(user_id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT \'pending\',
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_oaao_password_reset_token_hash ON oaao_password_reset(token_hash)',
    );
    $pdo->exec(
        'CREATE INDEX IF NOT EXISTS idx_oaao_password_reset_user_status ON oaao_password_reset(user_id, status)',
    );
};
