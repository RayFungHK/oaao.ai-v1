<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use oaaoai\chat\PlannerAgentRegister;

/**
 * Chat run allowed agent kinds in purpose {@code meta_json.allowed_agents} (Settings → Task planner).
 * Stored on {@code planning.*} alongside {@code run_planner}.
 *
 * Kinds are sourced from {@see PlannerAgentRegister} (modules register via {@code planner_agent.register}).
 */
final class ChatAllowedAgentsPurposeConfig
{
    /**
     * @return list<string>
     */
    public static function allKinds(): array
    {
        $fromRegistry = PlannerAgentRegister::allKinds();

        return $fromRegistry !== [] ? $fromRegistry : self::LEGACY_KINDS;
    }

    /** @var list<string> Fallback when registry has not been seeded yet. */
    private const LEGACY_KINDS = [
        'vault_rag',
        'sandbox_code',
        'slides',
        'slide_designer',
        'image_gen',
        'web_search',
        'mcp_tool',
    ];

    /**
     * @return list<string>
     */
    public static function defaultAllowed(): array
    {
        return self::allKinds();
    }

    /**
     * @param array<string, mixed>|null $meta
     *
     * @return list<string>
     */
    public static function allowedFromMeta(?array $meta): array
    {
        $root = ($meta !== null && $meta !== []) ? $meta : [];
        $raw = $root['allowed_agents'] ?? $root['chat_allowed_agents'] ?? null;
        if ($raw === null) {
            return self::defaultAllowed();
        }

        if (\is_array($raw) && array_is_list($raw)) {
            $out = [];
            foreach ($raw as $item) {
                $k = strtolower(trim((string) $item));
                if ($k !== '' && \in_array($k, self::allKinds(), true)) {
                    $out[] = $k;
                }
            }

            return $out !== [] ? array_values(array_unique($out)) : self::defaultAllowed();
        }

        if (\is_array($raw)) {
            $out = [];
            foreach (self::allKinds() as $kind) {
                if (! empty($raw[$kind])) {
                    $out[] = $kind;
                }
            }

            return $out !== [] ? $out : self::defaultAllowed();
        }

        return self::defaultAllowed();
    }

    /**
     * @param array<string, bool> $enabledMap kind => enabled
     *
     * @return array{allowed_agents: array<string, bool>}
     */
    public static function metaJsonFromEnabledMap(array $enabledMap): array
    {
        $map = [];
        foreach (self::allKinds() as $kind) {
            $map[$kind] = ! empty($enabledMap[$kind]);
        }

        return ['allowed_agents' => $map];
    }

    /**
     * @param array<string, mixed> $existing
     * @param array<string, bool> $enabledMap
     *
     * @return array<string, mixed>
     */
    public static function mergeAllowedIntoMeta(array $existing, array $enabledMap): array
    {
        $existing['allowed_agents'] = self::metaJsonFromEnabledMap($enabledMap)['allowed_agents'];

        return $existing;
    }
}
