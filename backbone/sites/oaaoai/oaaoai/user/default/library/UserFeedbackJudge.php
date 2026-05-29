<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * UX-1-S11 — persist feedback judge suggestions from orchestrator (v1, no auto-apply).
 */
final class UserFeedbackJudge
{
    public const AUDIT_KEY = 'feedback_judge_audit';

    private const MAX_AUDIT = 20;

    /**
     * @param array<string, mixed> $prefs
     * @param array<string, mixed> $judgeResponse
     *
     * @return array<string, mixed>
     */
    public static function mergeJudgeResult(
        array $prefs,
        int $messageId,
        int $conversationId,
        array $judgeResponse,
    ): array {
        $audit = \is_array($prefs[self::AUDIT_KEY] ?? null) ? $prefs[self::AUDIT_KEY] : [];
        $entry = [
            'at'              => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format(\DateTimeInterface::ATOM),
            'message_id'      => $messageId,
            'conversation_id' => $conversationId,
            'summary'         => (string) ($judgeResponse['summary'] ?? ''),
            'suggestions'     => $judgeResponse['suggestions'] ?? [],
            'source'          => (string) ($judgeResponse['source'] ?? ''),
            'auto_apply'      => (bool) ($judgeResponse['auto_apply'] ?? false),
        ];
        array_unshift($audit, $entry);
        $prefs[self::AUDIT_KEY] = \array_slice($audit, 0, self::MAX_AUDIT);

        return $prefs;
    }
}
