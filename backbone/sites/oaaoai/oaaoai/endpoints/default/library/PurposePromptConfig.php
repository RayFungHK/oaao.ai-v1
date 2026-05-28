<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Purpose {@code meta_json.prompt} — conversation vs command-base templates for orchestrator.
 *
 * @see docs/design/purpose-prompt-contract.md
 */
final class PurposePromptConfig
{
    public const KIND_CONVERSATION = 'conversation';

    public const KIND_COMMAND = 'command_template';

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
     * Normalized prompt block from purpose meta, or null when absent/invalid.
     *
     * @param array<string, mixed>|null $meta
     *
     * @return array<string, mixed>|null
     */
    public static function promptFromMeta(?array $meta): ?array
    {
        $root = ($meta !== null && $meta !== []) ? $meta : [];
        $prompt = $root['prompt'] ?? null;
        if (! \is_array($prompt)) {
            return null;
        }
        $kind = strtolower(trim((string) ($prompt['kind'] ?? '')));
        if (! \in_array($kind, [self::KIND_CONVERSATION, self::KIND_COMMAND], true)) {
            return null;
        }
        $out = ['kind' => $kind];
        foreach (['system_ref', 'assistant_ref', 'template_ref', 'response_format'] as $key) {
            if (! isset($prompt[$key]) || $prompt[$key] === null || $prompt[$key] === '') {
                continue;
            }
            $out[$key] = trim((string) $prompt[$key]);
        }
        if (isset($prompt['variables']) && \is_array($prompt['variables'])) {
            $vars = [];
            foreach ($prompt['variables'] as $v) {
                $s = trim((string) $v);
                if ($s !== '') {
                    $vars[] = $s;
                }
            }
            if ($vars !== []) {
                $out['variables'] = $vars;
            }
        }

        return $out;
    }

    /**
     * Attach to orchestrator LLM payload when the purpose row declares a prompt.
     *
     * @param array<string, mixed>|null $meta
     *
     * @return array<string, mixed>|null
     */
    public static function orchestratorPromptFromMeta(?array $meta): ?array
    {
        return self::promptFromMeta($meta);
    }

    /**
     * Default {@code meta_json} for bootstrapped {@code planning.primary}.
     *
     * @return array<string, mixed>
     */
    public static function defaultPlanningPrimaryMeta(string $runPlannerMode): array
    {
        $meta = ChatRunPlannerPurposeConfig::mergeModeIntoMeta([], $runPlannerMode);

        return self::mergePromptIntoMeta($meta, [
            'kind'        => self::KIND_CONVERSATION,
            'system_ref'  => 'materials/prompts/planning/planner_system.md',
        ]);
    }

    /**
     * Default {@code meta_json} for bootstrapped {@code planning.intent}.
     *
     * @return array<string, mixed>
     */
    public static function defaultPlanningIntentMeta(): array
    {
        return [
            'prompt' => [
                'kind'             => self::KIND_COMMAND,
                'template_ref'     => 'materials/prompts/planning/turn_agent_intent.md',
                'variables'        => [
                    'user_input',
                    'llm_knowledge_cutoff',
                    'current_date',
                    'knowledge_gap_detected',
                    'agent_registry_list',
                    'agent_analysis_schema',
                ],
                'response_format'  => 'json',
            ],
        ];
    }

    /**
     * @param array<string, mixed> $existing
     * @param array<string, mixed> $prompt
     *
     * @return array<string, mixed>
     */
    public static function mergePromptIntoMeta(array $existing, array $prompt): array
    {
        $kind = strtolower(trim((string) ($prompt['kind'] ?? '')));
        if (! \in_array($kind, [self::KIND_CONVERSATION, self::KIND_COMMAND], true)) {
            return $existing;
        }
        $block = ['kind' => $kind];
        foreach (['system_ref', 'assistant_ref', 'template_ref', 'response_format'] as $key) {
            if (isset($prompt[$key]) && $prompt[$key] !== '') {
                $block[$key] = trim((string) $prompt[$key]);
            }
        }
        if (isset($prompt['variables']) && \is_array($prompt['variables'])) {
            $block['variables'] = array_values(array_filter(array_map(
                static fn ($v): string => trim((string) $v),
                $prompt['variables'],
            )));
        }
        $existing['prompt'] = $block;

        return $existing;
    }
}
