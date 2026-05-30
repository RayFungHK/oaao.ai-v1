<?php

declare(strict_types=1);

namespace oaaoai\todo;

/**
 * Dynamic planner prompt appendix — open todos for duplicate checks during the main run.
 */
final class TodoSendPlannerPrompt
{
    /**
     * @param list<array{todo_id?: int, title?: string}> $items
     */
    public static function dynamicBlock(array $items): string
    {
        if ($items === []) {
            return '';
        }

        $lines = ['Open todos for this conversation (avoid duplicating titles when proposing new tasks):'];
        $n = 0;
        foreach ($items as $row) {
            if ($n >= 30) {
                $lines[] = '…';

                break;
            }
            $title = trim((string) ($row['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $lines[] = '- ' . $title;
            $n += 1;
        }

        return $n > 0 ? implode("\n", $lines) : '';
    }
}
