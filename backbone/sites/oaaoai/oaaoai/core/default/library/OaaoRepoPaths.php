<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Repository root for cross-cutting assets (prompt templates, Python tree, …).
 *
 * Razy loads {@code oaaoai\{vendor}\{module}\Class} from {@code sites/.../oaaoai/{module}/default/library/}.
 * Do not {@code require_once} library peers with {@code dirname(__DIR__, N)} from API vs library — depth differs.
 */
final class OaaoRepoPaths
{
    public static function root(): string
    {
        $env = getenv('OAAO_REPO_ROOT');
        if ($env !== false && trim((string) $env) !== '') {
            return rtrim(trim((string) $env), '/\\');
        }

        // core/default/library → repo root (oaao.ai-v1)
        return dirname(__DIR__, 7);
    }
}
