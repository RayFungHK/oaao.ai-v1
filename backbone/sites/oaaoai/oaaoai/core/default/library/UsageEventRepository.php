<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/AuthSchemaBridge.php';
require_once __DIR__ . '/CreditLedgerRepository.php';

/**
 * Append-only tenant usage ledger ({@code oaao_usage_event}).
 */
final class UsageEventRepository
{
    /**
     * Normalize purpose tag for reporting ({@code oaao_usage_event.purpose_key} + {@code meta_json}).
     *
     * @param array<string, mixed>|null $meta
     */
    public static function resolvePurposeKey(string $eventKind, ?array $meta = null): string
    {
        if ($meta !== null) {
            $pk = trim((string) ($meta['purpose_key'] ?? ''));
            if ($pk !== '') {
                return $pk;
            }
        }

        return match ($eventKind) {
            'chat.completion'  => 'chat',
            'chat.asr'         => 'asr',
            'vault.asr'        => 'asr',
            'vault.embed'      => 'embedding',
            'vault.graph_index'=> 'graph',
            default            => $eventKind !== '' ? $eventKind : 'unknown',
        };
    }

    /**
     * @param array<string, mixed>|null $meta
     */
    public static function record(
        \PDO $pdo,
        int $tenantId,
        string $eventKind,
        ?float $quantity = null,
        ?string $unit = null,
        ?array $meta = null,
        ?int $userId = null,
    ): int {
        $eventKind = trim($eventKind);
        if ($tenantId < 1 || $eventKind === '') {
            return 0;
        }

        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return 0;
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        $purposeKey = self::resolvePurposeKey($eventKind, $meta);
        if ($meta === null) {
            $meta = [];
        }
        if (! isset($meta['purpose_key']) || trim((string) $meta['purpose_key']) === '') {
            $meta['purpose_key'] = $purposeKey;
        }

        $metaJson = null;
        if ($meta !== []) {
            try {
                $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $metaJson = null;
            }
        }

        $uid = $userId !== null && $userId > 0 ? $userId : null;

        $stmt = $pdo->prepare(
            'INSERT INTO oaao_usage_event (tenant_id, user_id, event_kind, purpose_key, quantity, unit, meta_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             RETURNING event_id',
        );
        $stmt->execute([$tenantId, $uid, $eventKind, $purposeKey, $quantity, $unit, $metaJson]);
        $eventId = (int) $stmt->fetchColumn();

        return $eventId > 0 ? $eventId : 0;
    }

    /**
     * @param array<string, mixed> $body finish JSON body
     * @param array<string, mixed> $job  locked job row
     */
    public static function recordVaultJobFinish(
        \PDO $pdo,
        int $tenantId,
        string $hookId,
        string $status,
        array $body,
        array $job,
        ?int $userId = null,
    ): void {
        if ($status !== 'completed' || $tenantId < 1) {
            return;
        }

        /** @var array<string, mixed> $usage */
        $usage = isset($body['usage']) && \is_array($body['usage']) ? $body['usage'] : [];

        $meta = [
            'job_id'      => isset($job['job_id']) ? (int) $job['job_id'] : 0,
            'vault_id'    => isset($job['vault_id']) ? (int) $job['vault_id'] : 0,
            'document_id' => isset($job['document_id']) ? (int) $job['document_id'] : 0,
            'hook_id'     => $hookId,
        ];

        if ($hookId === 'vh.rag.audio_asr') {
            $chars = strlen(trim((string) ($body['source_text'] ?? '')));
            if ($chars < 1 && isset($usage['char_count'])) {
                $chars = (int) $usage['char_count'];
            }
            $meta['purpose_key'] = trim((string) ($usage['purpose_key'] ?? '')) ?: 'asr';
            self::record($pdo, $tenantId, 'vault.asr', (float) $chars, 'chars', array_merge($meta, $usage), $userId);

            return;
        }

        if ($hookId === 'vh.rag.document_embed') {
            $chunks = (int) ($usage['chunks'] ?? 0);
            $meta['purpose_key'] = trim((string) ($usage['purpose_key'] ?? '')) ?: 'embedding';
            self::record($pdo, $tenantId, 'vault.embed', (float) $chunks, 'chunks', array_merge($meta, $usage), $userId);

            return;
        }

        if ($hookId === 'vh.rag.graph_index') {
            $entities = (int) ($usage['entities'] ?? 0);
            $edges = (int) ($usage['edges'] ?? 0);
            $units = $entities + $edges;
            if ($units < 1) {
                $units = (int) ($usage['batches'] ?? 0);
            }
            $meta['purpose_key'] = trim((string) ($usage['purpose_key'] ?? '')) ?: 'graph';
            self::record($pdo, $tenantId, 'vault.graph_index', (float) $units, 'units', array_merge($meta, $usage), $userId);
        }
    }

