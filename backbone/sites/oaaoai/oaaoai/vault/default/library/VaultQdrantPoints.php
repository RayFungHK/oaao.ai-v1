<?php

declare(strict_types=1);

namespace oaaoai\vault;

use oaaoai\chat\ChatOrchestratorBootstrap;

/**
 * Minimal Qdrant REST helpers — tenant vectors use payload {@code vault_id}/{@code document_id} ({@see vault_document_embed}).
 */
final class VaultQdrantPoints
{
    /**
     * Best-effort: delete points whose payload matches {@code vault_id} + {@code document_id}.
     *
     * Failures return {@code false} (callers swallow — document delete still proceeds).
     */
    public static function deleteEmbeddingsForDocument(array $vaultRow, int $vaultId, int $documentId): bool
    {
        if ($vaultId < 1 || $documentId < 1) {
            return false;
        }

        $col = VaultQdrantCollectionResolver::resolveEffectiveCollection($vaultRow);
        if ($col === null || $col === '') {
            return false;
        }

        $bu = isset($vaultRow['qdrant_url']) ? trim((string) $vaultRow['qdrant_url']) : '';
        if ($bu === '') {
            $bu = self::defaultQdrantBaseUrl();
        }
        if ($bu === '') {
            return false;
        }
        $base = self::normalizeQdrantBaseUrl($bu);
        if ($base === '') {
            return false;
        }

        /** @var array<string, mixed> */
        $body = [
            'filter' => [
                'must' => [
                    [
                        'key'   => 'vault_id',
                        'match' => ['value' => $vaultId],
                    ],
                    [
                        'key'   => 'document_id',
                        'match' => ['value' => $documentId],
                    ],
                ],
            ],
            'wait' => true,
        ];

        return self::curlPostJson(
            $base . '/collections/' . rawurlencode($col) . '/points/delete',
            $body,
            self::inferQdrantApiKeyFromVaultRow($vaultRow),
        ) !== null;
    }

    /**
     * Count embedded chunk points for one document ({@code vault_id} + {@code document_id} payload filter).
     */
    public static function countEmbeddingsForDocument(array $vaultRow, int $vaultId, int $documentId): ?int
    {
        $conn = self::resolveConnection($vaultRow);
        if ($conn === null || $vaultId < 1 || $documentId < 1) {
            return null;
        }

        /** @var array<string, mixed> */
        $body = [
            'filter' => self::documentFilter($vaultId, $documentId),
            'exact'  => true,
        ];

        $decoded = self::curlPostJson(
            $conn['base'] . '/collections/' . rawurlencode($conn['collection']) . '/points/count',
            $body,
            $conn['api_key'],
        );
        if (! \is_array($decoded)) {
            return null;
        }

        $result = $decoded['result'] ?? null;
        if (\is_array($result) && isset($result['count'])) {
            return (int) $result['count'];
        }
        if (\is_int($result) || (\is_string($result) && ctype_digit($result))) {
            return (int) $result;
        }

        return null;
    }

    /**
     * Scroll chunk payloads (no vectors) for one embedded document.
     *
     * @return list<array<string, mixed>>|null {@code null} when Qdrant is unreachable
     */
    public static function scrollEmbeddingsForDocument(array $vaultRow, int $vaultId, int $documentId): ?array
    {
        $conn = self::resolveConnection($vaultRow);
        if ($conn === null || $vaultId < 1 || $documentId < 1) {
            return null;
        }

        /** @var list<array<string, mixed>> $chunks */
        $chunks = [];
        $offset = null;
        $guard = 0;

        do {
            ++$guard;
            if ($guard > 64) {
                break;
            }

            /** @var array<string, mixed> */
            $body = [
                'filter'        => self::documentFilter($vaultId, $documentId),
                'limit'         => 128,
                'with_payload'  => true,
                'with_vector'   => false,
            ];
            if ($offset !== null) {
                $body['offset'] = $offset;
            }

            $decoded = self::curlPostJson(
                $conn['base'] . '/collections/' . rawurlencode($conn['collection']) . '/points/scroll',
                $body,
                $conn['api_key'],
            );
            if (! \is_array($decoded)) {
                return $chunks === [] ? null : $chunks;
            }

            $result = $decoded['result'] ?? null;
            if (! \is_array($result)) {
                break;
            }

            $points = $result['points'] ?? null;
            if (\is_array($points)) {
                foreach ($points as $pt) {
                    if (! \is_array($pt)) {
                        continue;
                    }
                    $payload = $pt['payload'] ?? null;
                    if (\is_array($payload)) {
                        $chunks[] = self::normalizeChunkPayload($payload);
                    }
                }
            }

            $next = $result['next_page_offset'] ?? null;
            $offset = (\is_int($next) || (\is_string($next) && $next !== '')) ? $next : null;
        } while ($offset !== null);

        usort(
            $chunks,
            static fn (array $a, array $b): int => ((int) ($a['chunk_index'] ?? 0)) <=> ((int) ($b['chunk_index'] ?? 0)),
        );

        return $chunks;
    }

