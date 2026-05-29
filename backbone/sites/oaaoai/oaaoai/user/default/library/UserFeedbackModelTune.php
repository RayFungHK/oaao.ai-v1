<?php

declare(strict_types=1);

namespace oaaoai\user;

/**
 * UX-1-S10 — bounded {@code model_params} nudge when user thumbs-down an assistant message.
 */
final class UserFeedbackModelTune
{
    public const AUDIT_KEY = 'message_feedback_audit';

    private const MAX_AUDIT_ENTRIES = 40;

    /**
     * Micro-adjustment applied on each new downvote (not when clearing vote).
     *
     * @return array<string, float>
     */
    public static function downvoteDelta(): array
    {
        return [
            'temperature'       => -0.06,
            'top_p'             => -0.04,
            'presence_penalty'  => 0.08,
            'frequency_penalty' => 0.05,
        ];
    }

    /**
     * @param array<string, int|float|null> $params
     *
     * @return array<string, int|float|null>
     */
    public static function applyDownvote(array $params): array
    {
        $base = UserModelParams::normalize($params);
        $delta = self::downvoteDelta();
        $patch = [];

        if ($base['temperature'] !== null) {
            $patch['temperature'] = max(0.0, min(2.0, (float) $base['temperature'] + $delta['temperature']));
        } else {
            $patch['temperature'] = 0.58;
        }

        if ($base['top_p'] !== null) {
            $patch['top_p'] = max(0.05, min(1.0, (float) $base['top_p'] + $delta['top_p']));
        } else {
            $patch['top_p'] = 0.86;
        }

        if ($base['presence_penalty'] !== null) {
            $patch['presence_penalty'] = max(-2.0, min(2.0, (float) $base['presence_penalty'] + $delta['presence_penalty']));
        } else {
            $patch['presence_penalty'] = $delta['presence_penalty'];
        }

        if ($base['frequency_penalty'] !== null) {
            $patch['frequency_penalty'] = max(-2.0, min(2.0, (float) $base['frequency_penalty'] + $delta['frequency_penalty']));
        } else {
            $patch['frequency_penalty'] = $delta['frequency_penalty'];
        }

        return UserModelParams::normalize(array_merge($base, $patch));
    }

    /**
     * @param array<string, mixed> $prefs
     *
     * @return array{preferences: array<string, mixed>, applied: array<string, int|float|null>}
     */
    public static function recordDownvote(
        array $prefs,
        int $messageId,
        int $conversationId,
        array $paramsBefore,
    ): array {
        $after = self::applyDownvote($paramsBefore);
        $prefs = UserModelParams::mergeIntoPreferences($prefs, $after);

        $audit = \is_array($prefs[self::AUDIT_KEY] ?? null) ? $prefs[self::AUDIT_KEY] : [];
        $entry = [
            'at'              => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format(\DateTimeInterface::ATOM),
            'vote'            => 'down',
            'message_id'      => $messageId,
            'conversation_id' => $conversationId,
            'delta'           => self::downvoteDelta(),
            'model_params'    => UserModelParams::activeOverrides($after),
        ];
        array_unshift($audit, $entry);
        $prefs[self::AUDIT_KEY] = \array_slice($audit, 0, self::MAX_AUDIT_ENTRIES);

        return [
            'preferences' => $prefs,
            'applied'     => $after,
        ];
    }
}
