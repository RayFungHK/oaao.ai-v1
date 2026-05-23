<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Lazy feature registry wiring — {@see endpoints::ensureFeatureRegistries()}.
 *
 * Fires {@code oaaoai/endpoints:collect_feature_registries} once per request when SPA/settings/chat/vault APIs need registry JSON.
 */
final class FeatureRegistryBootstrap
{
    private static bool $collected = false;

    public static function isCollected(): bool
    {
        return self::$collected;
    }

    public static function collect(\Razy\Controller $emitter): void
    {
        if (self::$collected) {
            return;
        }
        self::$collected = true;
        $emitter->trigger('collect_feature_registries')->resolve([]);
    }

    public static function reset(): void
    {
        self::$collected = false;
    }
}
