<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * PHP-owned orchestrator prompt injections by stage — forwarded as {@code module_prompts}.
 *
 * Stages: {@code planner}, {@code compose_assistant}, {@code after_turn}.
 * Python renders {@code template_ref} + {@code variables} only; no gating heuristics.
 */
final class ModulePromptPayload
{
    /** @var list<string> */
    private const PRODUCTIVITY_POST_TURN_IDS = [
        'calendar_event_suggested',
        'todo_item_suggested',
        'todo_items_suggested',
        'todo_resolve_suggested',
    ];

    /**
     * @param array<string, mixed> $mergedPayload
     * @param list<array<string, mixed>> $postTurnActions
     *
     * @return array<string, mixed>
     */
    public static function build(array $mergedPayload, array $postTurnActions): array
    {
        $out = [];

        $planner = PlannerPromptRegister::slotMap();
        if ($planner !== []) {
            $out['planner'] = $planner;
        }

        if (self::productivityPostTurnEnabled($postTurnActions)) {
            $compose = ComposePromptRegister::forOrchestrator($mergedPayload);
            if ($compose !== []) {
                $out['compose_assistant'] = $compose;
            }
        }

        $afterTurn = self::afterTurnSpecs($mergedPayload, $postTurnActions);
        if ($afterTurn !== []) {
            $out['after_turn'] = $afterTurn;
        }

        return $out;
    }

    /**
     * @param mixed $raw
     */
    public static function formatCalendarEvents(mixed $raw): string
    {
        if (! \is_array($raw) || $raw === []) {
            return '(none)';
        }

        $lines = [];
        $n = 0;
        foreach ($raw as $row) {
            if ($n >= 32) {
                break;
            }
            if (! \is_array($row)) {
                continue;
            }
            $title = trim((string) ($row['title'] ?? ''));
            $start = trim((string) ($row['start_at'] ?? ''));
            $end = trim((string) ($row['end_at'] ?? ''));
            $loc = trim((string) ($row['location'] ?? ''));
            if ($title === '' && $start === '') {
                continue;
            }
            $bit = $title !== '' ? $title : 'Event';
            if ($start !== '') {
                $bit .= ' · ' . $start;
                if ($end !== '' && $end !== $start) {
                    $bit .= ' – ' . $end;
                }
            }
            if ($loc !== '') {
                $bit .= ' @ ' . $loc;
            }
            $lines[] = '- ' . $bit;
            $n += 1;
        }

        return $lines === [] ? '(none)' : implode("\n", $lines);
    }

    /**
     * @param mixed $raw
     */
    public static function formatOpenTodos(mixed $raw): string
    {
        if (! \is_array($raw) || $raw === []) {
            return '(none)';
        }

        $lines = [];
        $n = 0;
        foreach ($raw as $row) {
            if ($n >= 40) {
                break;
            }
            if (! \is_array($row)) {
                continue;
            }
            $title = trim((string) ($row['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $lines[] = '- ' . $title;
            $n += 1;
        }

        return $lines === [] ? '(none)' : implode("\n", $lines);
    }

    /**
     * @param list<array<string, mixed>> $postTurnActions
     */
    private static function productivityPostTurnEnabled(array $postTurnActions): bool
    {
        foreach ($postTurnActions as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $actionId = strtolower(trim((string) ($row['action_id'] ?? '')));
            if (! \in_array($actionId, self::PRODUCTIVITY_POST_TURN_IDS, true)) {
                continue;
            }
            if (($row['enabled'] ?? true) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $mergedPayload
     * @param list<array<string, mixed>> $postTurnActions
     *
     * @return array<string, array{template_ref: string, variables: array<string, string>}>
     */
    private static function afterTurnSpecs(array $mergedPayload, array $postTurnActions): array
    {
        $variables = [
            'upcoming_calendar_events' => self::formatCalendarEvents($mergedPayload['upcoming_calendar_events'] ?? null),
            'open_todo_items'          => self::formatOpenTodos($mergedPayload['open_todo_items'] ?? null),
        ];

        $out = [];
        foreach ($postTurnActions as $row) {
            if (! \is_array($row)) {
                continue;
            }
            if (($row['enabled'] ?? true) === false) {
                continue;
            }
            $actionId = trim((string) ($row['action_id'] ?? ''));
            $ref = trim((string) ($row['template_ref'] ?? ''));
            if ($actionId === '' || $ref === '') {
                continue;
            }
            $out[$actionId] = [
                'template_ref' => $ref,
                'variables'    => $variables,
            ];
        }

        return $out;
    }
}
