<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/AuthSchemaBridge.php';

/**
 * Append-only tenant usage ledger ({@code oaao_usage_event}).
 */
final class UsageEventRepository
{
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
    ): void {
        $eventKind = trim($eventKind);
        if ($tenantId < 1 || $eventKind === '') {
            return;
        }

        if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            return;
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        $metaJson = null;
        if ($meta !== null && $meta !== []) {
            try {
                $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $metaJson = null;
            }
        }

        $pdo->prepare(
            'INSERT INTO oaao_usage_event (tenant_id, event_kind, quantity, unit, meta_json, created_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        )->execute([$tenantId, $eventKind, $quantity, $unit, $metaJson]);
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
            self::record($pdo, $tenantId, 'vault.asr', (float) $chars, 'chars', array_merge($meta, $usage));

            return;
        }

        if ($hookId === 'vh.rag.document_embed') {
            $chunks = (int) ($usage['chunks'] ?? 0);
            self::record($pdo, $tenantId, 'vault.embed', (float) $chunks, 'chunks', array_merge($meta, $usage));

            return;
        }

        if ($hookId === 'vh.rag.graph_index') {
            $entities = (int) ($usage['entities'] ?? 0);
            $edges = (int) ($usage['edges'] ?? 0);
            $units = $entities + $edges;
            if ($units < 1) {
                $units = (int) ($usage['batches'] ?? 0);
            }
            self::record($pdo, $tenantId, 'vault.graph_index', (float) $units, 'units', array_merge($meta, $usage));
        }
    }

    /**
     * @param array<string, mixed> $runMeta orchestrator {@code system/end} metrics
     */
    public static function recordChatCompletion(\PDO $pdo, int $tenantId, array $runMeta): void
    {
        if ($tenantId < 1) {
            return;
        }

        $prompt = (int) ($runMeta['prompt_tokens'] ?? 0);
        $completion = (int) ($runMeta['completion_tokens'] ?? 0);
        if ($prompt < 1 && $completion < 1) {
            $completion = (int) ($runMeta['tokens_out'] ?? 0);
        }
        if ($prompt < 1 && $completion < 1) {
            return;
        }

        $meta = [
            'prompt_tokens'     => $prompt,
            'completion_tokens' => $completion,
            'duration_ms'       => isset($runMeta['duration_ms']) ? (int) $runMeta['duration_ms'] : null,
            'model'             => isset($runMeta['model']) ? (string) $runMeta['model'] : null,
            'endpoint_ref'      => isset($runMeta['endpoint_ref']) ? (string) $runMeta['endpoint_ref'] : null,
            'tokens_estimated'  => ! empty($runMeta['tokens_estimated']),
        ];

        self::record(
            $pdo,
            $tenantId,
            'chat.completion',
            (float) max($completion, 0),
            'tokens',
            array_filter($meta, static fn ($v) => $v !== null && $v !== ''),
        );
    }

    /**
     * @param array<string, mixed> $asrData orchestrator ASR response
     */
    public static function recordChatAsr(\PDO $pdo, int $tenantId, array $asrData): void
    {
        if ($tenantId < 1) {
            return;
        }

        $text = trim((string) ($asrData['text'] ?? ''));
        if ($text === '') {
            return;
        }

        self::record($pdo, $tenantId, 'chat.asr', (float) strlen($text), 'chars', [
            'polished' => ! empty($asrData['polished']),
        ]);
    }
}
