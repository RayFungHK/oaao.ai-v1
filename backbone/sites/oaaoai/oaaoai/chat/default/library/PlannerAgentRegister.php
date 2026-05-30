<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Frozen registry for chat run-task agents — planner hints and UI catalog.
 *
 * Modules extend via {@code planner_agent.register} (namespaced events); {@see \\Module\\oaao\\endpoints}
 * listens and merges rows before {@see \\Module\\oaao\\chat} exposes {@code getPlannerAgentRegistry()}.
 *
 * {@code planner_hint}: when the LLM planner should choose this agent (passed to orchestrator {@code agent_catalog}).
 *
 * {@code ask_stage}: optional user confirmation before running the agent ({@code ask_enabled}, {@code ask_hint}, …).
 */
final class PlannerAgentRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $entries = [];

    /**
     * @param array<string, mixed> $extras sort, module_code, planner_hint, i18n_*_key, deprecated,
     *                                   ask_enabled, ask_hint, ask_default_message, ask_title,
     *                                   ask_proceed_label, ask_skip_label, i18n_ask_*_key
     */
    public static function add(string $agent_kind, string $name, string $description, array $extras = []): void
    {
        $agent_kind = strtolower(trim($agent_kind));
        if ($agent_kind === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'agent_kind'  => $agent_kind,
            'name'        => trim($name),
            'description' => trim($description),
            'sort'        => $sort,
        ];

        foreach (['module_code', 'planner_hint', 'i18n_label_key', 'i18n_desc_key'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }
        if (! empty($extras['deprecated'])) {
            $row['deprecated'] = true;
        }
        if (! empty($extras['intent_only'])) {
            $row['intent_only'] = true;
        }

        if (! empty($extras['ask_enabled'])) {
            $row['ask_enabled'] = true;
            foreach (
                [
                    'ask_hint',
                    'ask_default_message',
                    'ask_title',
                    'ask_proceed_label',
                    'ask_skip_label',
                    'i18n_ask_title_key',
                    'i18n_ask_message_key',
                    'i18n_ask_proceed_key',
                    'i18n_ask_skip_key',
                ] as $ak
            ) {
                if (isset($extras[$ak]) && is_string($extras[$ak]) && trim($extras[$ak]) !== '') {
                    $row[$ak] = trim($extras[$ak]);
                }
            }
        }

        self::$entries[$agent_kind] = $row;
    }

    /**
     * @return list<string>
     */
    public static function allKinds(): array
    {
        $rows = self::allSorted();

        return array_values(array_map(static fn (array $r): string => (string) ($r['agent_kind'] ?? ''), $rows));
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$entries);
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }

    /**
     * Orchestrator payload — only kinds the run may invoke, with planner hints + optional ask stage.
     *
     * @param list<string> $allowedKinds
     *
     * @return list<array<string, mixed>>
     */
    public static function catalogForAllowed(array $allowedKinds): array
    {
        $allow = [];
        foreach ($allowedKinds as $k) {
            $key = strtolower(trim((string) $k));
            if ($key !== '') {
                $allow[$key] = true;
            }
        }
        if ($allow === []) {
            return [];
        }

        $out = [];
        foreach (self::allSorted() as $row) {
            $kind = (string) ($row['agent_kind'] ?? '');
            if ($kind === '' || ! isset($allow[$kind]) || ! empty($row['intent_only'])) {
                continue;
            }
            $hint = trim((string) ($row['planner_hint'] ?? ''));
            if ($hint === '') {
                $hint = trim((string) ($row['description'] ?? ''));
            }
            $entry = [
                'agent_kind'   => $kind,
                'name'         => (string) ($row['name'] ?? $kind),
                'description'  => (string) ($row['description'] ?? ''),
                'planner_hint' => $hint,
            ];
            if (! empty($row['ask_enabled'])) {
                $entry['ask_enabled'] = true;
                foreach (
                    [
                        'ask_hint',
                        'ask_default_message',
                        'ask_title',
                        'ask_proceed_label',
                        'ask_skip_label',
                    ] as $ak
                ) {
                    if (isset($row[$ak]) && is_string($row[$ak]) && $row[$ak] !== '') {
                        $entry[$ak] = $row[$ak];
                    }
                }
            }
            $out[] = $entry;
        }

        return $out;
    }

    /**
     * @param list<string> $allowedKinds
     *
     * @return list<string> Kinds the run planner may dispatch (excludes {@code intent_only}).
     */
    public static function filterDispatchableKinds(array $allowedKinds): array
    {
        $allow = [];
        foreach ($allowedKinds as $k) {
            $key = strtolower(trim((string) $k));
            if ($key !== '') {
                $allow[$key] = true;
            }
        }
        if ($allow === []) {
            return [];
        }

        $out = [];
        foreach (self::allSorted() as $row) {
            $kind = (string) ($row['agent_kind'] ?? '');
            if ($kind === '' || ! isset($allow[$kind]) || ! empty($row['intent_only'])) {
                continue;
            }
            $out[] = $kind;
        }

        if ($out === []) {
            foreach (array_keys($allow) as $kind) {
                if (! self::isIntentOnlyKind($kind)) {
                    $out[] = $kind;
                }
            }
        }

        return array_values(array_unique($out));
    }

    public static function isIntentOnlyKind(string $agentKind): bool
    {
        $key = strtolower(trim($agentKind));
        if ($key === '') {
            return false;
        }
        $row = self::$entries[$key] ?? null;

        return \is_array($row) && ! empty($row['intent_only']);
    }

    /**
     * Planner intent hints — not dispatchable agent tasks ({@code intent_only} registry rows).
     *
     * @return list<array<string, mixed>>
     */
    public static function catalogForIntentHints(): array
    {
        $out = [];
        foreach (self::allSorted() as $row) {
            if (empty($row['intent_only'])) {
                continue;
            }
            $kind = (string) ($row['agent_kind'] ?? '');
            if ($kind === '') {
                continue;
            }
            $hint = trim((string) ($row['planner_hint'] ?? ''));
            if ($hint === '') {
                $hint = trim((string) ($row['description'] ?? ''));
            }
            $out[] = [
                'agent_kind'   => $kind,
                'name'         => (string) ($row['name'] ?? $kind),
                'description'  => (string) ($row['description'] ?? ''),
                'planner_hint' => $hint,
                'intent_only'  => true,
            ];
        }

        return $out;
    }

    /**
     * @return list<string> Dispatchable kinds for settings UI (excludes {@code intent_only}).
     */
    public static function dispatchableKinds(): array
    {
        $out = [];
        foreach (self::allSorted() as $row) {
            if (! empty($row['intent_only'])) {
                continue;
            }
            $kind = (string) ($row['agent_kind'] ?? '');
            if ($kind !== '') {
                $out[] = $kind;
            }
        }

        return $out;
    }
}
