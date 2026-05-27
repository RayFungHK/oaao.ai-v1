<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Mirror of Python {@see oaao_orchestrator.evaluation.scorer_version} — keep in sync when bumping.
 */
final class TurnScorerVersion
{
    public const IQS = 'iqs_v2';

    public const ACCS = 'accs_v2';

    /** @var list<string> */
    private const LEGACY = ['', 'post_stream_v1'];

    /** @var list<string> */
    private const IQS_DIMS = ['clarity', 'specificity', 'actionability', 'context_completeness'];

    /** @var list<string> */
    private const ACCS_DIMS = [
        'alignment',
        'accuracy',
        'hallucination_penalty',
        'citation_fidelity',
        'source_analysis',
    ];

    public static function combined(): string
    {
        return self::IQS . '+' . self::ACCS;
    }

    /**
     * @return array{iqs: string, accs: string, combined: string}
     */
    public static function payload(): array
    {
        return [
            'iqs'      => self::IQS,
            'accs'     => self::ACCS,
            'combined' => self::combined(),
        ];
    }

    /**
     * @return array{0: string, 1: string}
     */
    public static function parseStored(string $raw): array
    {
        $s = trim($raw);
        if (\in_array($s, self::LEGACY, true)) {
            return ['', ''];
        }
        if (str_contains($s, '+')) {
            [$iqs, $accs] = explode('+', $s, 2);

            return [trim($iqs), trim($accs)];
        }
        if ($s === self::IQS) {
            return [self::IQS, ''];
        }
        if ($s === self::ACCS) {
            return ['', self::ACCS];
        }

        return ['', ''];
    }

    public static function merge(string $existing, string $plugin, string $incoming = ''): string
    {
        [$iqsV, $accsV] = self::parseStored($existing);
        $incoming = trim($incoming);
        if ($plugin === 'iqs') {
            $iqsV = $incoming !== '' ? $incoming : self::IQS;
        } else {
            $accsV = $incoming !== '' ? $incoming : self::ACCS;
        }
        if ($iqsV !== '' && $accsV !== '') {
            return $iqsV . '+' . $accsV;
        }

        return $iqsV !== '' ? $iqsV : $accsV;
    }

    /**
     * @param array<string, mixed> $iqsDims
     */
    public static function needsIqsRescore(string $storedVersion, float $iqs, array $iqsDims): bool
    {
        if ($iqs <= 0.0) {
            return true;
        }
        $sv = trim($storedVersion);
        if (\in_array($sv, self::LEGACY, true)) {
            return true;
        }
        [$iqsV] = self::parseStored($sv);
        if ($iqsV !== self::IQS) {
            return true;
        }

        return ! self::dimsMatch(self::IQS_DIMS, $iqsDims);
    }

    /**
     * @param array<string, mixed> $accsDims
     */
    public static function needsAccsRescore(
        string $storedVersion,
        float $accs,
        array $accsDims,
        string $iqsAction = '',
    ): bool {
        $action = strtolower(trim($iqsAction));
        if ($action === 'clarify' || $action === 'hard_clarify') {
            return false;
        }
        if ($accs <= 0.0) {
            return true;
        }
        $sv = trim($storedVersion);
        if (\in_array($sv, self::LEGACY, true)) {
            return true;
        }
        [, $accsV] = self::parseStored($sv);
        if ($accsV !== self::ACCS) {
            return true;
        }

        return ! self::dimsMatch(self::ACCS_DIMS, $accsDims);
    }

