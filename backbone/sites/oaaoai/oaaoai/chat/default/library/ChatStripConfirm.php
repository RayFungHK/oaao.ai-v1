<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Server-side strip confirm — verify hash, execute registry action, clear meta.
 *
 * @see docs/design/strip-chip-shell.md
 */
final class ChatStripConfirm
{
    /**
     * @param array<string, mixed> $meta
     */
    public static function isAlreadyResolved(array $meta, string $actionId): bool
    {
        $actionId = strtolower(trim($actionId));
        $kind = match (true) {
            $actionId === 'calendar_event_suggested' => 'calendar',
            str_starts_with($actionId, 'todo_')       => 'todo',
            default                                    => null,
        };
        if ($kind === null) {
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
     * @param array<string, mixed> $claims Verified strip_hash claims
     * @param array<string, mixed> $payload Bound suggestion payload from meta_json
     *
     * @return array{success: bool, data?: array<string, mixed>, message?: string, http?: int}
     */
    public static function execute(
        \Razy\Controller $controller,
        int $uid,
        int $workspaceId,
        array $claims,
        array $payload,
    ): array {
        $actionId = strtolower(trim((string) ($claims['action_id'] ?? '')));
        if ($actionId === '') {
            return ['success' => false, 'message' => 'Invalid action_id', 'http' => 400];
        }

        $registry = StripActionRegister::get($actionId);
        $confirmApi = trim((string) ($registry['confirm_api'] ?? ''));

        return match ($confirmApi) {
            'calendar_events_save' => self::executeCalendarSave(
                $controller,
                $uid,
                $workspaceId,
                $claims,
                $payload,
            ),
            'todos_save' => self::executeTodosSave(
                $controller,
                $uid,
                $workspaceId,
                $claims,
                $payload,
                $actionId,
            ),
            'todos_resolve' => self::executeTodosResolve($controller, $uid, $payload),
            default => ['success' => false, 'message' => 'Unsupported strip action', 'http' => 501],
        };
    }

    /**
     * @param mixed $raw
     *
     * @return array<string, mixed>|null
     */
    public static function payloadFromMeta(string $actionId, mixed $raw): ?array
    {
        $actionId = strtolower(trim($actionId));
        if ($raw === null) {
            return null;
        }

        if ($actionId === 'todo_items_suggested') {
            if (\is_array($raw) && array_is_list($raw)) {
                return ['items' => $raw];
            }
            if (\is_array($raw) && isset($raw['items']) && \is_array($raw['items'])) {
                return $raw;
            }

            return null;
        }

        return \is_array($raw) ? $raw : null;
    }

    /**
     * Attach fence preview fields from meta_json for batch todo confirm (digest unchanged).
     *
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $meta
     *
     * @return array<string, mixed>
     */
    public static function enrichTodoPayloadFromMeta(array $payload, array $meta): array
    {
        $memo = trim((string) ($payload['fence_memo'] ?? ''));
        if ($memo === '') {
            $memo = trim((string) ($meta['todo_items_fence_memo'] ?? ''));
            if ($memo !== '') {
                $payload['fence_memo'] = $memo;
            }
        }
        $fenceItems = ChatProductivityFence::normalizeFenceItems($payload['fence_items'] ?? null);
        if ($fenceItems === []) {
            $fenceItems = ChatProductivityFence::normalizeFenceItems($meta['todo_items_fence_items'] ?? null);
            if ($fenceItems !== []) {
                $payload['fence_items'] = $fenceItems;
            }
        }

        return $payload;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function verifyPayloadDigest(array $claims, array $payload): bool
    {
        $expect = trim((string) ($claims['payload_digest'] ?? ''));
        if ($expect === '') {
            return false;
        }

        $actionId = strtolower(trim((string) ($claims['action_id'] ?? '')));
        $candidates = [$payload];
        if ($actionId === 'todo_items_suggested') {
            if (isset($payload['items']) && \is_array($payload['items'])) {
                $candidates[] = $payload['items'];
            }
            if (array_is_list($payload)) {
                $candidates[] = ['items' => $payload];
            }
        }

        foreach ($candidates as $candidate) {
            if (! \is_array($candidate)) {
                continue;
            }
            $digestPayload = $candidate;
            if (
                $actionId === 'todo_items_suggested'
                && isset($candidate['items'])
                && \is_array($candidate['items'])
                && array_is_list($candidate['items'])
            ) {
                $digestPayload = $candidate['items'];
            }
            if (hash_equals($expect, ChatStripHash::payloadDigest($digestPayload))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return list<array<string, mixed>>
     */
    private static function todoRowsFromPayload(array $payload, string $actionId): array
    {
        $actionId = strtolower(trim($actionId));
        /** @var list<array<string, mixed>> $rows */
        $rows = [];
        if ($actionId === 'todo_items_suggested') {
            $items = $payload['items'] ?? [];
            if (\is_array($items)) {
                foreach ($items as $item) {
                    if (\is_array($item)) {
                        $rows[] = $item;
                    }
                }
            }
        } else {
            $rows[] = $payload;
        }

        $hasTitle = false;
        foreach ($rows as $row) {
            if (trim((string) ($row['title'] ?? '')) !== '') {
                $hasTitle = true;
                break;
            }
        }
        if ($hasTitle) {
            return $rows;
        }

        $fenceItems = ChatProductivityFence::normalizeFenceItems($payload['fence_items'] ?? null);
        if ($fenceItems === []) {
            return $rows;
        }

        /** @var list<array<string, mixed>> $fromFence */
        $fromFence = [];
        foreach ($fenceItems as $text) {
            $fromFence[] = [
                'title'    => $text,
                'priority' => 'normal',
            ];
        }

        return $fromFence;
    }

    /**
     * @param array<string, mixed> $claims
     * @param array<string, mixed> $payload
     *
     * @return array{success: bool, data?: array<string, mixed>, message?: string, http?: int}
     */
    private static function executeCalendarSave(
        \Razy\Controller $controller,
        int $uid,
        int $workspaceId,
        array $claims,
        array $payload,
    ): array {
        require_once dirname(__DIR__, 3) . '/calendar/default/controller/api/_calendar_api_bootstrap.php';

        $ctx = oaao_calendar_require_pg($controller, true);
        if ($ctx === null) {
            return ['success' => false, 'message' => 'Calendar unavailable', 'http' => 503];
        }

        $title = trim((string) ($payload['title'] ?? ''));
        $startAt = trim((string) ($payload['start_at'] ?? ''));
        $endAt = trim((string) ($payload['end_at'] ?? ''));
        if ($title === '' || $startAt === '' || $endAt === '') {
            return ['success' => false, 'message' => 'title, start_at, end_at required', 'http' => 400];
        }

        $wid = $workspaceId > 0 ? $workspaceId : null;
        $cid = (int) ($claims['conversation_id'] ?? 0);
        $mid = (int) ($claims['message_id'] ?? 0);
        $allDay = ! empty($payload['all_day']);
        $timezone = trim((string) ($payload['timezone'] ?? 'UTC')) ?: 'UTC';
        $location = trim((string) ($payload['location'] ?? ''));
        $notes = trim((string) ($payload['notes'] ?? ''));
        $now = date('Y-m-d H:i:s');

        $pdo = $ctx['pdo'];
        $st = $pdo->prepare(
            'INSERT INTO oaao_calendar_event (
                tenant_id, workspace_id, title, start_at, end_at, all_day, timezone,
                location, notes, status, conversation_id, message_id, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING event_id',
        );
        $st->execute([
            (int) $ctx['tenant_id'],
            $wid,
            $title,
            $startAt,
            $endAt,
            $allDay ? 1 : 0,
            $timezone,
            $location !== '' ? $location : null,
            $notes !== '' ? $notes : null,
            'confirmed',
            $cid > 0 ? $cid : null,
            $mid > 0 ? $mid : null,
            $uid,
            $now,
            $now,
        ]);
        $eventId = (int) $st->fetchColumn();

        return [
            'success' => true,
            'data'    => ['event_id' => $eventId, 'action_id' => 'calendar_event_suggested'],
        ];
    }

    /**
     * @param array<string, mixed> $claims
     * @param array<string, mixed> $payload
     *
     * @return array{success: bool, data?: array<string, mixed>, message?: string, http?: int}
     */
    private static function executeTodosSave(
        \Razy\Controller $controller,
        int $uid,
        int $workspaceId,
        array $claims,
        array $payload,
        string $actionId,
    ): array {
        require_once dirname(__DIR__, 3) . '/todo/default/controller/api/_todo_api_bootstrap.php';

        $ctx = oaao_todo_require_pg($controller, true);
        if ($ctx === null) {
            return ['success' => false, 'message' => 'Todos unavailable', 'http' => 503];
        }

        $cid = (int) ($claims['conversation_id'] ?? 0);
        $mid = (int) ($claims['message_id'] ?? 0);
        $wid = $workspaceId > 0 ? $workspaceId : null;

        $rows = self::todoRowsFromPayload($payload, $actionId);
        if ($rows === []) {
            return ['success' => false, 'message' => 'items required', 'http' => 400];
        }

        $created = [];
        $pdo = $ctx['pdo'];
        $now = date('Y-m-d H:i:s');
        foreach ($rows as $row) {
            $title = trim((string) ($row['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            if (preg_match('/^\*\*(.+)\*\*$/u', $title, $m) === 1) {
                $title = trim((string) ($m[1] ?? ''));
            }
            $title = trim($title, " \t\n\r\0\x0B*");
            if ($title === '') {
                continue;
            }
            $title = mb_substr($title, 0, 512);
            $priority = trim((string) ($row['priority'] ?? 'normal'));
            if (! \in_array($priority, ['low', 'normal', 'high'], true)) {
                $priority = 'normal';
            }
            $dueAt = trim((string) ($row['due_at'] ?? ''));
            $dueVal = $dueAt !== '' ? $dueAt : null;
            $context = trim((string) ($row['context_snippet'] ?? ''));
            $contextVal = $context !== '' ? mb_substr($context, 0, 2000) : null;

            $st = $pdo->prepare(
                'INSERT INTO oaao_todo_item (
                    tenant_id, user_id, workspace_id, title, status, priority, due_at,
                    context_snippet, conversation_id, message_id, completed_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 RETURNING todo_id',
            );
            $st->execute([
                (int) $ctx['tenant_id'],
                $uid,
                $wid,
                $title,
                'open',
                $priority,
                $dueVal,
                $contextVal,
                $cid > 0 ? $cid : null,
                $mid > 0 ? $mid : null,
                null,
                $now,
                $now,
            ]);
            $created[] = (int) $st->fetchColumn();
        }

        if ($created === []) {
            return ['success' => false, 'message' => 'No todos to save', 'http' => 400];
        }

        return [
            'success' => true,
            'data'    => [
                'todo_ids'  => $created,
                'action_id' => $actionId,
            ],
        ];
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array{success: bool, data?: array<string, mixed>, message?: string, http?: int}
     */
    private static function executeTodosResolve(
        \Razy\Controller $controller,
        int $uid,
        array $payload,
    ): array {
        require_once dirname(__DIR__, 3) . '/todo/default/controller/api/_todo_api_bootstrap.php';

        $ctx = oaao_todo_require_pg($controller, true);
        if ($ctx === null) {
            return ['success' => false, 'message' => 'Todos unavailable', 'http' => 503];
        }

        $todoId = (int) ($payload['todo_id'] ?? 0);
        if ($todoId < 1) {
            return ['success' => false, 'message' => 'todo_id required', 'http' => 400];
        }

        $now = date('Y-m-d H:i:s');
        $st = $ctx['pdo']->prepare(
            'UPDATE oaao_todo_item
             SET status = ?, completed_at = ?, updated_at = ?
             WHERE todo_id = ? AND tenant_id = ? AND user_id = ? AND status = ?',
        );
        $st->execute(['done', $now, $now, $todoId, $ctx['tenant_id'], $uid, 'open']);

        if ($st->rowCount() < 1) {
            return ['success' => false, 'message' => 'Open todo not found', 'http' => 404];
        }

        return [
            'success' => true,
            'data'    => ['todo_id' => $todoId, 'action_id' => 'todo_resolve_suggested'],
        ];
    }
}
