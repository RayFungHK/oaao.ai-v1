<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Razy\Database;

/**
 * Aggregated [info] worker payload — turn scores + productivity status + strip items.
 *
 * Cal/Todo productivity rows come only from {@link InfoWorkerRegister} (modules via
 * {@code info_worker.register} during {@link \oaaoai\endpoints\FeatureRegistryBootstrap::collect()}).
 * API entry points must bootstrap registries before {@see buildPayload()} — not hardcoded here.
 *
 * @see docs/design/chat-modular-architecture.md §1 (registries scale without editing chat core)
 * @see docs/design/chat-ui-areas.md § [info]
 */
final class ChatInfoWorker
{
    /**
     * @return array<string, mixed>
     */
    /**
     * @param list<int>|null $messageIds When set, only build bundles for these assistant message ids.
     */
    public static function buildPayload(
        Database $splitDb,
        Database $canonDb,
        int $userId,
        int $conversationId,
        ?int $watchMessageId = null,
        ?array $messageIds = null,
    ): array {
        $pack = ChatTurnScores::loadForConversation($splitDb, $canonDb, $conversationId);
        /** @var list<array{id: int, role: string, content: string, meta: array<string, mixed>|null}> $messages */
        $messages = $pack['messages'];
        /** @var list<array<string, mixed>> $scores */
        $scores = $pack['scores'];

        $latestAssistantId = 0;
        for ($i = \count($messages) - 1; $i >= 0; $i -= 1) {
            if (($messages[$i]['role'] ?? '') === 'assistant') {
                $latestAssistantId = (int) ($messages[$i]['id'] ?? 0);
                break;
            }
        }

        /** @var list<int> $pendingWatchIds */
        $pendingWatchIds = [];
        if ($messageIds !== null && $messageIds !== []) {
            foreach ($messageIds as $rawId) {
                $mid = (int) $rawId;
                if ($mid > 0) {
                    $pendingWatchIds[] = $mid;
                }
            }
            $pendingWatchIds = array_values(array_unique($pendingWatchIds));
        } elseif ($watchMessageId !== null && $watchMessageId > 0) {
            $pendingWatchIds = [$watchMessageId];
        }

        $watchId = $pendingWatchIds !== [] ? $pendingWatchIds[\count($pendingWatchIds) - 1] : $latestAssistantId;
        $filterByIds = $pendingWatchIds !== [];

        /** @var array<int, array<string, mixed>|null> $metaByMid */
        $metaByMid = [];
        foreach ($messages as $row) {
            if (($row['role'] ?? '') !== 'assistant') {
                continue;
            }
            $metaByMid[(int) $row['id']] = $row['meta'];
        }

        /** @var array<string, array<string, mixed>> $scoreByMid */
        $scoreByMid = [];
        foreach ($scores as $scoreRow) {
            $mid = (int) ($scoreRow['assistant_message_id'] ?? 0);
            if ($mid > 0) {
                $scoreByMid[(string) $mid] = $scoreRow;
            }
        }

        $workers = InfoWorkerRegister::enabled();
        $productivityWorkers = array_values(array_filter(
            $workers,
            static fn (array $w): bool => isset($w['pill_kind']) && \in_array($w['pill_kind'], ['calendar', 'todo'], true),
        ));

        /** @var array<string, array<string, mixed>> $byMessage */
        $byMessage = [];
        foreach ($messages as $row) {
            if (($row['role'] ?? '') !== 'assistant') {
                continue;
            }
            $mid = (int) ($row['id'] ?? 0);
            if ($mid < 1) {
                continue;
            }
            if ($filterByIds && ! \in_array($mid, $pendingWatchIds, true)) {
                continue;
            }
            $meta = $metaByMid[$mid] ?? null;
            $metaArr = \is_array($meta) ? $meta : [];
            $content = (string) ($row['content'] ?? '');
            $metaArr = ChatProductivityInlineParse::enrichMetaFromContent($metaArr, $content, $conversationId)
                ?? $metaArr;
            $isLatestAssistant = $latestAssistantId > 0 && $mid === $latestAssistantId;

            $stripItems = ChatStripItems::buildItemsFromMeta($userId, $conversationId, $mid, $metaArr);
            if (! $isLatestAssistant && self::productivityWorkersRequireOnlyLast($productivityWorkers)) {
                $stripItems = [];
            }

            $productivity = [];
            foreach ($productivityWorkers as $worker) {
                if (! self::productivityWorkerAppliesToMessage($worker, $isLatestAssistant)) {
                    continue;
                }
                $pillKind = (string) ($worker['pill_kind'] ?? '');
                /** @var list<string> $metaKeys */
                $metaKeys = isset($worker['meta_keys']) && \is_array($worker['meta_keys'])
                    ? $worker['meta_keys']
                    : [];
                $hasResult = self::metaHasAnyKey($metaArr, $metaKeys);
                $stripCount = self::countStripForKind($stripItems, $pillKind);
                $status = 'idle';
                if (! empty($meta['post_turn_productivity_error'])) {
                    $status = 'error';
                } elseif ($hasResult || $stripCount > 0) {
                    $status = 'ready';
                } elseif (
                    $isLatestAssistant
                    && \in_array($mid, $pendingWatchIds, true)
                    && self::productivityStillPending($metaArr)
                ) {
                    $status = 'pending';
                }
                $productivity[$pillKind] = [
                    'status' => $status,
                    'count'  => $stripCount > 0 ? $stripCount : ($hasResult ? 1 : 0),
                ];
            }

            $byMessage[(string) $mid] = [
                'turn_score'   => $scoreByMid[(string) $mid] ?? null,
                // Empty map → JSON `{}` (not `[]`) when no pill workers registered.
                'productivity' => (object) $productivity,
                'strip_items'  => $stripItems,
            ];
        }

        $filteredScores = $scores;
        if ($filterByIds) {
            $idSet = array_flip($pendingWatchIds);
            $filteredScores = array_values(array_filter(
                $scores,
                static fn (array $row): bool => isset($idSet[(int) ($row['assistant_message_id'] ?? 0)]),
            ));
        }

        return [
            'conversation_id'             => $conversationId,
            'latest_assistant_message_id' => $latestAssistantId > 0 ? $latestAssistantId : null,
            'watch_message_id'            => $watchId > 0 ? $watchId : null,
            'requested_message_ids'       => $filterByIds ? $pendingWatchIds : [],
            'workers'                     => $workers,
            'messages'                    => $byMessage,
            'scores'                      => $filteredScores,
            'rescore_pending'             => (int) ($pack['rescore_pending'] ?? 0),
            'scorer_versions'             => TurnScorerVersion::payload(),
        ];
    }

