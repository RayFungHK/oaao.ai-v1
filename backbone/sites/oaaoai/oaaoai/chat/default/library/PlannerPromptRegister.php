<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Numbered planner prompt lines — modules register via {@code planner_prompt.register} (P1).
 *
 * Target API: {@code api('chat')->setPlannerPrompt($module, $slot, $content, $numbered)}.
 */
final class PlannerPromptRegister
{
    /** @var list<array{module: string, slot: string, content: string, numbered: bool, sort: int}> */
    protected static array $entries = [];

    public static function add(string $module, string $slot, string $content, bool $numbered = true, int $sort = 500): void
    {
        $module = trim($module);
        $slot = trim($slot);
        $content = trim($content);
        if ($module === '' || $slot === '' || $content === '') {
            return;
        }

        self::$entries[] = [
            'module'   => $module,
            'slot'     => $slot,
            'content'  => $content,
            'numbered' => $numbered,
            'sort'     => $sort,
        ];
    }

    /**
     * @return list<array{module: string, slot: string, content: string, numbered: bool, sort: int}>
     */
    public static function allSorted(): array
    {
        $values = self::$entries;
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }

    /**
     * Render numbered lines for orchestrator planner system prompt injection.
     */
    public static function numberedBlock(): string
    {
        $lines = [];
        $n = 1;
        foreach (self::allSorted() as $row) {
            if (empty($row['numbered'])) {
                $lines[] = (string) ($row['content'] ?? '');

                continue;
            }
            $slot = trim((string) ($row['slot'] ?? ''));
            $prefix = $slot !== '' ? "{$slot}: " : '';
            $lines[] = $n . '. ' . $prefix . (string) ($row['content'] ?? '');
            ++$n;
        }

        return implode("\n", array_filter($lines, static fn (string $l): bool => trim($l) !== ''));
    }
}
