<?php

declare(strict_types=1);

namespace oaaoai\calendar;

/**
 * Dynamic planner prompt appendix — upcoming events for conflict checks during the main run.
 */
final class CalendarSendPlannerPrompt
{
    /**
     * @param list<array{event_id?: int, title?: string, start_at?: string, end_at?: string, location?: string}> $events
     */
    public static function dynamicBlock(array $events): string
    {
        if ($events === []) {
            return '';
        }

        $lines = ['Upcoming calendar (do not double-book; past times must not be suggested as new events):'];
        $n = 0;
        foreach ($events as $row) {
            if ($n >= 24) {
                $lines[] = '…';

                break;
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
                    $bit .= '–' . $end;
                }
            }
            if ($loc !== '') {
                $bit .= ' @ ' . $loc;
            }
            $lines[] = '- ' . $bit;
            $n += 1;
        }

        return $lines === [] ? '' : implode("\n", $lines);
    }
}
