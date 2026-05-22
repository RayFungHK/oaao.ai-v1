<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Vault retrieval tuning in purpose {@code meta_json.vault_rag} (Settings → RAG).
 * Stored on {@code embedding.*} — the purpose that powers chat vector search — not {@code rag.*} LLM routing.
 */
final class RagPurposeConfig
{
    private const DEFAULT_QDRANT_LIMIT = 6;

    private const DEFAULT_MIN_SCORE = 0.38;

    private const DEFAULT_GRAPH_LIMIT = 12;

    private const DEFAULT_TRANSCRIPT_SUMMARY_BOOST = 0.10;

    private const DEFAULT_ASR_TRANSCRIPT_BOOST = 0.03;

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
     * Normalized retrieval config for orchestrator {@code vault_rag} payload.
     *
     * @param array<string, mixed>|null $meta
     *
     * @return array{qdrant_limit: int, min_score: float, graph_limit: int, transcript_summary_boost: float, asr_transcript_boost: float}
     */
    public static function chatPayloadFromMeta(?array $meta): array
    {
        $root = ($meta !== null && $meta !== []) ? $meta : [];
        $nested = \is_array($root['vault_rag'] ?? null) ? $root['vault_rag'] : $root;

        return [
            'qdrant_limit'             => self::clampInt($nested['qdrant_limit'] ?? $nested['vault_rag_qdrant_limit'] ?? null, 2, 24, self::DEFAULT_QDRANT_LIMIT),
            'min_score'                => self::clampFloat($nested['min_score'] ?? $nested['vault_rag_min_score'] ?? null, 0.0, 1.0, self::DEFAULT_MIN_SCORE),
            'graph_limit'              => self::clampInt($nested['graph_limit'] ?? $nested['vault_rag_graph_limit'] ?? null, 4, 16, self::DEFAULT_GRAPH_LIMIT),
            'transcript_summary_boost' => self::clampFloat($nested['transcript_summary_boost'] ?? null, 0.0, 0.3, self::DEFAULT_TRANSCRIPT_SUMMARY_BOOST),
            'asr_transcript_boost'     => self::clampFloat($nested['asr_transcript_boost'] ?? null, 0.0, 0.2, self::DEFAULT_ASR_TRANSCRIPT_BOOST),
        ];
    }

    /**
     * @return array{qdrant_limit: int, min_score: float, graph_limit: int, transcript_summary_boost: float, asr_transcript_boost: float}
     */
    public static function defaultsForChat(): array
    {
        return self::chatPayloadFromMeta([]);
    }

    /**
     * Merge form values into existing purpose meta (preserves unrelated keys).
     *
     * @param array<string, mixed> $existing
     * @param array<string, mixed> $form
     *
     * @return array<string, mixed>
     */
    public static function mergeRetrievalIntoMeta(array $existing, array $form): array
    {
        $cfg = self::chatPayloadFromMeta($form);
        $existing['vault_rag'] = $cfg;

        return $existing;
    }

    /**
     * @param array<string, mixed> $form
     *
     * @return array<string, mixed>
     */
    public static function metaJsonFromForm(array $form): array
    {
        return ['vault_rag' => self::chatPayloadFromMeta($form)];
    }

    private static function clampInt(mixed $raw, int $min, int $max, int $default): int
    {
        if ($raw === null || $raw === '') {
            return $default;
        }
        if (! \is_int($raw) && ! \is_float($raw) && ! (\is_string($raw) && is_numeric($raw))) {
            return $default;
        }
        $n = (int) round((float) $raw);

        return max($min, min($max, $n));
    }

    private static function clampFloat(mixed $raw, float $min, float $max, float $default): float
    {
        if ($raw === null || $raw === '') {
            return $default;
        }
        if (! \is_int($raw) && ! \is_float($raw) && ! (\is_string($raw) && is_numeric($raw))) {
            return $default;
        }
        $f = (float) $raw;

        return max($min, min($max, round($f, 4)));
    }
}
