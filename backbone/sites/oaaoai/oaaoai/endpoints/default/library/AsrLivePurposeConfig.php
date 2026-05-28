<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * ASR-Live purpose {@code meta_json} → orchestrator payload ({@code asr.live.*}).
 *
 * Endpoint URL + model come from {@code oaao_endpoint} (Purpose allocation).
 * Settings panel only stores preferred language + ITN in {@code meta_json}.
 */
final class AsrLivePurposeConfig
{
    public const DEFAULT_FUNASR_NANO_BASE = 'https://funasr-nano.rayfung.hk';

    public const DEFAULT_MODEL = 'FunAudioLLM/Fun-ASR-Nano-2512';

    /**
     * @return array<string, mixed>
     */
    public static function defaultLiveMeta(): array
    {
        return [
            'provider'            => 'funasr_nano',
            'mode'                => 'streaming',
            'language'            => 'yue',
            'preferred_language'  => 'yue',
            'itn'                 => true,
            'input_fallback'      => true,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function decodePurposeMeta(mixed $metaJson): array
    {
        return AsrPurposeConfig::decodePurposeMeta($metaJson);
    }

    public static function providerFromMeta(?array $meta): string
    {
        if ($meta === null || $meta === []) {
            return 'funasr_nano';
        }
        $raw = strtolower(trim((string) ($meta['provider'] ?? 'funasr_nano')));

        return \in_array($raw, ['funasr_nano', 'funasr_local_stream', 'dashscope', 'openai_compat'], true)
            ? $raw
            : 'funasr_nano';
    }

    /**
     * Resolve FunASR Nano HTTP base — endpoint row first (http(s) only), then meta / env.
     * WebSocket {@code base_url} on the endpoint row is handled by {@see funasrStreamUrlFromBinding()}.
     *
     * @param array<string, mixed> $liveBind
     */
    public static function funasrBaseUrlFromBinding(array $liveBind, ?array $meta = null): string
    {
        $endpointBase = trim((string) ($liveBind['base_url'] ?? ''));
        if ($endpointBase !== '' && self::isHttpUrl($endpointBase) && ! str_contains($endpointBase, '/audio/transcriptions')) {
            // ASR-Live endpoint row is always a stream URL; http(s) is coerced to ws(s), not batch transcribe.
            if (self::coerceWebSocketUrl($endpointBase) === '') {
                return rtrim($endpointBase, '/');
            }
        }

        if ($meta !== null && $meta !== []) {
            foreach (['funasr_base_url', 'funasr_live_base_url'] as $key) {
                $bu = trim((string) ($meta[$key] ?? ''));
                if ($bu !== '') {
                    return rtrim($bu, '/');
                }
            }
        }

        $env = getenv('OAAO_FUNASR_NANO_BASE_URL');
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/');
        }

        return self::DEFAULT_FUNASR_NANO_BASE;
    }

    public static function isWebSocketUrl(string $url): bool
    {
        return preg_match('#^wss?://#i', trim($url)) === 1;
    }

    public static function isHttpUrl(string $url): bool
    {
        return preg_match('#^https?://#i', trim($url)) === 1;
    }

    /**
     * ASR-Live ({@code asr.live}) stream URLs: accept {@code ws(s)://…} or upgrade {@code http(s)://…}.
     * This class is only used for the ASR-Live purpose — batch HTTP transcribe uses {@see AsrPurposeConfig}.
     */
    public static function coerceWebSocketUrl(string $url): string
    {
        $u = trim($url);
        if ($u === '') {
            return '';
        }
        if (self::isWebSocketUrl($u)) {
            return rtrim($u, '/');
        }
        if (! self::isHttpUrl($u)) {
            return '';
        }
        $parts = parse_url($u);
        if (! \is_array($parts)) {
            return '';
        }
        $host = (string) ($parts['host'] ?? '');
        if ($host === '') {
            return '';
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        $wsScheme = $scheme === 'http' ? 'ws' : 'wss';
        $port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
        $path = rtrim((string) ($parts['path'] ?? ''), '/');

        return $wsScheme . '://' . $host . $port . $path;
    }

    /**
     * Duplex streaming URL — Live ASR primary path ({@code wss://…} on endpoint or purpose meta).
     *
     * @param array<string, mixed> $liveBind
     */
    public static function funasrStreamUrlFromBinding(array $liveBind, ?array $meta = null): string
    {
        $endpointBase = trim((string) ($liveBind['base_url'] ?? ''));
        if ($endpointBase !== '') {
            $coerced = self::coerceWebSocketUrl($endpointBase);
            if ($coerced !== '') {
                return $coerced;
            }
            if (self::isWebSocketUrl($endpointBase)) {
                return rtrim($endpointBase, '/');
            }
        }

        if ($meta !== null && $meta !== []) {
            foreach (['funasr_stream_url', 'ws_url', 'dashscope_ws_url'] as $key) {
                $u = trim((string) ($meta[$key] ?? ''));
                if ($u !== '' && self::isWebSocketUrl($u)) {
                    return rtrim($u, '/');
                }
            }
        }

        return '';
    }

    /**
     * @param array<string, mixed> $liveBind from {@see CanonicalEndpointsRepository::resolveLiveAsrBinding()}
     * @param callable(string): (string|null) $inferApiKeyEnv
     *
     * @return array<string, mixed>
     */
    public static function jobPayloadFromBinding(array $liveBind, callable $inferApiKeyEnv): array
    {
        /** @var array<string, mixed> $meta */
        $meta = \is_array($liveBind['purpose_meta'] ?? null) ? $liveBind['purpose_meta'] : [];
        $provider = self::providerFromMeta($meta);
        $endpointModel = trim((string) ($liveBind['model'] ?? ''));
        $metaModel = trim((string) ($meta['model'] ?? ''));
        $model = $endpointModel !== '' ? $endpointModel : ($metaModel !== '' ? $metaModel : self::DEFAULT_MODEL);
        $aref = trim((string) ($liveBind['api_key_ref'] ?? ''));
        $streamUrl = self::funasrStreamUrlFromBinding($liveBind, $meta);
        $funasrHttp = self::funasrBaseUrlFromBinding($liveBind, $meta);

        $payload = [
            'purpose_key'     => (string) ($liveBind['purpose_key'] ?? 'asr.live'),
            'provider'        => $provider,
            'model'           => $model,
            'api_key_env'     => ($aref !== '' ? $inferApiKeyEnv($aref) : null),
        ];

        if ($streamUrl !== '') {
            $payload['funasr_stream_url'] = $streamUrl;
            $streamProtocol = trim((string) ($meta['stream_protocol'] ?? $meta['live_stream_protocol'] ?? ''));
            $payload['stream_protocol'] = $streamProtocol !== '' ? $streamProtocol : 'funasr_nano_ws';
        }

        if ($funasrHttp !== '' && self::isHttpUrl($funasrHttp)) {
            $payload['base_url'] = $funasrHttp;
            $payload['funasr_base_url'] = $funasrHttp;
        } elseif ($streamUrl !== '') {
            $payload['base_url'] = $streamUrl;
        } else {
            $payload['base_url'] = $funasrHttp;
            $payload['funasr_base_url'] = $funasrHttp;
        }

        $mode = trim((string) ($meta['mode'] ?? $meta['asr_mode'] ?? ''));
        if ($mode === '' && $streamUrl !== '') {
            $mode = 'streaming';
        }
        if ($mode === '') {
            $mode = 'streaming';
        }
        $payload['mode'] = $mode;

        $lang = trim((string) ($meta['preferred_language'] ?? $meta['language'] ?? ''));
        if ($lang !== '') {
            $payload['language'] = $lang;
        }

        if (\array_key_exists('itn', $meta)) {
            $payload['itn'] = (bool) $meta['itn'];
        } elseif (\array_key_exists('enable_itn', $meta)) {
            $payload['itn'] = (bool) $meta['enable_itn'];
        }

        if (\array_key_exists('input_fallback', $meta)) {
            $payload['input_fallback'] = (bool) $meta['input_fallback'];
        }

        $dsWs = trim((string) ($meta['dashscope_ws_url'] ?? $meta['ws_url'] ?? ''));
        if ($dsWs !== '' && $streamUrl === '') {
            $payload['dashscope_ws_url'] = $dsWs;
        }

        $hints = AsrPurposeConfig::languageHintsFromMeta($meta);
        if ($hints !== []) {
            $payload['language_hints'] = $hints;
        }

        return $payload;
    }
}
