<?php

declare(strict_types=1);

/**
 * Legacy procedural entry — prefer {@code api('chat')->ensureConversationMaterialSchema($pdo)}.
 *
 * @see api/ensure_conversation_material_schema.php Razy closure (bound via chat {@code addAPICommand})
 */
function oaao_chat_ensure_conversation_material_schema(\PDO $pdo): void
{
    /** @var \Closure(\PDO): void|null $ensure */
    static $ensure = null;
    if ($ensure === null) {
        $loaded = require __DIR__ . '/ensure_conversation_material_schema.php';
        if (! $loaded instanceof \Closure) {
            throw new \RuntimeException('ensure_conversation_material_schema.php must return a Closure');
        }
        $ensure = $loaded;
    }
    $ensure($pdo);
}
