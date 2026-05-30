<?php

declare(strict_types=1);

/**
 * Legacy procedural entry — prefer {@code api('slide_designer')->ensureSlideProjectSchema($pdo)}.
 *
 * @see api/ensure_slide_project_schema.php Razy closure (bound via slide-designer {@code addAPICommand})
 */
function oaao_slide_designer_ensure_schema(\PDO $pdo): void
{
    /** @var \Closure(\PDO): void|null $ensure */
    static $ensure = null;
    if ($ensure === null) {
        $loaded = require __DIR__ . '/ensure_slide_project_schema.php';
        if (! $loaded instanceof \Closure) {
            throw new \RuntimeException('ensure_slide_project_schema.php must return a Closure');
        }
        $ensure = $loaded;
    }
    $ensure($pdo);
}
