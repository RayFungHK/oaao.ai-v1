<?php

declare(strict_types=1);

/** Adjunct SQLite — ephemeral chat attachments ({@see chat} {@code ensureConversationAttachmentSchema}). */
return function (\PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_conversation_attachment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT DEFAULT NULL,
        storage_path TEXT NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        extract_status TEXT NOT NULL DEFAULT "pending",
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT DEFAULT NULL
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conv_attachment_conv ON oaao_conversation_attachment(conversation_id)');

    try {
        $pdo->exec('ALTER TABLE oaao_conversation_attachment ADD COLUMN storage_locator_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }
};