    /**
     * @param array<string, mixed> $runMeta orchestrator {@code system/end} metrics
     */
    public static function recordChatCompletion(\PDO $pdo, int $tenantId, array $runMeta, ?int $userId = null): void
    {
        if ($tenantId < 1) {
            return;
        }

        $prompt = (int) ($runMeta['prompt_tokens'] ?? 0);
        $completion = (int) ($runMeta['completion_tokens'] ?? 0);
        if ($prompt < 1 && $completion < 1) {
            $completion = (int) ($runMeta['tokens_out'] ?? 0);
        }
        $total = $prompt + $completion;
        if ($total < 1 && $completion > 0) {
            $total = $completion;
        }
        if ($total < 1) {
            return;
        }

        $meta = [
            'prompt_tokens'     => $prompt,
            'completion_tokens' => $completion,
            'total_tokens'      => $total,
            'duration_ms'       => isset($runMeta['duration_ms']) ? (int) $runMeta['duration_ms'] : null,
            'model'             => isset($runMeta['model']) ? (string) $runMeta['model'] : null,
            'endpoint_ref'      => isset($runMeta['endpoint_ref']) ? (string) $runMeta['endpoint_ref'] : null,
            'endpoint_id'       => isset($runMeta['endpoint_id']) ? (int) $runMeta['endpoint_id'] : null,
            'chat_endpoint_id'  => isset($runMeta['chat_endpoint_id']) ? (int) $runMeta['chat_endpoint_id'] : null,
            'purpose_key'       => self::resolvePurposeKey('chat.completion', $runMeta),
            'user_id'           => isset($runMeta['user_id']) ? (int) $runMeta['user_id'] : null,
            'tokens_estimated'  => ! empty($runMeta['tokens_estimated']),
        ];

        $eventId = self::record(
            $pdo,
            $tenantId,
            'chat.completion',
            (float) $total,
            'tokens',
            array_filter($meta, static fn ($v) => $v !== null && $v !== ''),
            $userId,
        );

        if ($userId !== null && $userId > 0) {
            try {
                CreditLedgerRepository::debitChatCompletion($pdo, $tenantId, $userId, $runMeta, $eventId);
            } catch (\Throwable $e) {
                error_log('CreditLedgerRepository::debitChatCompletion: ' . $e->getMessage());
            }
        }
    }

