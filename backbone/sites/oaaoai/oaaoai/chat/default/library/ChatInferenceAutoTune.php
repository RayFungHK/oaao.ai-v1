<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\user\UserModelParams;

/**
 * Optional ACCS feedback nudges for auto_tune (secondary to planner per-turn deltas).
 */
final class ChatInferenceAutoTune
{
    private const TARGET_ACCS = 0.78;

    private const MAX_HISTORY = 24;

    public static function accsFeedbackEnabled(): bool
    {
        $v = getenv('OAAO_INFERENCE_ACCS_FEEDBACK');
        if ($v === false) {
            return false;
        }

        return \in_array(strtolower(trim((string) $v)), ['1', 'true', 'yes', 'on'], true);
    }

    /**
     * @param array<string, mixed> $params conversation params_json
     * @param float $accs latest ACCS 0–1
     * @param int $turnIndex
     *
     * @return array{adjusted: bool, params: array<string, mixed>}
     */
    public static function adjustAfterAccs(array $params, float $accs, int $turnIndex): array
    {
        if (! self::accsFeedbackEnabled()) {
            return ['adjusted' => false, 'params' => $params];
        }

        $block = ChatInferenceControl::blockFromConversation($params);
        if ($block['mode'] !== ChatInferenceControl::MODE_AUTO_TUNE) {
            return ['adjusted' => false, 'params' => $params];
        }

        $autoState = $block['auto_state'];
        $cur = UserModelParams::activeOverrides(
            \is_array($autoState['params'] ?? null) ? $autoState['params'] : [],
        );
        if ($cur === []) {
            $cur = UserModelParams::activeOverrides(
                \is_array($autoState['last_applied'] ?? null) ? $autoState['last_applied'] : [],
            );
        }
        if ($cur === []) {
            return ['adjusted' => false, 'params' => $params];
        }

        /** @var array<string, float> $delta */
        $delta = [];
        $reason = 'hold';
        if ($accs < self::TARGET_ACCS - 0.08) {
            $reason = 'accs_low';
            $delta['temperature'] = -0.04;
            $delta['presence_penalty'] = 0.05;
        } elseif ($accs > self::TARGET_ACCS + 0.12) {
            $reason = 'accs_high';
            $delta['temperature'] = 0.03;
        }

        if ($delta === []) {
            return ['adjusted' => false, 'params' => $params];
        }

        $nextParams = ChatInferenceControl::applyBoundedDelta($cur, $delta);

        /** @var list<array<string, mixed>> $history */
        $history = \is_array($autoState['history'] ?? null) ? $autoState['history'] : [];
        $history[] = [
            'turn_index' => $turnIndex,
            'accs'       => round($accs, 4),
            'reason'     => $reason,
            'delta'      => $delta,
            'params'     => $nextParams,
            'at'         => microtime(true),
            'source'     => 'accs_feedback',
        ];
        if (\count($history) > self::MAX_HISTORY) {
            $history = \array_slice($history, -\self::MAX_HISTORY);
        }

        $autoState['params'] = UserModelParams::normalize($nextParams);
        $autoState['history'] = $history;
        $autoState['last_turn_index'] = $turnIndex;
        $autoState['last_accs'] = round($accs, 4);
        $autoState['last_applied'] = $nextParams;

        $params = ChatInferenceControl::mergeIntoParams($params, [
            'mode'       => ChatInferenceControl::MODE_AUTO_TUNE,
            'auto_state' => $autoState,
        ]);

        return ['adjusted' => true, 'params' => $params];
    }
}
