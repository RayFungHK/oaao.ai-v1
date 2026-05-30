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

        // Non-endpoints callers (e.g. chat measureOverheadTokens) must delegate to the endpoints
        // controller. {@code api('endpoints')} is an {@see \Razy\Emitter} proxy — it has {@code __call}
        // API commands only, not {@code trigger()}.
        if (! self::isEndpointsController($emitter) && method_exists($emitter, 'api')) {
            try {
                $endpointsApi = $emitter->api('endpoints');
                if ($endpointsApi !== null) {
                    $endpointsApi->ensureFeatureRegistries();

                    return;
                }
            } catch (\Throwable) {
                /* fall through to direct trigger on caller */
            }
        }

        self::$collected = true;
        $emitter->trigger('collect_feature_registries')->resolve([]);
    }

    private static function isEndpointsController(\Razy\Controller $emitter): bool
    {
        if (! method_exists($emitter, 'getModuleSystemPath')) {
            return false;
        }

        $path = str_replace('\\', '/', (string) $emitter->getModuleSystemPath());

        return str_contains($path, '/oaaoai/endpoints/');
    }

    public static function reset(): void
    {
        self::$collected = false;
    }
}
