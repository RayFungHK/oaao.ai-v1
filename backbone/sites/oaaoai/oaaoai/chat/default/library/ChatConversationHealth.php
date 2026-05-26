<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Thread-level IQS/ACCS health — mirrors {@see python/oaao_orchestrator/evaluation/conversation_health.py} (P1-1 / P1-9).
 */
final class ChatConversationHealth
{
    private const LOW_ACCS = 0.65;

    private const LOW_ALIGNMENT = 0.55;

    private const ACCS_DROP_ALERT = 0.15;

    private const STREAK_LOW_ACCS = 2;

    /**
     * @param list<array<string, mixed>> $scoreRows turn_score rows keyed by turn order
     * @param array<int, string>         $userByTurn 1-based turn_index => preceding user message
     *
     * @return array<string, mixed>
     */
    public static function analyze(int $conversationId, array $scoreRows, array $userByTurn = [], int $window = 5): array
    {
        $points = [];
        foreach ($scoreRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $ti = (int) ($row['turn_index'] ?? 0);
            if ($ti < 1) {
                continue;
            }
            $accsDimsRaw = $row['accs_dims_json'] ?? $row['accs_dims'] ?? '{}';
            $accsDims = \is_array($accsDimsRaw)
                ? $accsDimsRaw
                : (json_decode(\is_string($accsDimsRaw) ? $accsDimsRaw : '{}', true) ?: []);
            $accsDims = \is_array($accsDims) ? $accsDims : [];
            $alignment = (float) ($accsDims['alignment'] ?? 0.0);
            $accs = (float) ($row['accs'] ?? 0.0);
            $iqs = (float) ($row['iqs'] ?? 0.0);
            if ($accs <= 0 && $iqs <= 0) {
                continue;
            }
            $userMsg = (string) ($userByTurn[$ti] ?? '');
            $points[] = [
                'turn_index' => $ti,
                'iqs'        => $iqs,
                'accs'       => $accs,
                'topic_shift'=> (int) ($row['topic_shift'] ?? 0),
                'alignment'  => $alignment,
                'user_message' => $userMsg,
            ];
        }

        if ($points === []) {
            return [
                'conversation_id'       => $conversationId,
                'turn_count'              => 0,
                'trend'                   => 'stable',
                'accs_rolling_p50'        => 0.0,
                'iqs_rolling_p50'         => 0.0,
                'accs_delta_last'         => null,
                'consecutive_low_accs'    => 0,
                'topic_shift_count'       => 0,
                'user_correction_turns'   => 0,
                'alert'                   => 'none',
                'alerts'                  => [],
            ];
        }

        $accsVals = array_values(array_filter(array_map(static fn (array $p): float => (float) $p['accs'], $points), static fn (float $v): bool => $v > 0));
        $iqsVals = array_values(array_filter(array_map(static fn (array $p): float => (float) $p['iqs'], $points), static fn (float $v): bool => $v > 0));
        $tail = \array_slice($points, -$window);
        $tailAccs = array_values(array_filter(array_map(static fn (array $p): float => (float) $p['accs'], $tail), static fn (float $v): bool => $v > 0));
        $tailIqs = array_values(array_filter(array_map(static fn (array $p): float => (float) $p['iqs'], $tail), static fn (float $v): bool => $v > 0));

        $accsRolling = self::median($tailAccs !== [] ? $tailAccs : $accsVals);
        $iqsRolling = self::median($tailIqs !== [] ? $tailIqs : $iqsVals);
        $topicShiftCount = 0;
        $userCorrectionTurns = 0;
        foreach ($points as $p) {
            if ((int) ($p['topic_shift'] ?? 0) === 1) {
                $topicShiftCount += 1;
            }
            if (self::isUserCorrection((string) ($p['user_message'] ?? ''))) {
                $userCorrectionTurns += 1;
            }
        }

        $streak = 0;
        for ($i = \count($points) - 1; $i >= 0; $i--) {
            $a = (float) ($points[$i]['accs'] ?? 0);
            if ($a > 0 && $a < self::LOW_ACCS) {
                $streak += 1;
            } else {
                break;
            }
        }

        $accsDelta = null;
        $trend = 'stable';
        if (\count($points) >= 2) {
            $last = (float) ($points[\count($points) - 1]['accs'] ?? 0);
            $prev = (float) ($points[\count($points) - 2]['accs'] ?? 0);
            if ($last > 0 && $prev > 0) {
                $accsDelta = $last - $prev;
                if ($accsDelta >= 0.05) {
                    $trend = 'improving';
                } elseif ($accsDelta <= -0.05) {
                    $trend = 'declining';
                }
            }
        }

        $alerts = [];
        if ($streak >= self::STREAK_LOW_ACCS) {
            $alerts[] = 'quality_drop';
        }
        $lastAccs = (float) ($points[\count($points) - 1]['accs'] ?? 0.0);
        if (
            $accsDelta !== null
            && $accsDelta <= -self::ACCS_DROP_ALERT
            && $accsRolling < self::LOW_ACCS
            && $lastAccs > 0
            && $lastAccs < self::LOW_ACCS
        ) {
            $alerts[] = 'alignment_declining';
        }
        if ($topicShiftCount >= 3) {
            $alerts[] = 'drift';
        }
        if ($userCorrectionTurns >= 2 && $accsRolling < self::LOW_ACCS) {
            $alerts[] = 'misunderstanding_loop';
        }

        return [
            'conversation_id'       => $conversationId,
            'turn_count'            => \count($points),
            'trend'                 => $trend,
            'accs_rolling_p50'      => round($accsRolling, 4),
            'iqs_rolling_p50'       => round($iqsRolling, 4),
            'accs_delta_last'       => $accsDelta !== null ? round($accsDelta, 4) : null,
            'consecutive_low_accs'  => $streak,
            'topic_shift_count'     => $topicShiftCount,
            'user_correction_turns' => $userCorrectionTurns,
            'alert'                 => $alerts[0] ?? 'none',
            'alerts'                => $alerts,
        ];
    }

    public static function isUserCorrection(string $text): bool
    {
        $raw = trim($text);
        if ($raw === '') {
            return false;
        }

        return (bool) preg_match(
            '/(补完|不对|不是这个|不是這個|重答|离题|離題|听不懂|聽不懂|理解错|理解錯|搞错|搞錯|please complete|not what i)/iu',
            $raw,
        );
    }

    /**
     * Heuristic topic_shift for ACCS upsert when orchestrator omits explicit flag (P1-2).
     *
     * @param array<string, mixed> $accsDims
     */
    public static function topicShiftFlag(string $userMessage, array $accsDims, float $accsScore): int
    {
        $alignment = (float) ($accsDims['alignment'] ?? 0.0);
        if ($alignment > 0 && $alignment < self::LOW_ALIGNMENT) {
            return 1;
        }
        if ($accsScore > 0 && $accsScore < self::LOW_ACCS && self::isUserCorrection($userMessage)) {
            return 1;
        }
        if (self::isUserCorrection($userMessage) && $alignment > 0 && $alignment < self::LOW_ACCS) {
            return 1;
        }

        return 0;
    }

    /**
     * @param list<float> $values
     */
    private static function median(array $values): float
    {
        if ($values === []) {
            return 0.0;
        }
        sort($values);
        $mid = (int) floor((\count($values) - 1) / 2);
        if (\count($values) % 2 === 1) {
            return (float) $values[$mid];
        }

        return ((float) $values[$mid] + (float) $values[$mid + 1]) / 2.0;
    }
}
