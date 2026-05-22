<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/**
 * Copy Qdrant collections when tenant slug prefix changed (e.g. {@code web_*} → {@code localhost_*}).
 */
final class QdrantCollectionMigrator
{
    /**
     * @return array{collections: list<array<string, mixed>>, points_migrated: int}
     */
    public static function migrateSlugPrefix(
        string $fromSlug,
        string $toSlug,
        bool $deleteSource = false,
        ?string $qdrantBaseUrl = null,
        ?string $apiKey = null,
    ): array {
        $fromSlug = self::sanitizeSlug($fromSlug);
        $toSlug = self::sanitizeSlug($toSlug);
        if ($fromSlug === '' || $toSlug === '' || $fromSlug === $toSlug) {
            throw new \InvalidArgumentException('from_slug and to_slug must differ');
        }

        $base = self::normalizeBaseUrl($qdrantBaseUrl ?? self::defaultBaseUrl());
        if ($base === '') {
            throw new \RuntimeException('Qdrant URL not configured');
        }

        $fromPrefix = $fromSlug . '_';
        $toPrefix = $toSlug . '_';

        $names = self::listCollectionNames($base, $apiKey);
        /** @var list<array<string, mixed>> $results */
        $results = [];
        $totalPoints = 0;

        foreach ($names as $name) {
            if (! str_starts_with($name, $fromPrefix)) {
                continue;
            }
            $target = $toPrefix . substr($name, strlen($fromPrefix));
            $migrated = self::copyCollection($base, $apiKey, $name, $target);
            $totalPoints += $migrated;
            $entry = [
                'source'          => $name,
                'target'          => $target,
                'points_migrated' => $migrated,
            ];
            if ($deleteSource && $migrated > 0) {
                $entry['source_deleted'] = self::deleteCollection($base, $apiKey, $name);
            }
            $results[] = $entry;
        }

        return [
            'collections'     => $results,
            'points_migrated' => $totalPoints,
        ];
    }

    public static function updateVaultCollectionOverrides(\PDO $pdo, string $fromSlug, string $toSlug): int
    {
        $fromSlug = self::sanitizeSlug($fromSlug);
        $toSlug = self::sanitizeSlug($toSlug);
        if ($fromSlug === '' || $toSlug === '' || $fromSlug === $toSlug) {
            return 0;
        }

        $fromPrefix = $fromSlug . '_';
        $toPrefix = $toSlug . '_';

        $st = $pdo->query(
            "SELECT id, qdrant_collection FROM oaao_vault WHERE qdrant_collection IS NOT NULL AND qdrant_collection <> ''",
        );
        if ($st === false) {
            return 0;
        }

        $upd = $pdo->prepare('UPDATE oaao_vault SET qdrant_collection = ? WHERE id = ?');
        $count = 0;
        while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $col = trim((string) ($row['qdrant_collection'] ?? ''));
            if ($col === '' || ! str_starts_with($col, $fromPrefix)) {
                continue;
            }
            $newCol = $toPrefix . substr($col, strlen($fromPrefix));
            $upd->execute([$newCol, (int) ($row['id'] ?? 0)]);
            ++$count;
        }

