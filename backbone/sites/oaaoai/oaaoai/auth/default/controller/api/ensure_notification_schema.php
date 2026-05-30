<?php

declare(strict_types=1);

/** In-app notifications ({@see auth} {@code ensureNotificationSchema}). */
return function (\PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_notification (
        notification_id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES oaao_user(user_id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT \'system\',
        title TEXT NOT NULL,
        body TEXT DEFAULT NULL,
        payload_json TEXT DEFAULT NULL,
        read_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_notification_user_created
        ON oaao_notification(user_id, created_at DESC)');

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_oaao_notification_user_unread
        ON oaao_notification(user_id) WHERE read_at IS NULL');

    try {
        $pdo->exec('ALTER TABLE oaao_workspace_invitation ADD COLUMN role TEXT NOT NULL DEFAULT \'member\'');
    } catch (\Throwable $_) {
    }
};
