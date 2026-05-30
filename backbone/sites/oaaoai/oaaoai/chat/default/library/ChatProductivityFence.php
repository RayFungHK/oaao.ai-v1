<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Persist fence preview + visual state (pending / confirmed / dismissed) on assistant meta_json.
 */
final class ChatProductivityFence
{
    /**
     * @param array<string, mixed>|null $meta
     */
    public static function fenceKindIsResolved(?array $meta, string $kind): bool
    {
        if ($meta === null || $meta === []) {
            return false;
        }
        $kind = strtolower(trim($kind));
        if ($kind !== 'calendar' && $kind !== 'todo') {
            return false;
        }
        $fences = $meta['productivity_fences'] ?? null;
        if (! \is_array($fences) || ! isset($fences[$kind]) || ! \is_array($fences[$kind])) {
            return false;
        }
        $state = strtolower(trim((string) ($fences[$kind]['state'] ?? '')));

        return \in_array($state, ['confirmed', 'dismissed'], true);
    }

    /**
     * @param array<string, mixed> $meta
     */
    public static function archiveAction(
        array &$meta,
        string $actionId,
        string $state,
        ?int $conversationId = null,
        ?string $messageContent = null,
    ): void {
        $actionId = strtolower(trim($actionId));
        $state = self::normalizeState($state);
        $kind = self::kindForAction($actionId);
        if ($kind === null) {
            return;
        }

        /** @var array<string, array<string, mixed>> $fences */
        $fences = \is_array($meta['productivity_fences'] ?? null)
            ? $meta['productivity_fences']
            : [];

        $fences[$kind] = array_merge(self::previewForAction($actionId, $meta), ['state' => $state]);
        $meta['productivity_fences'] = $fences;
        self::clearActionKeys($meta, $actionId);
    }

    /**
     * @param array<string, mixed> $meta
     *
     * @return array{agent: string, summary: string, memo: string, items: list<string>}
     */
    public static function previewForAction(string $actionId, array $meta): array
    {
        $actionId = strtolower(trim($actionId));
        $memo = '';
        /** @var list<string> $items */
        $items = [];
        $agent = 'calendar_schedule';
        $summary = '';

        if ($actionId === 'calendar_event_suggested') {
            $raw = $meta['calendar_event_suggested'] ?? null;
            if (\is_array($raw)) {
                $title = trim((string) ($raw['title'] ?? ''));
                $memo = trim((string) ($raw['fence_memo'] ?? ''));
                $items = self::normalizeFenceItems($raw['fence_items'] ?? null);
                if ($memo === '' && $title !== '') {
                    $memo = $title;
                }
                $summary = $title !== '' ? 'Add to calendar? · ' . $title : 'Add to calendar?';
            }
        } elseif (str_starts_with($actionId, 'todo_')) {
            $agent = 'todo_extract';
            $memo = trim((string) ($meta['todo_items_fence_memo'] ?? ''));
            $items = self::normalizeFenceItems($meta['todo_items_fence_items'] ?? null);
            if ($items === []) {
                $raw = $meta['todo_items_suggested'] ?? null;
                if (\is_array($raw) && array_is_list($raw)) {
                    foreach ($raw as $row) {
                        if (! \is_array($row)) {
                            continue;
                        }
                        $t = trim((string) ($row['title'] ?? ''));
                        if ($t !== '') {
                            $items[] = $t;
                        }
                    }
                } elseif (\is_array($meta['todo_item_suggested'] ?? null)) {
                    $t = trim((string) ($meta['todo_item_suggested']['title'] ?? ''));
                    if ($t !== '') {
                        $items[] = $t;
                    }
                }
            }
            $count = \count($items);
            if ($count >= 2) {
                $summary = 'Add ' . $count . ' todos?';
            } elseif ($count === 1) {
                $summary = 'Add to todos? · ' . $items[0];
            } else {
                $summary = 'Add to todos?';
            }
        }

        return [
            'agent'    => $agent,
            'summary'  => $summary,
            'memo'     => $memo,
            'items'    => $items,
        ];
    }

    /**
     * @param array<string, mixed> $meta
     */
    public static function clearActionKeys(array &$meta, string $actionId): void
    {
        $actionId = strtolower(trim($actionId));
        unset($meta[$actionId]);

        if ($actionId === 'calendar_event_suggested') {
            return;
        }

        if (str_starts_with($actionId, 'todo_')) {
            unset(
                $meta['todo_item_suggested'],
                $meta['todo_items_suggested'],
                $meta['todo_items_fence_memo'],
                $meta['todo_items_fence_items'],
            );
        }
    }

    /**
     * @param mixed $raw
     *
     * @return list<string>
     */
    public static function normalizeFenceItems(mixed $raw): array
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
            $out[] = mb_substr($text, 0, 240);
            if (\count($out) >= 24) {
                break;
            }
        }

        return $out;
    }

    private static function normalizeState(string $state): string
    {
        $state = strtolower(trim($state));

        return \in_array($state, ['pending', 'confirmed', 'dismissed'], true) ? $state : 'pending';
    }

    private static function kindForAction(string $actionId): ?string
    {
        if ($actionId === 'calendar_event_suggested') {
            return 'calendar';
        }
        if (str_starts_with($actionId, 'todo_')) {
            return 'todo';
        }

        return null;
    }
}