        return $count;
    }

    private static function sanitizeSlug(string $slug): string
    {
        $s = strtolower(trim($slug));
        $s = (string) preg_replace('/[^a-z0-9_-]+/', '_', $s);
        $s = trim($s, '_');

        return substr($s, 0, 48);
    }

    private static function defaultBaseUrl(): string
    {
        $v = getenv('OAAO_QDRANT_URL');

        return \is_string($v) && trim($v) !== '' ? trim($v) : 'http://qdrant:6333';
    }

    private static function normalizeBaseUrl(string $raw): string
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

    /** @return list<string> */
    private static function listCollectionNames(string $base, ?string $apiKey): array
    {
        $decoded = self::curlJson('GET', $base . '/collections', null, $apiKey);
        if (! \is_array($decoded)) {
            return [];
        }
        $result = $decoded['result'] ?? null;
        if (! \is_array($result)) {
            return [];
        }
        $collections = $result['collections'] ?? null;
        if (! \is_array($collections)) {
            return [];
        }

        /** @var list<string> $out */
        $out = [];
        foreach ($collections as $c) {
            if (\is_array($c) && isset($c['name'])) {
                $out[] = (string) $c['name'];
            }
        }

        return $out;
    }

    private static function copyCollection(string $base, ?string $apiKey, string $source, string $target): int
    {
        $info = self::curlJson('GET', $base . '/collections/' . rawurlencode($source), null, $apiKey);
        $vectorSize = self::vectorSizeFromCollectionInfo($info);
        if ($vectorSize < 1) {
            return 0;
        }

        if (! self::collectionExists($base, $apiKey, $target)) {
            if (! self::createCollection($base, $apiKey, $target, $vectorSize)) {
                return 0;
            }
        }

        $migrated = 0;
        $offset = null;
        $guard = 0;

        do {
            ++$guard;
            if ($guard > 512) {
                break;
            }

            /** @var array<string, mixed> $body */
            $body = [
                'limit'        => 64,
                'with_payload' => true,
                'with_vector'  => true,
            ];
            if ($offset !== null) {
                $body['offset'] = $offset;
            }

            $decoded = self::curlJson(
                'POST',
                $base . '/collections/' . rawurlencode($source) . '/points/scroll',
                $body,
                $apiKey,
            );
            if (! \is_array($decoded)) {
                break;
            }
            $result = $decoded['result'] ?? null;
            if (! \is_array($result)) {
                break;
            }

            $points = $result['points'] ?? null;
            if (\is_array($points) && $points !== []) {
                $batch = [];
                foreach ($points as $pt) {
                    if (! \is_array($pt)) {
                        continue;
                    }
                    $batch[] = $pt;
                }
                if ($batch !== [] && self::upsertPoints($base, $apiKey, $target, $batch)) {
                    $migrated += \count($batch);
                }
            }

            $next = $result['next_page_offset'] ?? null;
            $offset = (\is_int($next) || (\is_string($next) && $next !== '')) ? $next : null;
        } while ($offset !== null);

        return $migrated;
    }

    /** @param array<string, mixed>|null $info */
    private static function vectorSizeFromCollectionInfo(?array $info): int
    {
        if ($info === null) {
            return 0;
        }
        $result = $info['result'] ?? null;
        if (! \is_array($result)) {
            return 0;
        }
        $config = $result['config'] ?? null;
        if (! \is_array($config)) {
            return 0;
        }
        $params = $config['params'] ?? null;
        if (! \is_array($params)) {
            return 0;
        }
        $vectors = $params['vectors'] ?? null;
        if (\is_array($vectors) && isset($vectors['size'])) {
            return (int) $vectors['size'];
        }
        if (\is_array($vectors)) {
            foreach ($vectors as $v) {
                if (\is_array($v) && isset($v['size'])) {
                    return (int) $v['size'];
                }
            }
        }

        return 0;
    }

    private static function collectionExists(string $base, ?string $apiKey, string $name): bool
    {
        $decoded = self::curlJson('GET', $base . '/collections/' . rawurlencode($name), null, $apiKey);

        return \is_array($decoded) && isset($decoded['result']);
    }

    private static function createCollection(string $base, ?string $apiKey, string $name, int $vectorSize): bool
    {
        /** @var array<string, mixed> */
        $body = [
            'vectors' => [
                'size'     => $vectorSize,
                'distance' => 'Cosine',
            ],
        ];

        return self::curlJson('PUT', $base . '/collections/' . rawurlencode($name), $body, $apiKey) !== null;
    }

    /** @param list<array<string, mixed>> $points */
    private static function upsertPoints(string $base, ?string $apiKey, string $collection, array $points): bool
    {
        /** @var array<string, mixed> */
        $body = [
            'points' => $points,
            'wait'   => true,
        ];

        return self::curlJson(
            'PUT',
            $base . '/collections/' . rawurlencode($collection) . '/points',
            $body,
            $apiKey,
        ) !== null;
    }

    private static function deleteCollection(string $base, ?string $apiKey, string $name): bool
    {
        return self::curlJson('DELETE', $base . '/collections/' . rawurlencode($name), null, $apiKey) !== null;
    }

    /** @param array<string, mixed>|null $body
     * @return array<string, mixed>|null
     */
    private static function curlJson(string $method, string $url, ?array $body, ?string $apiKey): ?array
    {
        $headers = ['Accept: application/json'];
        if ($apiKey !== null && $apiKey !== '') {
            $headers[] = 'api-key: ' . $apiKey;
        }

        $payload = null;
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            try {
                $payload = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return null;
            }
        }

        if (! \function_exists('curl_init')) {
            return null;
        }

        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }

        $opts = [
            \CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            \CURLOPT_HTTPHEADER     => $headers,
            \CURLOPT_RETURNTRANSFER => true,
            \CURLOPT_CONNECTTIMEOUT => 8,
            \CURLOPT_TIMEOUT        => 120,
        ];
        if ($payload !== null) {
            $opts[\CURLOPT_POSTFIELDS] = $payload;
        }
        curl_setopt_array($ch, $opts);

        $rawOut = curl_exec($ch);
        $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        curl_close($ch);

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
