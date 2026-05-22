<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Chat run task planner mode in purpose {@code meta_json.run_planner} (Settings → Task planner).
 * Stored on {@code planning.*} — the purpose slot owned by {@code oaaoai/chat}.
 */
final class ChatRunPlannerPurposeConfig
{
    public const MODE_LLM = 'llm';

    public const MODE_STUB = 'stub';

    /**
     * @return array<string, mixed>
     */
    public static function decodePurposeMeta(mixed $metaJson): array
    {
        if (\is_array($metaJson)) {
            return $metaJson;
        }
        if (! \is_string($metaJson) || trim($metaJson) === '') {
            return [];
        }
        try {
            $dec = json_decode(trim($metaJson), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return \is_array($dec) ? $dec : [];
    }

    /**
     * Normalized mode for orchestrator {@code run_planner_mode} payload.
     *
     * @param array<string, mixed>|null $meta
     */
    public static function modeFromMeta(?array $meta): ?string
    {
        $root = ($meta !== null && $meta !== []) ? $meta : [];
        $nested = \is_array($root['run_planner'] ?? null) ? $root['run_planner'] : $root;
        $raw = $nested['mode'] ?? $nested['run_planner_mode'] ?? null;
        if ($raw === null || $raw === '') {
            return null;
        }
        $mode = strtolower(trim((string) $raw));

        return \in_array($mode, [self::MODE_LLM, self::MODE_STUB], true) ? $mode : null;
    }

    public static function defaultMode(): string
    {
        $env = strtolower(trim((string) (getenv('OAAO_RUN_PLANNER_MODE') ?: self::MODE_LLM)));

        return \in_array($env, [self::MODE_LLM, self::MODE_STUB], true) ? $env : self::MODE_LLM;
    }

    /**
     * @param array<string, mixed> $existing
     *
     * @return array<string, mixed>
     */
    public static function mergeModeIntoMeta(array $existing, string $mode): array
    {
        $mode = strtolower(trim($mode));
        if (! \in_array($mode, [self::MODE_LLM, self::MODE_STUB], true)) {
            $mode = self::MODE_LLM;
        }
        $existing['run_planner'] = ['mode' => $mode];

        return $existing;
    }

    /**
     * @return array{run_planner: array{mode: string}}
     */
    public static function metaJsonFromMode(string $mode): array
    {
        $mode = strtolower(trim($mode));
        if (! \in_array($mode, [self::MODE_LLM, self::MODE_STUB], true)) {
            $mode = self::MODE_LLM;
        }

        return ['run_planner' => ['mode' => $mode]];
    }
}
