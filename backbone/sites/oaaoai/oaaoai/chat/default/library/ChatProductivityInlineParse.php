<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Parse ```oaao-calendar / ```oaao-todo fences from assistant message content (thread reload).
 *
 * @see python/oaao_orchestrator/productivity_inline_extract.py
 */
final class ChatProductivityInlineParse
{
    private const CALENDAR_MIN_CONF = 0.62;

    private const TODO_MIN_CONF = 0.58;

    private const FENCE_ITEMS_MAX = 24;

    private const FENCE_ITEM_MAX_LEN = 240;

    /**
     * Merge inline fence payloads into meta when persist keys are missing.
     *
     * @param array<string, mixed>|null $meta
     * @return array<string, mixed>|null
     */
    public static function enrichMetaFromContent(?array $meta, string $content, int $conversationId): ?array
    {
        $text = trim($content);
        if ($text === '') {
            return $meta;
        }

        $out = \is_array($meta) ? $meta : [];

        $hasPersisted = (
            ! empty($out['calendar_event_suggested'])
            || ! empty($out['todo_item_suggested'])
            || (isset($out['todo_items_suggested']) && \is_array($out['todo_items_suggested']) && \count($out['todo_items_suggested']) >= 2)
        );
        if ($hasPersisted) {
            return $out;
        }

        $attached = self::extractFromText($text, $conversationId);
        if ($attached === []) {
            return $out;
        }

        if (isset($attached['calendar_event_suggested']) && ChatProductivityFence::fenceKindIsResolved($out, 'calendar')) {
            unset($attached['calendar_event_suggested']);
        }
        if (ChatProductivityFence::fenceKindIsResolved($out, 'todo')) {
            foreach ([
                'todo_item_suggested',
                'todo_items_suggested',
                'todo_items_fence_memo',
                'todo_items_fence_items',
            ] as $todoKey) {
                unset($attached[$todoKey]);
            }
        }
        if ($attached === []) {
            return $out;
        }

        foreach ($attached as $key => $value) {
            $out[$key] = $value;
        }

        return $out;
    }

    /**
     * Strip fences from visible assistant prose.
     */
    public static function stripFencesFromContent(string $content): string
    {
        $stripped = preg_replace(
            '/```oaao-(?:calendar|todo)\s*\n[\s\S]*?```\s*/iu',
            '',
            $content,
        );
        if (! \is_string($stripped)) {
            return $content;
        }

        return trim((string) preg_replace("/\n{3,}/", "\n\n", $stripped));
    }

