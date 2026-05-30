<?php

declare(strict_types=1);

/**
 * Legacy procedural entry — prefer {@code api('chat')->ensureMicroSkillSchema($pdo)}.
 *
 * @see api/ensure_micro_skill_schema.php Razy closure (bound via chat {@code addAPICommand})
 */
function oaao_chat_ensure_micro_skill_schema(\PDO $pdo): void
{
    /** @var \Closure(\PDO): void|null $ensure */
    static $ensure = null;
    if ($ensure === null) {
        $loaded = require __DIR__ . '/ensure_micro_skill_schema.php';
        if (! $loaded instanceof \Closure) {
            throw new \RuntimeException('ensure_micro_skill_schema.php must return a Closure');
        }
        $ensure = $loaded;
    }
    $ensure($pdo);
}
