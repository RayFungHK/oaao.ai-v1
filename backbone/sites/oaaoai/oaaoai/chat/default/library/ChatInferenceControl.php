<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\user\UserModelParams;

/**
 * Per-thread inference control: off (endpoint defaults), manual, or auto_tune (planner delta + optional ACCS feedback).
 *
 * Stored under {@code conversation.params_json.inference_control}.
 */
final class ChatInferenceControl
{
    public const MODE_OFF = 'off';

    public const MODE_MANUAL = 'manual';

    public const MODE_AUTO_TUNE = 'auto_tune';

    /** @var array<string, array{0: float, 1: float}> */
    private const DELTA_CAPS = [
        'temperature'        => [-0.12, 0.12],
        'top_p'              => [-0.08, 0.08],
        'top_k'              => [-24.0, 24.0],
        'presence_penalty'   => [-0.15, 0.15],
        'frequency_penalty'  => [-0.15, 0.15],
        'max_tokens'         => [-512.0, 768.0],
    ];

    /**
     * @param mixed $raw
     */
    public static function normalizeMode($raw): string
    {
        $m = strtolower(trim((string) $raw));

        return \in_array($m, [self::MODE_MANUAL, self::MODE_AUTO_TUNE], true) ? $m : self::MODE_OFF;
    }

    /**
     * @param array<string, mixed>|null $paramsDec
     */
    public static function modeFromConversation(?array $paramsDec): string
    {
        if ($paramsDec === null || $paramsDec === []) {
            return self::MODE_OFF;
        }
        $ic = $paramsDec['inference_control'] ?? null;
        if (\is_array($ic) && isset($ic['mode'])) {
            return self::normalizeMode($ic['mode']);
        }
        $legacy = UserModelParams::fromConversationParams($paramsDec);

        return UserModelParams::activeOverrides($legacy) !== [] ? self::MODE_MANUAL : self::MODE_OFF;
    }

    /**
     * @param array<string, mixed>|null $paramsDec
     *
     * @return array{mode: string, model_params: array<string, int|float|null>, auto_state: array<string, mixed>}
     */
    public static function blockFromConversation(?array $paramsDec): array
    {
        $mode = self::modeFromConversation($paramsDec);
        $manual = [];
        $autoState = ['params' => [], 'history' => []];

        if (\is_array($paramsDec)) {
            $ic = $paramsDec['inference_control'] ?? null;
            if (\is_array($ic)) {
                if (isset($ic['model_params']) && \is_array($ic['model_params'])) {
                    $manual = UserModelParams::normalize($ic['model_params']);
                }
                if (isset($ic['auto_state']) && \is_array($ic['auto_state'])) {
                    $autoState = $ic['auto_state'];
                    if (isset($autoState['params']) && \is_array($autoState['params'])) {
                        $autoState['params'] = UserModelParams::normalize($autoState['params']);
                    } else {
                        $autoState['params'] = [];
                    }
                    if (! isset($autoState['history']) || ! \is_array($autoState['history'])) {
                        $autoState['history'] = [];
                    }
                }
            }
            if ($manual === [] || UserModelParams::activeOverrides($manual) === []) {
                $legacy = UserModelParams::fromConversationParams($paramsDec);
                if (UserModelParams::activeOverrides($legacy) !== []) {
                    $manual = $legacy;
                    if ($mode === self::MODE_OFF) {
                        $mode = self::MODE_MANUAL;
                    }
                }
            }
        }

        return [
            'mode'          => $mode,
            'model_params'  => $manual,
            'auto_state'    => $autoState,
        ];
    }

    /**
     * System (purpose/endpoint) then user preferences — later keys win.
     *
     * @param array<string, int|float|null> $purposeMp
     * @param array<string, int|float|null> $userMp
     *
     * @return array<string, int|float>
     */
    public static function baselineLayers(array $purposeMp, array $userMp): array
    {
        $merged = UserModelParams::mergeLayers([$purposeMp, $userMp]);
        if ($merged !== []) {
            return $merged;
        }

        return ['temperature' => 0.7, 'top_p' => 0.9];
    }

    /**
     * Apply bounded deltas on baseline (micro-tune; never full replace).
     *
     * @param array<string, int|float> $baseline
     * @param array<string, mixed> $delta
     *
     * @return array<string, int|float>
     */
    public static function applyBoundedDelta(array $baseline, array $delta): array
    {
        $out = $baseline;
        foreach (self::DELTA_CAPS as $key => [$dLo, $dHi]) {
            if (! \array_key_exists($key, $delta)) {
                continue;
            }
            $step = (float) $delta[$key];
            $step = max($dLo, min($dHi, $step));
            $cur = isset($out[$key]) ? (float) $out[$key] : 0.0;
            $norm = UserModelParams::normalize([$key => $cur + $step]);
            if (isset($norm[$key]) && $norm[$key] !== null) {
                $out[$key] = $norm[$key];
            }
        }

        return UserModelParams::activeOverrides(UserModelParams::normalize($out));
    }