    /**
     * Slim + sanitize one rescore turn before POST to orchestrator (size + JSON edge cases).
     *
     * @param array<string, mixed> $turn
     *
     * @return array<string, mixed>
     */
    public static function prepareRescoreTurnPayload(array $turn): array
    {
        $history = $turn['conversation_history'] ?? [];
        if (! \is_array($history)) {
            $history = [];
        }
        if (\count($history) > 40) {
            $history = \array_slice($history, -40);
        }
        $historyOut = [];
        foreach ($history as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $role = strtolower(trim((string) ($row['role'] ?? '')));
            if (! \in_array($role, ['user', 'assistant', 'system'], true)) {
                continue;
            }
            $historyOut[] = [
                'role'    => $role,
                'content' => self::truncateRescoreText((string) ($row['content'] ?? ''), 8000),
            ];
        }

        $pipelineSnap = null;
        $rawSnap = $turn['pipeline_snap'] ?? null;
        if (\is_array($rawSnap) && isset($rawSnap['vault_rag']) && \is_array($rawSnap['vault_rag'])) {
            $passages = $rawSnap['vault_rag']['passages'] ?? [];
            $trimmed = [];
            if (\is_array($passages)) {
                foreach (\array_slice($passages, 0, 20) as $passage) {
                    if (\is_string($passage)) {
                        $trimmed[] = self::truncateRescoreText($passage, 2000);
                    } elseif (\is_array($passage)) {
                        $text = (string) ($passage['text'] ?? $passage['content'] ?? '');
                        if ($text !== '') {
                            $trimmed[] = self::truncateRescoreText($text, 2000);
                        }
                    }
                }
            }
            if ($trimmed !== []) {
                $pipelineSnap = ['vault_rag' => ['passages' => $trimmed]];
            }
        }

        return [
            'assistant_message_id' => (int) ($turn['assistant_message_id'] ?? 0),
            'turn_index'           => (int) ($turn['turn_index'] ?? 0),
            'user_message'         => self::truncateRescoreText((string) ($turn['user_message'] ?? ''), 8000),
            'assistant_content'    => self::truncateRescoreText((string) ($turn['assistant_content'] ?? ''), 50000),
            'conversation_history' => $historyOut,
            'pipeline_snap'        => $pipelineSnap,
            'stored_version'       => (string) ($turn['stored_version'] ?? ''),
            'iqs'                  => (float) ($turn['iqs'] ?? 0),
            'accs'                 => (float) ($turn['accs'] ?? 0),
            'iqs_dims'             => self::jsonObjectMap(
                self::normalizeScoreDims(\is_array($turn['iqs_dims'] ?? null) ? $turn['iqs_dims'] : []),
            ),
            'accs_dims'            => self::jsonObjectMap(
                self::normalizeScoreDims(\is_array($turn['accs_dims'] ?? null) ? $turn['accs_dims'] : []),
            ),
            'iqs_action'           => (string) ($turn['iqs_action'] ?? ''),
            'needs_iqs'            => (bool) ($turn['needs_iqs'] ?? true),
            'needs_accs'           => (bool) ($turn['needs_accs'] ?? true),
        ];
    }

    /**
     * Empty PHP arrays JSON-encode as {@code []}; orchestrator expects {@code {}} for dim maps.
     *
     * @param array<string, float> $dims
     *
     * @return array<string, float>|\stdClass
     */
    public static function jsonObjectMap(array $dims): array|\stdClass
    {
        return $dims === [] ? new \stdClass() : $dims;
    }

    private static function truncateRescoreText(string $text, int $maxBytes): string
    {
        if ($maxBytes < 1 || $text === '') {
            return '';
        }
        if (\strlen($text) <= $maxBytes) {
            return $text;
        }

        return substr($text, 0, $maxBytes);
    }

    /**
     * Numeric dimension map for orchestrator rescore payloads (drops null / non-numeric).
     *
     * @param array<string, mixed> $dims
     *
     * @return array<string, float>
     */
    public static function normalizeScoreDims(array $dims): array
    {
        $out = [];
        foreach ($dims as $key => $val) {
            if (\is_int($val) || \is_float($val)) {
                $out[(string) $key] = (float) $val;
            } elseif (\is_string($val) && is_numeric($val)) {
                $out[(string) $key] = (float) $val;
            }
        }

        return $out;
    }

    /**
     * @param list<string> $expected
     * @param array<string, mixed> $dims
     */
    private static function dimsMatch(array $expected, array $dims): bool
    {
        $keys = array_map('strval', array_keys($dims));
        sort($keys);
        $exp = $expected;
        sort($exp);

        return $keys === $exp;
    }
}
