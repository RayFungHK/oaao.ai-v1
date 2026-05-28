<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * In-thread CIT/CMT compaction (supersede older turns, insert handoff assistant row).
 */
final class ChatConversationCompact
{
    public const MIN_ACTIVE_TURNS = 7;

    /**
     * @return array{applied: bool, skipped?: bool, message?: string, handoff_message_id?: int|null, superseded_count?: int, tail_count?: int, handoff_source?: string}
     */
    public static function apply(
        \Razy\Database $splitDb,
        int $conversationId,
        int $userId,
        int $workspaceId,
        ?\Razy\Controller $controller = null,
    ): array {
        if ($conversationId < 1) {
            return ['applied' => false, 'message' => 'Invalid conversation'];
        }

        $rawMessages = $splitDb->prepare()
            ->select('id, role, content, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $conversationId])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var list<array{id: int, role: string, content: string, meta_json: string|null}> $indexed */
        $indexed = [];
        /** @var list<array{role: string, content: string}> $recentMessages */
        $recentMessages = [];
        $localeHint = '';

        if (\is_array($rawMessages)) {
            foreach ($rawMessages as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $id = (int) ($row['id'] ?? 0);
                $role = strtolower(trim((string) ($row['role'] ?? '')));
                $metaJson = isset($row['meta_json']) ? (string) $row['meta_json'] : null;
                if ($id < 1 || ChatContextUsage::messagePromptSuperseded($metaJson)) {
                    continue;
                }
                if ($role !== 'user' && $role !== 'assistant') {
                    continue;
                }
                $content = (string) ($row['content'] ?? '');
                $indexed[] = [
                    'id'        => $id,
                    'role'      => $role,
                    'content'   => $content,
                    'meta_json' => $metaJson,
                ];
                $recentMessages[] = ['role' => $role, 'content' => $content];
                if ($role === 'user' && trim($content) !== '') {
                    $localeHint = $content;
                }
            }
        }

        if (\count($recentMessages) < self::MIN_ACTIVE_TURNS) {
            return [
                'applied' => false,
                'skipped' => true,
                'message' => 'Thread is still short — compaction not needed',
            ];
        }

        if (ChatOrchestratorApi::internalBase() === '') {
            return ['applied' => false, 'message' => 'Orchestrator unavailable'];
        }

        $coachEndpoint = null;
        if ($controller !== null) {
            $endpointsApi = $controller->api('endpoints');
            if ($endpointsApi && \method_exists($endpointsApi, 'resolveOrchestratorUiqePayload')) {
                $coachEndpoint = $endpointsApi->resolveOrchestratorUiqePayload();
            }
        }

        $resp = ChatOrchestratorApi::postInternalJson(
            '/v1/conversation/fork_handoff',
            [
                'parent_conversation_id' => $conversationId,
                'recent_messages'        => $recentMessages,
                'seed_prompt'            => '',
                'locale_hint'            => $localeHint,
                'coach_endpoint'         => $coachEndpoint,
            ],
            60,
        );

        if (! \is_array($resp) || ($resp['ok'] ?? false) !== true) {
            return ['applied' => false, 'message' => 'Compaction failed'];
        }

        $compacted = trim((string) ($resp['compacted_content'] ?? ''));
        if ($compacted === '') {
            return ['applied' => false, 'message' => 'Empty compaction result'];
        }

        $tailCount = max(0, min(\count($indexed), (int) ($resp['tail_count'] ?? 0)));
        if ($tailCount < 1) {
            $tailCount = min(4, \count($indexed));
        }

        $keepIds = [];
        if ($tailCount > 0) {
            foreach (\array_slice($indexed, -$tailCount) as $t) {
                $keepIds[(int) $t['id']] = true;
            }
        }

        $now = date('Y-m-d H:i:s');
        $superseded = 0;

        foreach ($indexed as $msg) {
            $mid = (int) $msg['id'];
            if (isset($keepIds[$mid])) {
                continue;
            }
            $meta = [];
            $rawMeta = $msg['meta_json'];
            if ($rawMeta !== null && trim($rawMeta) !== '') {
                try {
                    $decoded = json_decode($rawMeta, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($decoded)) {
                        $meta = $decoded;
                    }
                } catch (\JsonException) {
                    $meta = [];
                }
            }
            $meta['prompt_superseded'] = true;
            $meta['compact_at'] = $now;
            $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

            $splitDb->update('message', ['meta_json'])
                ->where('id=?,conversation_id=?')
                ->assign([
                    'meta_json'       => $metaJson,
                    'id'              => $mid,
                    'conversation_id' => $conversationId,
                ])
                ->query();
            $superseded++;
        }

        $handoffMeta = json_encode([
            'fork_cit_cmt'           => true,
            'in_thread_compact'      => true,
            'parent_conversation_id' => $conversationId,
            'handoff_source'         => (string) ($resp['source'] ?? 'heuristic'),
            'tail_count'             => $tailCount,
            'superseded_count'       => $superseded,
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $splitDb->insert('message', ['conversation_id', 'role', 'content', 'meta_json', 'created_at'])
            ->assign([
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
                'content'         => $compacted,
                'meta_json'       => $handoffMeta,
                'created_at'      => $now,
            ])
            ->query();

        $handoffId = (int) $splitDb->lastID();

        $splitDb->update('conversation', ['updated_at'])
            ->where('id=?')
            ->assign([
                'updated_at' => $now,
                'id'         => $conversationId,
            ])
            ->query();

        return [
            'applied'            => true,
            'handoff_message_id' => $handoffId > 0 ? $handoffId : null,
            'superseded_count'   => $superseded,
            'tail_count'         => $tailCount,
            'handoff_source'     => (string) ($resp['source'] ?? 'heuristic'),
        ];
    }
}