    /**
     * @return array{base: string, collection: string, api_key: ?string}|null
     */
    private static function resolveConnection(array $vaultRow): ?array
    {
        $col = VaultQdrantCollectionResolver::resolveEffectiveCollection($vaultRow);
        if ($col === null || $col === '') {
            return null;
        }

        $bu = isset($vaultRow['qdrant_url']) ? trim((string) $vaultRow['qdrant_url']) : '';
        if ($bu === '') {
            $bu = self::defaultQdrantBaseUrl();
        }
        if ($bu === '') {
            return null;
        }
        $base = self::normalizeQdrantBaseUrl($bu);
        if ($base === '') {
            return null;
        }

        return [
            'base'       => $base,
            'collection' => $col,
            'api_key'    => self::inferQdrantApiKeyFromVaultRow($vaultRow),
        ];
    }

    /** @return array<string, mixed> */
    private static function documentFilter(int $vaultId, int $documentId): array
    {
        return [
            'must' => [
                [
                    'key'   => 'vault_id',
                    'match' => ['value' => $vaultId],
                ],
                [
                    'key'   => 'document_id',
                    'match' => ['value' => $documentId],
                ],
            ],
        ];
    }

    /** @param array<string, mixed> $payload */
    private static function normalizeChunkPayload(array $payload): array
    {
        $text = isset($payload['text']) && \is_string($payload['text']) ? $payload['text'] : '';
        /** @var array<string, mixed> */
        $out = [
            'chunk_index'   => isset($payload['chunk_index']) ? (int) $payload['chunk_index'] : 0,
            'segment_scope' => isset($payload['segment_scope']) ? trim((string) $payload['segment_scope']) : '',
            'segment_label' => isset($payload['segment_label']) ? trim((string) $payload['segment_label']) : '',
            'char_count'    => mb_strlen($text),
            'text'          => $text,
        ];
        foreach (['page', 'sheet', 'slide'] as $k) {
            if (isset($payload[$k]) && $payload[$k] !== '' && $payload[$k] !== null) {
                $out[$k] = $payload[$k];
            }
        }
        if (isset($payload['ocr']) && ($payload['ocr'] === true || $payload['ocr'] === 1 || $payload['ocr'] === '1')) {
            $out['ocr'] = true;
        }

        return $out;
    }

    /** @param array<string, mixed> $vaultRow */
    private static function inferQdrantApiKeyFromVaultRow(array $vaultRow): ?string
    {
        $ref = isset($vaultRow['qdrant_api_key_ref']) ? trim((string) $vaultRow['qdrant_api_key_ref']) : '';
        if ($ref === '') {
            return null;
        }

        $envName = ChatOrchestratorBootstrap::inferApiKeyEnv($ref);
        if ($envName === null || $envName === '') {
            return null;
        }
        $v = getenv($envName);

        return \is_string($v) && trim($v) !== '' ? trim($v) : null;
    }

    private static function normalizeQdrantBaseUrl(string $raw): string
    {
        $bu = rtrim(trim($raw), '/');
        if ($bu === '') {
            return '';
        }
        if (! preg_match('#^https?://#i', $bu)) {
            $bu = 'http://' . ltrim($bu, '/');
        }

        return rtrim($bu, '/');
    }

    /** Compose / sidecar default — orchestrator uses the same host ({@see docker-compose.yml}). */
    private static function defaultQdrantBaseUrl(): string
    {
        $fallback = getenv('OAAO_QDRANT_URL');
        $bu = \is_string($fallback) ? trim($fallback) : '';
        if ($bu !== '') {
            return $bu;
        }

        $docker = getenv('OAAO_DOCKER');
        if ($docker !== false && \in_array(strtolower(trim((string) $docker)), ['1', 'true', 'yes'], true)) {
            return 'http://qdrant:6333';
        }

        return '';
    }

    /** @param array<string, mixed> $body
     * @return array<string, mixed>|null decoded JSON on HTTP 2xx, {@code null} on failure
     */
    private static function curlPostJson(string $url, array $body, ?string $apiKey): ?array
    {
        $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
        ];
        if ($apiKey !== null && $apiKey !== '') {
            $headers[] = 'api-key: ' . $apiKey;
        }

        $rawOut = false;
        $code = 0;

        if (\function_exists('curl_init')) {
            $ch = curl_init($url);
            if ($ch === false) {
                return null;
            }
            curl_setopt_array($ch, [
                \CURLOPT_POST           => true,
                \CURLOPT_HTTPHEADER     => $headers,
                \CURLOPT_POSTFIELDS     => $payload,
                \CURLOPT_RETURNTRANSFER => true,
                \CURLOPT_CONNECTTIMEOUT => 6,
                \CURLOPT_TIMEOUT        => 90,
            ]);
            $rawOut = curl_exec($ch);
            $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
            curl_close($ch);
        } else {
            $hdrs = implode("\r\n", $headers);
            $ctx = stream_context_create([
                'http' => [
                    'method'  => 'POST',
                    'header'  => $hdrs . "\r\n",
                    'content' => $payload,
                    'timeout' => 90,
                ],
            ]);

            $rawOut = @file_get_contents($url, false, $ctx);
            $line = $http_response_header[0] ?? '';
            if (\is_string($line) && preg_match('#HTTP/\S+\s+(\d{3})\b#', $line, $m)) {
                $code = (int) $m[1];
            }
        }

        if ($rawOut === false || $code < 200 || $code >= 300) {
            return null;
        }

        if (! \is_string($rawOut) || trim($rawOut) === '') {
            return [];
        }

        try {
            $decoded = json_decode($rawOut, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return \is_array($decoded) ? $decoded : null;
    }
}