    /**
     * @param array<string, mixed> $meta
     * @param list<string> $keys
     */
    private static function metaHasAnyKey(array $meta, array $keys): bool
    {
        foreach ($keys as $key) {
            if ($key === '') {
                continue;
            }
            if (! \array_key_exists($key, $meta) || $meta[$key] === null) {
                continue;
            }
            if ($key === 'todo_items_suggested' && \is_array($meta[$key]) && \count($meta[$key]) < 2) {
                continue;
            }
            return true;
        }

        return false;
    }

    /**
     * @param list<array<string, mixed>> $stripItems
     */
    private static function countStripForKind(array $stripItems, string $pillKind): int
    {
        $n = 0;
        foreach ($stripItems as $item) {
            $agent = strtolower(trim((string) ($item['agent'] ?? '')));
            $action = strtolower(trim((string) ($item['action_id'] ?? '')));
            if ($pillKind === 'calendar' && ($agent === 'calendar_schedule' || str_contains($action, 'calendar'))) {
                $n += 1;
            }
            if ($pillKind === 'todo' && ($agent === 'todo_extract' || str_contains($action, 'todo'))) {
                $n += 1;
            }
        }

        return $n;
    }

    /**
     * @param list<array<string, mixed>> $workers
     */
    private static function productivityWorkersRequireOnlyLast(array $workers): bool
    {
        foreach ($workers as $worker) {
            if (! isset($worker['only_last']) || ! empty($worker['only_last'])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $worker
     */
    private static function productivityWorkerAppliesToMessage(array $worker, bool $isLatestAssistant): bool
    {
        $onlyLast = ! isset($worker['only_last']) || ! empty($worker['only_last']);

        return ! $onlyLast || $isLatestAssistant;
    }

    /**
     * @param array<string, mixed> $meta
     */
    private static function metaHasInlineProductivityResult(array $meta): bool
    {
        if (! empty($meta['calendar_event_suggested'])) {
            return true;
        }
        if (! empty($meta['todo_item_suggested'])) {
            return true;
        }
        if (isset($meta['todo_items_suggested']) && \is_array($meta['todo_items_suggested']) && \count($meta['todo_items_suggested']) >= 2) {
            return true;
        }

        return false;
    }

    /**
     * @param array<string, mixed> $meta
     */
    private static function productivityStillPending(array $meta): bool
    {
        if (! empty($meta['post_turn_productivity_scanned'])) {
            return false;
        }

        if (! empty($meta['post_turn_productivity_error'])) {
            return false;
        }

        if (self::metaHasInlineProductivityResult($meta)) {
            return false;
        }

        if (! empty($meta['post_turn_productivity_scanning'])) {
            return PostTurnActionRegister::forOrchestrator() !== [];
        }

        // Stream finished but scan marker never landed (legacy run, empty post_turn_actions, or persist gap).
        if (self::assistantRunLooksPostStreamComplete($meta)) {
            return false;
        }

        return PostTurnActionRegister::forOrchestrator() !== [];
    }

    /**
     * Heuristic: orchestrator already persisted {@code system/end} metrics on the assistant row.
     *
     * @param array<string, mixed> $meta
     */
    private static function assistantRunLooksPostStreamComplete(array $meta): bool
    {
        if (isset($meta['duration_ms']) && is_numeric($meta['duration_ms'])) {
            return true;
        }

        $finish = trim((string) ($meta['finish_reason'] ?? ''));
        if ($finish !== '') {
            return true;
        }

        $runStatus = strtolower(trim((string) ($meta['run_status'] ?? '')));
        if ($runStatus !== '' && \in_array($runStatus, ['done', 'closed', 'complete', 'completed'], true)) {
            return true;
        }

        return ! empty($meta['persisted_by_orchestrator']);
    }
}
