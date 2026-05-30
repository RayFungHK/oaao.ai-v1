<?php

declare(strict_types=1);

/** Adjunct SQLite — conversation materials ({@see chat} {@code ensureConversationMaterialSchema}). */
return function (\PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS oaao_conversation_material (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        material_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT \'file\',
        category TEXT NOT NULL DEFAULT \'document\',
        title TEXT NOT NULL,
        mime TEXT DEFAULT NULL,
        size_bytes INTEGER DEFAULT NULL,
        uri TEXT DEFAULT NULL,
        task_id TEXT DEFAULT NULL,
        meta_json TEXT DEFAULT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('DROP INDEX IF EXISTS idx_conv_material_id');
    $pdo->exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_material_msg_mat
         ON oaao_conversation_material(conversation_id, message_id, material_id)',
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conv_material_msg ON oaao_conversation_material(conversation_id, message_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_conv_material_task ON oaao_conversation_material(conversation_id, task_id)');

    try {
        $pdo->exec('ALTER TABLE oaao_conversation_material ADD COLUMN storage_locator_json TEXT DEFAULT NULL');
    } catch (\Throwable) {
    }
};
