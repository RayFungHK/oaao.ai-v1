<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Probe OpenAI-compatible {@code GET /v1/models} for context limits.
 */
final class OpenAiCompatModelProbe
{
    public static function modelsUrl(string $baseUrl): string
    {
        $bu = rtrim(trim($baseUrl), '/');
        if ($bu === '') {
            return '';
        }
        if (str_ends_with($bu, '/models')) {
            return $bu;
        }
        if (str_ends_with($bu, '/v1')) {
            return $bu . '/models';
        }

        return $bu . '/v1/models';
    }

    public static function suggestedMaxOutputTokens(int $maxModelLen): int
    {
        $cap = (int) floor($maxModelLen * 0.35);

        return max(64, min(512, $cap));
    }

    /**
     * @return array{
     *   success: bool,
     *   http_code: int,
     *   message: string,
     *   model_id: string|null,
     *   max_model_len: int|null,
     *   suggested_max_output_tokens: int|null,
     *   config_json_patch: array<string, int|string>
     * }
     */
    public static function probe(string $baseUrl, string $model, ?string $bearerToken = null): array
    {
        $model = trim($model);
        $url = self::modelsUrl($baseUrl);
        if ($url === '' || $model === '') {
            return [
                'success'                     => false,
                'http_code'                   => 0,
                'message'                     => 'base_url and model are required',
                'model_id'                    => null,
                'max_model_len'               => null,
                'suggested_max_output_tokens' => null,
                'config_json_patch'           => [],
            ];
        }

        $headers = ['Accept: application/json'];
        if ($bearerToken !== null && trim($bearerToken) !== '') {
            $headers[] = 'Authorization: Bearer ' . trim($bearerToken);
        }

        $httpCode = 0;
        $raw = false;
        $errMsg = '';

        if (\function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch !== false) {
                curl_setopt_array($ch, [
                    \CURLOPT_RETURNTRANSFER => true,
                    \CURLOPT_TIMEOUT        => 15,
                    \CURLOPT_HTTPHEADER     => $headers,
                ]);
                $raw = curl_exec($ch);
                $httpCode = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
                if ($raw === false) {
                    $errMsg = (string) curl_error($ch);
                }
                curl_close($ch);
            }
        } else {
            $ctx = stream_context_create(['http' => ['timeout' => 15, 'header' => implode("\r\n", $headers) . "\r\n"]]);
            $raw = @file_get_contents($url, false, $ctx);
            if ($raw === false) {
                $errMsg = 'fetch_failed';
            } else {
                $httpCode = 200;
            }
        }

        if ($raw === false || ! \is_string($raw) || $raw === '') {
            return [
                'success'                     => false,
                'http_code'                   => $httpCode,
                'message'                     => $errMsg !== '' ? $errMsg : 'fetch_failed',
                'model_id'                    => null,
                'max_model_len'               => null,
                'suggested_max_output_tokens' => null,
                'config_json_patch'           => [],
            ];
        }

        try {
            /** @var array<string, mixed>|null $body */
            $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [
                'success'                     => false,
                'http_code'                   => $httpCode,
                'message'                     => 'invalid_json',
                'model_id'                    => null,
                'max_model_len'               => null,
                'suggested_max_output_tokens' => null,
                'config_json_patch'           => [],
            ];
        }

        $entries = \is_array($body) && isset($body['data']) && \is_array($body['data']) ? $body['data'] : [];
        $picked = self::matchModelEntry($entries, $model);
        if ($picked === null) {
            return [
                'success'                     => false,
                'http_code'                   => $httpCode,
                'message'                     => 'model_not_found',
                'model_id'                    => null,
                'max_model_len'               => null,
                'suggested_max_output_tokens' => null,
                'config_json_patch'           => [],
            ];
        }

        $modelId = trim((string) ($picked['id'] ?? $picked['model'] ?? $model));
        $rawLen = $picked['max_model_len'] ?? $picked['context_length'] ?? null;
        $maxModelLen = null;
        if ($rawLen !== null && is_numeric($rawLen)) {
            $maxModelLen = max(256, min((int) $rawLen, 131072));
        }

        if ($maxModelLen === null) {
            return [
                'success'                     => false,
                'http_code'                   => $httpCode,
                'message'                     => 'max_model_len_missing',
                'model_id'                    => $modelId !== '' ? $modelId : null,
                'max_model_len'               => null,
                'suggested_max_output_tokens' => null,
                'config_json_patch'           => [],
            ];
        }

        $suggested = self::suggestedMaxOutputTokens($maxModelLen);
        $patch = [
            'max_model_len'       => $maxModelLen,
            'max_output_tokens'   => $suggested,
            'model_probed_at'     => gmdate('c'),
            'model_probed_id'     => $modelId,
        ];

        return [
            'success'                     => true,
            'http_code'                   => $httpCode,
            'message'                     => "max_model_len={$maxModelLen}",
            'model_id'                    => $modelId !== '' ? $modelId : null,
            'max_model_len'               => $maxModelLen,
            'suggested_max_output_tokens' => $suggested,
            'config_json_patch'           => $patch,
        ];
    }

    /**
     * @param list<mixed> $entries
     *
     * @return array<string, mixed>|null
     */
    private static function matchModelEntry(array $entries, string $model): ?array
    {
        $target = trim($model);
        if ($target === '') {
            return null;
        }
        $suffix = null;
        foreach ($entries as $item) {
            if (! \is_array($item)) {
                continue;
            }
            $mid = trim((string) ($item['id'] ?? $item['model'] ?? ''));
            if ($mid === '') {
                continue;
            }
            if ($mid === $target) {
                return $item;
            }
            if (str_ends_with($mid, '/' . $target) || str_ends_with($target, '/' . $mid)) {
                $suffix = $item;
            }
        }

        return $suffix;
    }
}
