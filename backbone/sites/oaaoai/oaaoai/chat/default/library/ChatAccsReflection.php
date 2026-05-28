<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Deferred ACCS reflection — load coach critique for the next send and mark consumed.
 */
final class ChatAccsReflection
{
    /**
     * @return array<string, mixed>|null Payload for orchestrator {@code accs_reflection_context}.
     */
    public static function consumePendingForSend(
        \Razy\Database $canonDb,
        \Razy\Database $splitDb,
        int $conversationId,
        int $excludeAssistantMessageId = 0,
    ): ?array {
        if ($conversationId < 1) {
            return null;
        }

        $rows = $splitDb->prepare()
            ->select('id')
            ->from('message')
            ->where('conversation_id=?,role=?')
            ->assign([
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
            ])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        if (! \is_array($rows) || \count($rows) < 1) {
            return null;
        }

        $assistantIds = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $mid = (int) ($row['id'] ?? 0);
            if ($mid < 1 || ($excludeAssistantMessageId > 0 && $mid >= $excludeAssistantMessageId)) {
                continue;
            }
            $assistantIds[] = $mid;
        }
        if ($assistantIds === []) {
            return null;
        }

        $prevAssistantId = (int) $assistantIds[\count($assistantIds) - 1];
        if ($prevAssistantId < 1) {
            return null;
        }

        $turnIndex = self::turnIndexForAssistant($splitDb, $conversationId, $prevAssistantId);
        if ($turnIndex < 1) {
            return null;
        }

        $stored = $canonDb->prepare()
            ->select('accs, accs_reasons_json')
            ->from('turn_score')
            ->where('conversation_id=?,turn_index=?')
            ->assign([
                'conversation_id' => $conversationId,
                'turn_index'        => $turnIndex,
            ])
            ->limit(1)
            ->query()
            ->fetch();

        if (! \is_array($stored)) {
            return null;
        }

        $reasonsRaw = $stored['accs_reasons_json'] ?? null;
        $reasons = [];
        if (\is_string($reasonsRaw) && $reasonsRaw !== '') {
            $decoded = json_decode($reasonsRaw, true);
            $reasons = \is_array($decoded) ? $decoded : [];
        }
        if (
            empty($reasons['reflection_pending_next_turn'])
            || ! empty($reasons['reflection_consumed'])
            || empty($reasons['reflection_critique'])
        ) {
            return null;
        }

        $reasons['reflection_consumed'] = true;
        $reasons['reflection_pending_next_turn'] = false;
        $reasons['reflection_injected_at'] = microtime(true);

        try {
            $canonDb->update('turn_score', ['accs_reasons_json'])
                ->where('conversation_id=?,turn_index=?')
                ->assign([
                    'accs_reasons_json' => json_encode($reasons, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'conversation_id' => $conversationId,
                    'turn_index'        => $turnIndex,
                ])
                ->query();
        } catch (\Throwable) {
            return null;
        }

        return [
            'assistant_message_id'      => $prevAssistantId,
            'turn_index'                => $turnIndex,
            'reflection_critique'       => (string) $reasons['reflection_critique'],
            'reflection_initial_score'  => isset($reasons['reflection_initial_score'])
                ? (float) $reasons['reflection_initial_score']
                : (float) ($stored['accs'] ?? 0),
            'reflection_factors'        => isset($reasons['reflection_factors']) && \is_array($reasons['reflection_factors'])
                ? $reasons['reflection_factors']
                : [],
            'reflection_deferred'       => true,
            'reflection_consumed'       => false,
        ];
    }

    private static function turnIndexForAssistant(
        \Razy\Database $splitDb,
        int $conversationId,
        int $assistantMessageId,
    ): int {
        $row = $splitDb->prepare()
            ->select('COUNT(*) AS turn_index')
            ->from('message')
            ->where('conversation_id=?,role=?,id<=?')
            ->assign([
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
                'id'              => $assistantMessageId,
            ])
            ->query()
            ->fetch();

        return \is_array($row) ? (int) ($row['turn_index'] ?? 0) : 0;
    }
}
