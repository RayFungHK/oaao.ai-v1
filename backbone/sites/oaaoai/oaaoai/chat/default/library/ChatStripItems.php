<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Normalize assistant {@code meta_json} productivity keys into canonical strip {@code items[]}.
 *
 * @see docs/design/strip-chip-shell.md
 */
final class ChatStripItems
{
    /** @var array<string, array{agent: string, confirmation: bool, confirm_label: string}> */
    private const ACTION_ROWS = [
        'calendar_event_suggested' => [
            'agent'         => 'calendar_schedule',
            'confirmation'  => true,
            'confirm_label' => 'Add to calendar',
        ],
        'todo_item_suggested' => [
            'agent'         => 'todo_extract',
            'confirmation'  => true,
            'confirm_label' => 'Add to todos',
        ],
        'todo_items_suggested' => [
            'agent'         => 'todo_extract',
            'confirmation'  => true,
            'confirm_label' => 'Add to todos',
        ],
        'todo_resolve_suggested' => [
            'agent'         => 'todo_extract',
            'confirmation'  => false,
            'confirm_label' => 'Resolve',
        ],
    ];

    /**
     * @param array<string, mixed> $meta
     * @return list<array<string, mixed>>
     */
    public static function buildItemsFromMeta(int $userId, int $conversationId, int $messageId, array $meta): array
    {
        if ($userId < 1 || $conversationId < 1 || $messageId < 1) {
            return [];
        }

        if (isset($meta['items']) && \is_array($meta['items']) && $meta['items'] !== []) {
            /** @var list<array<string, mixed>> $out */
            $out = [];
            foreach ($meta['items'] as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $out[] = self::ensureItemFields($userId, $conversationId, $messageId, $row);
            }

            return $out;
        }

        /** @var list<array<string, mixed>> $items */
        $items = [];
        foreach (self::ACTION_ROWS as $actionId => $cfg) {
            $kind = match (true) {
                $actionId === 'calendar_event_suggested' => 'calendar',
                str_starts_with($actionId, 'todo_')       => 'todo',
                default                                    => null,
            };
            if ($kind !== null && ChatProductivityFence::fenceKindIsResolved($meta, $kind)) {
                continue;
            }
            if (! \array_key_exists($actionId, $meta) || $meta[$actionId] === null) {
                continue;
            }
            $raw = $meta[$actionId];
            $digestPayload = $raw;
            $clientPayload = $raw;
            if ($actionId === 'todo_items_suggested' && \is_array($raw) && array_is_list($raw)) {
                $clientPayload = ['items' => $raw];
                $fenceMemo = trim((string) ($meta['todo_items_fence_memo'] ?? ''));
                if ($fenceMemo !== '') {
                    $clientPayload['fence_memo'] = $fenceMemo;
                }
                $fenceItems = ChatProductivityFence::normalizeFenceItems(
                    $meta['todo_items_fence_items'] ?? null,
                );
                if ($fenceItems !== []) {
                    $clientPayload['fence_items'] = $fenceItems;
                }
            }
            if (! \is_array($digestPayload) && ! (\is_array($raw) && array_is_list($raw))) {
                continue;
            }
            $preview = self::previewFor($actionId, $raw);
            $items[] = self::ensureItemFields($userId, $conversationId, $messageId, [
                'agent'           => $cfg['agent'],
                'action_id'       => $actionId,
                'description'     => self::descriptionFor($actionId, $raw),
                'confirm_label'   => $cfg['confirm_label'],
                'confirmation'    => $preview['confirmation'],
                'message'         => $preview['message'],
                'message_format'  => $preview['message_format'],
                'conversation_id' => $conversationId,
                'message_id'      => $messageId,
                'payload'         => $clientPayload,
            ], $digestPayload);
        }

        return $items;
    }

    /**
     * @param array<string, mixed>|null $meta
     *
     * @return array<string, mixed>|null
     */
    public static function enrichMetaForClient(
        int $userId,
        int $conversationId,
        int $messageId,
        ?array $meta,
    ): ?array {
        if ($meta === null || $meta === []) {
            return $meta;
        }
        $items = self::buildItemsFromMeta($userId, $conversationId, $messageId, $meta);
        if ($items === []) {
            return $meta;
        }
        $meta['items'] = $items;

        return $meta;
    }