    /**
     * Per-endpoint chat token aggregates for admin endpoint cards ({@code oaao_usage_event}).
     *
     * @param list<array{id: int|string, name?: string, config_json?: string|null}> $endpoints
     *
     * @return array<string, array{
     *   endpoint_id: int,
     *   calls_30d: int,
     *   avg_tokens_30d: float,
     *   max_tokens_limit: int|null,
     *   overloaded: bool,
     *   daily: list<array{date: string, calls: int, avg_tokens: float, total_tokens: float}>
     * }>
     */
    public static function endpointChatTokenStats(\PDO $pdo, int $tenantId, array $endpoints, int $dailyDays = 14): array
    {
        if ($tenantId < 1 || $endpoints === [] || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return [];
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);
        $dailyDays = max(7, min(30, $dailyDays));

        /** @var array<int, array{id: int, name: string, max_tokens_limit: int|null}> $byId */
        $byId = [];
        /** @var array<string, int> $idByName */
        $idByName = [];
        foreach ($endpoints as $ep) {
            if (! \is_array($ep)) {
                continue;
            }
            $eid = (int) ($ep['id'] ?? 0);
            if ($eid < 1) {
                continue;
            }
            $name = trim((string) ($ep['name'] ?? ''));
            $maxTok = null;
            $cfgRaw = isset($ep['config_json']) ? trim((string) $ep['config_json']) : '';
            if ($cfgRaw !== '') {
                try {
                    $cfg = json_decode($cfgRaw, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($cfg) && isset($cfg['max_tokens']) && (int) $cfg['max_tokens'] > 0) {
                        $maxTok = (int) $cfg['max_tokens'];
                    }
                } catch (\JsonException) {
                }
            }
            $byId[$eid] = ['id' => $eid, 'name' => $name, 'max_tokens_limit' => $maxTok];
            if ($name !== '') {
                $idByName[$name] = $eid;
            }
        }

        if ($byId === []) {
            return [];
        }

        $stmt = $pdo->prepare(
            "SELECT meta_json, quantity, created_at
             FROM oaao_usage_event
             WHERE tenant_id = ?
               AND event_kind = 'chat.completion'
               AND unit = 'tokens'
               AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
             ORDER BY created_at ASC",
        );
        $stmt->execute([$tenantId]);

        /** @var array<int, array{calls_30d: int, sum_30d: float, daily: array<string, array{calls: int, sum: float}>}> $acc */
        $acc = [];
        foreach (array_keys($byId) as $eid) {
            $acc[$eid] = ['calls_30d' => 0, 'sum_30d' => 0.0, 'daily' => []];
        }

        $cutoff = (new \DateTimeImmutable('today'))->modify('-' . ($dailyDays - 1) . ' days');

        while (($row = $stmt->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $qty = (float) ($row['quantity'] ?? 0);
            if ($qty <= 0) {
                continue;
            }
            $metaRaw = $row['meta_json'] ?? null;
            if (! \is_string($metaRaw) || $metaRaw === '') {
                continue;
            }
            try {
                $meta = json_decode($metaRaw, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            if (! \is_array($meta)) {
                continue;
            }

            $eid = isset($meta['endpoint_id']) ? (int) $meta['endpoint_id'] : 0;
            if ($eid < 1) {
                $ref = trim((string) ($meta['endpoint_ref'] ?? ''));
                if ($ref !== '' && isset($idByName[$ref])) {
                    $eid = $idByName[$ref];
                }
            }
            if ($eid < 1 || ! isset($acc[$eid])) {
                continue;
            }

            $acc[$eid]['calls_30d']++;
            $acc[$eid]['sum_30d'] += $qty;

            $created = isset($row['created_at']) ? (string) $row['created_at'] : '';
            if ($created === '') {
                continue;
            }
            try {
                $day = (new \DateTimeImmutable($created))->format('Y-m-d');
                $dayDt = new \DateTimeImmutable($day);
            } catch (\Exception) {
                continue;
            }
            if ($dayDt < $cutoff) {
                continue;
            }
            if (! isset($acc[$eid]['daily'][$day])) {
                $acc[$eid]['daily'][$day] = ['calls' => 0, 'sum' => 0.0];
            }
            $acc[$eid]['daily'][$day]['calls']++;
            $acc[$eid]['daily'][$day]['sum'] += $qty;
        }

        /** @var array<string, array{endpoint_id: int, calls_30d: int, avg_tokens_30d: float, max_tokens_limit: int|null, overloaded: bool, daily: list<array{date: string, calls: int, avg_tokens: float, total_tokens: float}>}> $out */
        $out = [];
        foreach ($byId as $eid => $ep) {
            $bucket = $acc[$eid];
            $calls = $bucket['calls_30d'];
            $avg = $calls > 0 ? round($bucket['sum_30d'] / $calls, 1) : 0.0;
            $limit = $ep['max_tokens_limit'];
            $warnThreshold = $limit !== null && $limit > 0
                ? (float) $limit * 0.85
                : 16000.0;
            $overloaded = $calls > 0 && $avg >= $warnThreshold;

            /** @var list<array{date: string, calls: int, avg_tokens: float, total_tokens: float}> $daily */
            $daily = [];
            $cursor = $cutoff;
            $today = new \DateTimeImmutable('today');
            while ($cursor <= $today) {
                $day = $cursor->format('Y-m-d');
                $hit = $bucket['daily'][$day] ?? ['calls' => 0, 'sum' => 0.0];
                $dayCalls = (int) $hit['calls'];
                $daily[] = [
                    'date'         => $day,
                    'calls'        => $dayCalls,
                    'avg_tokens'   => $dayCalls > 0 ? round($hit['sum'] / $dayCalls, 1) : 0.0,
                    'total_tokens' => round($hit['sum'], 1),
                ];
                $cursor = $cursor->modify('+1 day');
            }

            $out[(string) $eid] = [
                'endpoint_id'       => $eid,
                'calls_30d'         => $calls,
                'avg_tokens_30d'    => $avg,
                'max_tokens_limit'  => $limit,
                'overloaded'        => $overloaded,
                'daily'             => $daily,
            ];
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $asrData orchestrator ASR response
     */
    public static function recordChatAsr(\PDO $pdo, int $tenantId, array $asrData, ?int $userId = null): void
    {
        if ($tenantId < 1) {
            return;
        }

        $text = trim((string) ($asrData['text'] ?? ''));
        if ($text === '') {
            return;
        }

        self::record($pdo, $tenantId, 'chat.asr', (float) strlen($text), 'chars', [
            'polished'    => ! empty($asrData['polished']),
            'purpose_key' => self::resolvePurposeKey('chat.asr', $asrData),
        ], $userId);
    }

    /**
     * Aggregated usage grouped by purpose for user / tenant admin / platform reports.
     *
     * @return list<array{purpose_key: string, event_kind: string, unit: string|null, event_count: int, quantity_sum: float}>
     */
    public static function aggregateByPurpose(\PDO $pdo, int $tenantId, ?int $userId = null, int $days = 30): array
    {
        if ($tenantId < 1 || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return [];
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);
        $days = max(1, min(365, $days));

        $sql = "SELECT
                    COALESCE(
                        NULLIF(TRIM(purpose_key), ''),
                        NULLIF(TRIM(meta_json::jsonb->>'purpose_key'), ''),
                        event_kind
                    ) AS purpose_key,
                    event_kind,
                    unit,
                    COUNT(*) AS event_count,
                    COALESCE(SUM(quantity), 0) AS quantity_sum
                FROM oaao_usage_event
                WHERE tenant_id = ?
                  AND created_at >= (CURRENT_TIMESTAMP - (? || ' days')::interval)";
        $params = [$tenantId, (string) $days];
        if ($userId !== null && $userId > 0) {
            $sql .= ' AND user_id = ?';
            $params[] = $userId;
        }
        $sql .= ' GROUP BY 1, event_kind, unit ORDER BY purpose_key, event_kind';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        /** @var list<array<string, mixed>> $rows */
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        /** @var list<array{purpose_key: string, event_kind: string, unit: string|null, event_count: int, quantity_sum: float}> $out */
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $out[] = [
                'purpose_key'  => (string) ($row['purpose_key'] ?? ''),
                'event_kind'   => (string) ($row['event_kind'] ?? ''),
                'unit'         => isset($row['unit']) && $row['unit'] !== '' ? (string) $row['unit'] : null,
                'event_count'  => (int) ($row['event_count'] ?? 0),
                'quantity_sum' => (float) ($row['quantity_sum'] ?? 0),
            ];
        }

        return $out;
    }
}