    /**
     * @return array<string, mixed>
     */
    private static function extractFromText(string $text, int $conversationId): array
    {
        $attached = [];
        $foundFence = false;

        if (preg_match('/```oaao-calendar\s*\n([\s\S]*?)```/iu', $text, $m)) {
            $foundFence = true;
            $cal = self::parseCalendarFence((string) ($m[1] ?? ''), $conversationId);
            if ($cal !== null) {
                $attached['calendar_event_suggested'] = $cal;
            }
        }

        if (preg_match('/```oaao-todo\s*\n([\s\S]*?)```/iu', $text, $m)) {
            $foundFence = true;
            $attached = array_merge($attached, self::parseTodoFence((string) ($m[1] ?? ''), $conversationId));
        }

        if ($foundFence) {
            $attached['productivity_inline_extracted'] = true;
        }

        return $attached;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function parseCalendarFence(string $body, int $conversationId): ?array
    {
        $obj = self::decodeJsonObject($body);
        if ($obj === null) {
            return null;
        }

        if (isset($obj['actions']) && \is_array($obj['actions'])) {
            foreach ($obj['actions'] as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                if ((string) ($row['type'] ?? '') !== 'calendar_event_suggested') {
                    continue;
                }
                unset($row['type']);
                $hit = self::normalizeCalendar($row, $conversationId);

                return $hit;
            }

            return null;
        }

        return self::normalizeCalendar($obj, $conversationId);
    }

    /**
     * @return array<string, mixed>
     */
    private static function parseTodoFence(string $body, int $conversationId): array
    {
        $obj = self::decodeJsonObject($body);
        if ($obj === null) {
            return [];
        }

        $out = [];
        $out = array_merge($out, self::packTodoFencePreview($obj));

        $type = strtolower(trim((string) ($obj['type'] ?? '')));
        if ($type === 'todo_items_suggested' && isset($obj['items']) && \is_array($obj['items'])) {
            return array_merge($out, self::packTodoItems($obj['items'], $conversationId));
        }

        if ($type === 'todo_item_suggested') {
            $one = self::normalizeTodoItem($obj, $conversationId);

            return $one !== null ? array_merge($out, ['todo_item_suggested' => $one]) : $out;
        }

        if (isset($obj['items']) && \is_array($obj['items'])) {
            return array_merge($out, self::packTodoItems($obj['items'], $conversationId));
        }

        $one = self::normalizeTodoItem($obj, $conversationId);

        return $one !== null ? array_merge($out, ['todo_item_suggested' => $one]) : $out;
    }

    /**
     * @param list<mixed> $items
     * @return array<string, mixed>
     */
    private static function packTodoItems(array $items, int $conversationId): array
    {
        $norm = [];
        foreach ($items as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $hit = self::normalizeTodoItem($row, $conversationId);
            if ($hit !== null) {
                $norm[] = $hit;
            }
        }
        if (\count($norm) >= 2) {
            return ['todo_items_suggested' => $norm];
        }
        if (\count($norm) === 1) {
            return ['todo_item_suggested' => $norm[0]];
        }

        return [];
    }

    /**
     * @param array<string, mixed> $obj
     * @return array<string, mixed>|null
     */
    private static function normalizeCalendar(array $obj, int $conversationId): ?array
    {
        $title = trim((string) ($obj['title'] ?? ''));
        $start = trim((string) ($obj['start_at'] ?? ''));
        if ($title === '' || $start === '') {
            return null;
        }
        $conf = self::clampConf($obj['confidence'] ?? null, 0.85);
        if ($conf < self::CALENDAR_MIN_CONF) {
            return null;
        }
        $end = trim((string) ($obj['end_at'] ?? $start));
        $timezone = trim((string) ($obj['timezone'] ?? 'UTC'));

        $out = [
            'title'           => mb_substr($title, 0, 200),
            'start_at'        => $start,
            'end_at'          => $end !== '' ? $end : $start,
            'all_day'         => ! empty($obj['all_day']),
            'timezone'        => $timezone !== '' ? $timezone : 'UTC',
            'location'        => mb_substr(trim((string) ($obj['location'] ?? '')), 0, 200),
            'notes'           => mb_substr(trim((string) ($obj['notes'] ?? '')), 0, 400),
            'confidence'      => round($conf, 3),
            'conversation_id' => $conversationId,
        ];
        $memo = trim((string) ($obj['fence_memo'] ?? ''));
        if ($memo !== '') {
            $out['fence_memo'] = mb_substr($memo, 0, 1200);
        }
        $fenceItems = self::normalizeFenceItems($obj['fence_items'] ?? null);
        if ($fenceItems !== []) {
            $out['fence_items'] = $fenceItems;
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $obj
     * @return array<string, mixed>
     */
    private static function packTodoFencePreview(array $obj): array
    {
        $out = [];
        $memo = trim((string) ($obj['fence_memo'] ?? ''));
        if ($memo !== '') {
            $out['todo_items_fence_memo'] = mb_substr($memo, 0, 1200);
        }
        $fenceItems = self::normalizeFenceItems($obj['fence_items'] ?? null);
        if ($fenceItems !== []) {
            $out['todo_items_fence_items'] = $fenceItems;
        }

        return $out;
    }

    /**
     * @param mixed $raw
     * @return list<string>
     */
    private static function normalizeFenceItems(mixed $raw): array
    {
        if (! \is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $row) {
            $text = '';
            if (\is_string($row)) {
                $text = trim($row);
            } elseif (\is_array($row)) {
                foreach (['text', 'title', 'label', 'memo'] as $key) {
                    if (! empty($row[$key]) && \is_scalar($row[$key])) {
                        $text = trim((string) $row[$key]);
                        break;
                    }
                }
            }
            if ($text === '') {
                continue;
            }
            $out[] = mb_substr($text, 0, self::FENCE_ITEM_MAX_LEN);
            if (\count($out) >= self::FENCE_ITEMS_MAX) {
                break;
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $obj
     * @return array<string, mixed>|null
     */
    private static function normalizeTodoItem(array $obj, int $conversationId): ?array
    {
        $title = trim((string) ($obj['title'] ?? ''));
        if ($title === '') {
            return null;
        }
        $conf = self::clampConf($obj['confidence'] ?? null, 0.8);
        if ($conf < self::TODO_MIN_CONF) {
            return null;
        }

        $priority = trim((string) ($obj['priority'] ?? 'normal'));

        return [
            'title'             => mb_substr($title, 0, 120),
            'context_snippet'   => mb_substr(trim((string) ($obj['context_snippet'] ?? '')), 0, 200),
            'confidence'        => round($conf, 3),
            'conversation_id'   => $conversationId,
            'priority'          => $priority !== '' ? $priority : 'normal',
            'due_at'            => $obj['due_at'] ?? null,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function decodeJsonObject(string $raw): ?array
    {
        $text = trim($raw);
        if ($text === '') {
            return null;
        }
        if (preg_match('/```(?:json)?\s*([\s\S]*?)```/i', $text, $m)) {
            $text = trim((string) ($m[1] ?? ''));
        }
        try {
            $obj = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $start = strpos($text, '{');
            $end = strrpos($text, '}');
            if ($start === false || $end === false || $end <= $start) {
                return null;
            }
            try {
                $obj = json_decode(substr($text, $start, $end - $start + 1), true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return null;
            }
        }

        return \is_array($obj) ? $obj : null;
    }

    private static function clampConf(mixed $raw, float $default): float
    {
        if (! is_numeric($raw)) {
            return $default;
        }
        $v = (float) $raw;

        return max(0.0, min(1.0, $v));
    }
}
