<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * ASR purpose {@code meta_json} → orchestrator job payload fields (chunk overlap / context padding).
 */
final class AsrPurposeConfig
{
    /**
     * @return array<string, mixed>
     */
    public static function decodePurposeMeta(mixed $metaJson): array
    {
        if (\is_array($metaJson)) {
            return $metaJson;
        }
        if (! \is_string($metaJson) || trim($metaJson) === '') {
            return [];
        }
        try {
            $dec = json_decode(trim($metaJson), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return \is_array($dec) ? $dec : [];
    }

    /**
     * Symmetric pad (seconds) applied before/after each ASR chunk core window for context continuity.
     *
     * Purpose {@code meta_json} keys (first match wins for symmetric):
     * - {@code chunk_buffer_sec} / {@code asr_chunk_buffer_sec}
     * - or {@code chunk_buffer_before_sec} + {@code chunk_buffer_after_sec}
     */
    public static function chunkBufferSecFromMeta(?array $meta): ?float
    {
        if ($meta === null || $meta === []) {
            return null;
        }
        foreach (['chunk_buffer_sec', 'asr_chunk_buffer_sec', 'chunk_pad_sec'] as $key) {
            if (! \array_key_exists($key, $meta)) {
                continue;
            }
            $v = self::clampSeconds($meta[$key]);
            if ($v !== null) {
                return $v;
            }
        }

        return null;
    }

    /**
     * @return array{before: float|null, after: float|null}
     */
    public static function chunkBufferSidesFromMeta(?array $meta): array
    {
        if ($meta === null || $meta === []) {
            return ['before' => null, 'after' => null];
        }
        $sym = self::chunkBufferSecFromMeta($meta);
        if ($sym !== null) {
            return ['before' => $sym, 'after' => $sym];
        }

        $before = null;
        foreach (['chunk_buffer_before_sec', 'chunk_pad_before_sec', 'asr_chunk_buffer_before_sec'] as $key) {
            if (\array_key_exists($key, $meta)) {
                $before = self::clampSeconds($meta[$key]);
                break;
            }
        }
        $after = null;
        foreach (['chunk_buffer_after_sec', 'chunk_pad_after_sec', 'asr_chunk_buffer_after_sec'] as $key) {
            if (\array_key_exists($key, $meta)) {
                $after = self::clampSeconds($meta[$key]);
                break;
            }
        }

        return ['before' => $before, 'after' => $after];
    }

    /**
     * Build orchestrator {@code asr} object from {@see CanonicalEndpointsRepository::resolveAsrBinding()}.
     *
     * @param array<string, mixed> $asrBind
     * @param callable(string): (string|null) $inferApiKeyEnv
     *
     * @return array<string, mixed>
     */
    public static function jobPayloadFromBinding(array $asrBind, callable $inferApiKeyEnv): array
    {
        $aref = trim((string) ($asrBind['api_key_ref'] ?? ''));
        $payload = [
            'purpose_key' => (string) ($asrBind['purpose_key'] ?? ''),
            'base_url'    => (string) ($asrBind['base_url'] ?? ''),
            'model'       => (string) ($asrBind['model'] ?? ''),
            'api_key_env' => ($aref !== '' ? $inferApiKeyEnv($aref) : null),
        ];

        /** @var array<string, mixed> $meta */
        $meta = \is_array($asrBind['purpose_meta'] ?? null) ? $asrBind['purpose_meta'] : [];
        $provider = self::providerFromMeta($meta);
        $payload['provider'] = $provider;

        if (self::diarizationEnabledFromMeta($meta)) {
            $payload['diarization_enabled'] = true;
        }

        $funasrBase = trim((string) ($meta['funasr_base_url'] ?? ''));
        if ($funasrBase === '' && $provider === 'funasr') {
            $funasrBase = self::defaultFunasrBaseUrl();
        }
        if ($funasrBase !== '') {
            $payload['funasr_base_url'] = $funasrBase;
        }

        $speakerCount = self::speakerCountFromMeta($meta);
        if ($speakerCount !== null) {
            $payload['speaker_count'] = $speakerCount;
        }

        $langHints = self::languageHintsFromMeta($meta);
        if ($langHints !== []) {
            $payload['language_hints'] = $langHints;
        }

        if (\array_key_exists('enable_itn', $meta)) {
            $payload['enable_itn'] = (bool) $meta['enable_itn'];
        }

        $mode = trim((string) ($meta['mode'] ?? $meta['asr_mode'] ?? ''));
        if ($mode !== '') {
            $payload['mode'] = $mode;
        }

        $sym = self::chunkBufferSecFromMeta($meta);
        if ($sym !== null) {
            $payload['chunk_buffer_sec'] = $sym;
        } else {
            $sides = self::chunkBufferSidesFromMeta($meta);
            if ($sides['before'] !== null) {
                $payload['chunk_buffer_before_sec'] = $sides['before'];
            }
            if ($sides['after'] !== null) {
                $payload['chunk_buffer_after_sec'] = $sides['after'];
            }
        }

        return $payload;
    }

    public static function providerFromMeta(?array $meta): string
    {
        if ($meta === null || $meta === []) {
            return 'openai_compat';
        }
        $raw = strtolower(trim((string) ($meta['provider'] ?? 'openai_compat')));

        return \in_array($raw, ['funasr', 'openai_compat'], true) ? $raw : 'openai_compat';
    }

    public static function diarizationEnabledFromMeta(?array $meta): bool
    {
        if ($meta === null || $meta === []) {
            return false;
        }

        return ! empty($meta['diarization_enabled']);
    }

    /** Speaker Mode requires built-in FunASR smoke test before save. */
    public static function requiresBuiltInFunasr(?array $meta): bool
    {
        return self::providerFromMeta($meta) === 'funasr' && self::diarizationEnabledFromMeta($meta);
    }

    public static function defaultFunasrBaseUrl(): string
    {
        $env = getenv('OAAO_FUNASR_BASE_URL');
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/');
        }

        return 'http://funasr:8765';
    }

    /** @return 'stub'|'pipeline' */
    public static function funasrAdapterModeFromMeta(?array $meta): string
    {
        if ($meta === null || $meta === []) {
            return 'stub';
        }
        $raw = strtolower(trim((string) ($meta['funasr_adapter_mode'] ?? 'stub')));

        return $raw === 'pipeline' ? 'pipeline' : 'stub';
    }

    public static function funasrSpkModelFromMeta(?array $meta): string
    {
        if ($meta === null || $meta === []) {
            return '';
        }
        $raw = trim((string) ($meta['funasr_spk_model'] ?? ''));

        return \strlen($raw) > 120 ? substr($raw, 0, 120) : $raw;
    }

    /**
     * Docker Compose env overrides for the built-in {@code funasr} service.
     *
     * @return array<string, string>
     */
    public static function funasrContainerEnvFromMeta(?array $meta): array
    {
        $out = [
            'FUNASR_ADAPTER_MODE' => self::funasrAdapterModeFromMeta($meta),
        ];
        $spk = self::funasrSpkModelFromMeta($meta);
        if ($spk !== '') {
            $out['FUNASR_SPK_MODEL'] = $spk;
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, string>
     */
    public static function sanitizeFunasrContainerEnv(array $raw): array
    {
        /** @var array<string, string> $out */
        $out = [];
        if (isset($raw['FUNASR_ADAPTER_MODE']) || isset($raw['funasr_adapter_mode'])) {
            $mode = strtolower(trim((string) ($raw['FUNASR_ADAPTER_MODE'] ?? $raw['funasr_adapter_mode'] ?? 'stub')));
            $out['FUNASR_ADAPTER_MODE'] = $mode === 'pipeline' ? 'pipeline' : 'stub';
        }
        if (isset($raw['FUNASR_SPK_MODEL']) || isset($raw['funasr_spk_model'])) {
            $spk = trim((string) ($raw['FUNASR_SPK_MODEL'] ?? $raw['funasr_spk_model'] ?? ''));
            if ($spk !== '') {
                $out['FUNASR_SPK_MODEL'] = \strlen($spk) > 120 ? substr($spk, 0, 120) : $spk;
            }
        }

        return $out;
    }

    public static function speakerCountFromMeta(?array $meta): ?int
    {
        if ($meta === null || $meta === [] || ! \array_key_exists('speaker_count', $meta)) {
            return null;
        }
        $raw = $meta['speaker_count'];
        if (\is_int($raw)) {
            $n = $raw;
        } elseif (\is_float($raw)) {
            $n = (int) $raw;
        } elseif (\is_string($raw) && is_numeric(trim($raw))) {
            $n = (int) trim($raw);
        } else {
            return null;
        }
        if ($n < 2 || $n > 100) {
            return null;
        }

        return $n;
    }

    /**
     * @return list<string>
     */
    public static function languageHintsFromMeta(?array $meta): array
    {
        if ($meta === null || $meta === [] || ! isset($meta['language_hints'])) {
            return [];
        }
        $raw = $meta['language_hints'];
        if (! \is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $hint) {
            if (! \is_string($hint) && ! \is_int($hint) && ! \is_float($hint)) {
                continue;
            }
            $s = strtolower(trim((string) $hint));
            if ($s !== '') {
                $out[] = $s;
            }
        }

        return $out;
    }

    private static function clampSeconds(mixed $raw): ?float
    {
        if (\is_int($raw) || \is_float($raw)) {
            $v = (float) $raw;
        } elseif (\is_string($raw) && is_numeric(trim($raw))) {
            $v = (float) trim($raw);
        } else {
            return null;
        }
        if (! is_finite($v) || $v < 0 || $v > 120) {
            return null;
        }

        return round($v, 3);
    }
}