    /**
     * @param array<string, mixed> $row
     * @param mixed $digestPayload
     *
     * @return array<string, mixed>
     */
    private static function ensureItemFields(
        int $userId,
        int $conversationId,
        int $messageId,
        array $row,
        mixed $digestPayload = null,
    ): array {
        $actionId = strtolower(trim((string) ($row['action_id'] ?? '')));
        if ($actionId !== '' && ! isset($row['confirmation'])) {
            $cfg = self::ACTION_ROWS[$actionId] ?? null;
            if (\is_array($cfg)) {
                $row['confirmation'] = $cfg['confirmation'];
            }
        }
        if ($actionId !== '' && ! isset($row['message']) && \array_key_exists($actionId, self::ACTION_ROWS)) {
            $raw = $row['payload'] ?? null;
            if ($actionId === 'todo_items_suggested' && \is_array($raw) && isset($raw['items'])) {
                $preview = self::previewFor($actionId, $raw['items']);
            } else {
                $preview = self::previewFor($actionId, $raw);
            }
            $row['message'] = $preview['message'];
            $row['message_format'] = $preview['message_format'];
        }
        if (! isset($row['message_format'])) {
            $row['message_format'] = 'markdown';
        }

        if ($actionId === '') {
            return $row;
        }
        if (! empty($row['strip_hash']) && \is_string($row['strip_hash'])) {
            $row['conversation_id'] = $conversationId;
            $row['message_id'] = $messageId;

            return $row;
        }
        $payload = $digestPayload;
        if ($payload === null) {
            $payload = $row['payload'] ?? [];
        }
        if (\is_array($payload) && $actionId === 'todo_items_suggested' && isset($payload['items']) && \is_array($payload['items'])) {
            $payload = $payload['items'];
        }
        if (! \is_array($payload)) {
            return $row;
        }
        try {
            $row['strip_hash'] = ChatStripHash::issue(
                $userId,
                $conversationId,
                $messageId,
                $actionId,
                $payload,
            );
        } catch (\Throwable $e) {
            error_log(
                '[oaao strip] strip_hash issue failed action=' . $actionId
                . ' conversation=' . $conversationId . ' message=' . $messageId
                . ': ' . $e->getMessage(),
            );

            return $row;
        }
        $row['conversation_id'] = $conversationId;
        $row['message_id'] = $messageId;

        return $row;
    }

    /**
     * @return array{confirmation: bool, message: string, message_format: string}
     */
    private static function previewFor(string $actionId, mixed $raw): array
    {
        $cfg = self::ACTION_ROWS[$actionId] ?? ['confirmation' => true];
        $confirmation = (bool) ($cfg['confirmation'] ?? true);
        if ($actionId === 'calendar_event_suggested' && \is_array($raw)) {
            $title = trim((string) ($raw['title'] ?? ''));
            $start = trim((string) ($raw['start_at'] ?? ''));
            $end = trim((string) ($raw['end_at'] ?? ''));
            $lines = [];
            if ($title !== '') {
                $lines[] = "**{$title}**";
                $lines[] = '';
            }
            if ($start !== '' || $end !== '') {
                $lines[] = trim("{$start}–{$end}", "– \t\n\r\0\x0B");
            }
            $location = trim((string) ($raw['location'] ?? ''));
            if ($location !== '') {
                $lines[] = $location;
            }
            $notes = trim((string) ($raw['notes'] ?? ''));
            if ($notes !== '') {
                $lines[] = $notes;
            }

            return [
                'confirmation'   => $confirmation,
                'message'        => implode("\n", array_filter($lines, static fn (string $l): bool => $l !== '')),
                'message_format' => 'markdown',
            ];
        }
        if ($actionId === 'todo_item_suggested' && \is_array($raw)) {
            $title = trim((string) ($raw['title'] ?? ''));
            $snippet = trim((string) ($raw['context_snippet'] ?? ''));
            $lines = $title !== '' ? ["**{$title}**", ''] : [];
            if ($snippet !== '') {
                $lines[] = $snippet;
            }

            return [
                'confirmation'   => $confirmation,
                'message'        => implode("\n", $lines),
                'message_format' => 'markdown',
            ];
        }
        if ($actionId === 'todo_items_suggested' && \is_array($raw) && array_is_list($raw)) {
            $bullets = [];
            foreach ($raw as $item) {
                if (! \is_array($item)) {
                    continue;
                }
                $t = trim((string) ($item['title'] ?? ''));
                if ($t !== '') {
                    $bullets[] = "- {$t}";
                }
            }

            return [
                'confirmation'   => $confirmation,
                'message'        => implode("\n", $bullets),
                'message_format' => 'markdown',
            ];
        }
        if ($actionId === 'todo_resolve_suggested' && \is_array($raw)) {
            $title = trim((string) ($raw['title'] ?? 'Todo'));

            return [
                'confirmation'   => false,
                'message'        => "Mark **{$title}** as done?",
                'message_format' => 'markdown',
            ];
        }

        return [
            'confirmation'   => $confirmation,
            'message'        => '',
            'message_format' => 'markdown',
        ];
    }

    private static function descriptionFor(string $actionId, mixed $raw): string
    {
        if ($actionId === 'calendar_event_suggested' && \is_array($raw)) {
            $title = trim((string) ($raw['title'] ?? ''));

            return $title !== '' ? "Add to calendar? · {$title}" : 'Add to calendar?';
        }
        if ($actionId === 'todo_item_suggested' && \is_array($raw)) {
            $title = trim((string) ($raw['title'] ?? ''));

            return $title !== '' ? "Add to todos? · {$title}" : 'Add to todos?';
        }
        if ($actionId === 'todo_items_suggested' && \is_array($raw) && array_is_list($raw)) {
            $n = \count($raw);

            return $n >= 2 ? "Add {$n} todos?" : 'Add to todos?';
        }
        if ($actionId === 'todo_resolve_suggested' && \is_array($raw)) {
            $title = trim((string) ($raw['title'] ?? 'Todo'));

            return "Mark done: {$title}";
        }

        return 'Suggested action';
    }
}