    /**
     * @param array<string, mixed>|null $paramsDec
     * @param array<string, int|float|null> $purposeMp
     * @param array<string, int|float|null> $userMp
     *
     * @return array{mode: string, params: array<string, int|float>, snapshot: array<string, mixed>}
     */
    public static function resolveForSend(?array $paramsDec, array $purposeMp = [], array $userMp = []): array
    {
        $block = self::blockFromConversation($paramsDec);
        $mode = $block['mode'];
        $baseline = self::baselineLayers($purposeMp, $userMp);

        if ($mode === self::MODE_OFF) {
            return [
                'mode'       => self::MODE_OFF,
                'params'     => [],
                'snapshot'   => [
                    'mode'             => self::MODE_OFF,
                    'params_applied' => [],
                    'source'           => 'endpoint_defaults',
                ],
            ];
        }

        if ($mode === self::MODE_MANUAL) {
            $active = UserModelParams::mergeLayers([$purposeMp, $userMp, $block['model_params']]);

            return [
                'mode'     => self::MODE_MANUAL,
                'params'   => $active,
                'snapshot' => [
                    'mode'             => self::MODE_MANUAL,
                    'params_applied' => $active,
                    'baseline'         => $baseline,
                    'source'           => 'manual_thread',
                ],
            ];
        }

        return [
            'mode'     => self::MODE_AUTO_TUNE,
            'params'   => $baseline,
            'snapshot' => [
                'mode'             => self::MODE_AUTO_TUNE,
                'params_applied' => $baseline,
                'baseline'         => $baseline,
                'source'           => 'auto_tune_baseline',
                'auto_state'       => $block['auto_state'],
            ],
        ];
    }

    /**
     * Persist orchestrator-applied params for auto_tune (per turn).
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $applied
     * @param array<string, mixed> $snapshot
     *
     * @return array<string, mixed>
     */
    public static function recordAutoTuneTurn(array $params, array $applied, array $snapshot): array
    {
        $block = self::blockFromConversation($params);
        $autoState = $block['auto_state'];
        $norm = UserModelParams::normalize($applied);
        $active = UserModelParams::activeOverrides($norm);
        /** @var list<array<string, mixed>> $history */
        $history = \is_array($autoState['history'] ?? null) ? $autoState['history'] : [];
        $history[] = [
            'at'       => microtime(true),
            'source'   => (string) ($snapshot['source'] ?? 'auto_tune_planner_delta'),
            'delta'    => \is_array($snapshot['delta'] ?? null) ? $snapshot['delta'] : [],
            'baseline' => \is_array($snapshot['baseline'] ?? null) ? $snapshot['baseline'] : [],
            'params'   => $active,
        ];
        if (\count($history) > 24) {
            $history = \array_slice($history, -24);
        }
        $autoState['params'] = $norm;
        $autoState['history'] = $history;
        $autoState['last_applied'] = $active;

        return self::mergeIntoParams($params, [
            'mode'       => self::MODE_AUTO_TUNE,
            'auto_state' => $autoState,
        ]);
    }

    /**
     * Merge inference_control into conversation params_json.
     *
     * @param array<string, mixed> $params
     * @param array<string, mixed> $patch mode?, model_params?, auto_state?
     *
     * @return array<string, mixed>
     */
    public static function mergeIntoParams(array $params, array $patch): array
    {
        $ic = \is_array($params['inference_control'] ?? null) ? $params['inference_control'] : [];

        if (isset($patch['mode'])) {
            $ic['mode'] = self::normalizeMode($patch['mode']);
        }
        if (\array_key_exists('model_params', $patch)) {
            $mp = $patch['model_params'];
            if ($mp === null) {
                unset($ic['model_params']);
            } elseif (\is_array($mp)) {
                $norm = UserModelParams::normalize($mp);
                if (UserModelParams::activeOverrides($norm) === []) {
                    unset($ic['model_params']);
                } else {
                    $ic['model_params'] = $norm;
                }
            }
        }
        if (isset($patch['auto_state']) && \is_array($patch['auto_state'])) {
            $ic['auto_state'] = $patch['auto_state'];
        }

        if ($ic === []) {
            unset($params['inference_control']);
        } else {
            $params['inference_control'] = $ic;
        }

        if (isset($ic['mode']) && $ic['mode'] !== self::MODE_MANUAL) {
            unset($params['model_params']);
        }

        return $params;
    }

    /**
     * Seed auto_state when enabling auto_tune (baseline = purpose + user).
     *
     * @param array<string, int|float> $purposeMp
     * @param array<string, int|float|null> $userMp
     *
     * @return array<string, mixed>
     */
    public static function initialAutoState(array $purposeMp = [], array $userMp = []): array
    {
        $base = self::baselineLayers($purposeMp, $userMp);

        return [
            'params'  => UserModelParams::normalize($base),
            'history' => [],
        ];
    }
}
