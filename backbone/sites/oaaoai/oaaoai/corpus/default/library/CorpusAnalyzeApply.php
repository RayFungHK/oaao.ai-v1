<?php

declare(strict_types=1);

namespace oaaoai\corpus;

/**
 * Persist orchestrator analyze results into corpus tables.
 */
final class CorpusAnalyzeApply
{
    /**
     * @param array<string, mixed> $resp
     */
    public static function fromOrchestratorResponse(CorpusRepository $repo, int $corpusId, array $resp): void
    {
        $segmentsIn = isset($resp['segments']) && \is_array($resp['segments']) ? $resp['segments'] : [];
        /** @var list<array{text: string, classify_json?: string|null, source_id?: int|null, ordinal: int}> $segments */
        $segments = [];
        $ord = 0;
        foreach ($segmentsIn as $seg) {
            if (! \is_array($seg)) {
                continue;
            }
            $text = trim((string) ($seg['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $classify = null;
            if (isset($seg['classify_json'])) {
                if (\is_array($seg['classify_json'])) {
                    try {
                        $classify = json_encode($seg['classify_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                    } catch (\JsonException) {
                        $classify = null;
                    }
                } elseif (\is_string($seg['classify_json']) && $seg['classify_json'] !== '') {
                    $classify = $seg['classify_json'];
                }
            }
            $segments[] = [
                'text'          => $text,
                'classify_json' => $classify,
                'source_id'     => isset($seg['source_id']) ? (int) $seg['source_id'] : null,
                'ordinal'       => $ord++,
            ];
            if ($ord >= CorpusAnalyzePayload::SEGMENT_CAP) {
                break;
            }
        }

        $failed = ! empty($resp['error']) || (isset($resp['ok']) && $resp['ok'] === false);
        if (! $failed && $segments === []) {
            $failed = true;
            $resp['error'] = (string) ($resp['error'] ?? $resp['detail'] ?? 'no_extractable_text');
        }

        $repo->replaceSegments($corpusId, $segments);

        if (isset($resp['source_structure']) && \is_array($resp['source_structure'])) {
            self::applySourceStructure($repo, $corpusId, $resp['source_structure']);
        }

        $styleJson = null;
        if (isset($resp['style_json'])) {
            if (\is_array($resp['style_json'])) {
                try {
                    $styleJson = json_encode($resp['style_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $styleJson = null;
                }
            } elseif (\is_string($resp['style_json']) && $resp['style_json'] !== '') {
                $styleJson = $resp['style_json'];
            }
        }

        $errorMessage = null;
        if ($failed) {
            $code = trim((string) ($resp['error'] ?? 'analyze_failed'));
            $detail = trim((string) ($resp['detail'] ?? ''));
            $errorMessage = $detail !== '' && ! str_contains($code, $detail)
                ? $code . ': ' . $detail
                : ($code !== '' ? $code : ($detail !== '' ? $detail : 'analyze_failed'));
        }

        $repo->patchProfileAnalyze($corpusId, [
            'status'        => $failed ? 'error' : 'ready',
            'error_message' => $errorMessage,
            'style_json'    => $styleJson,
            'updated_at'    => gmdate('Y-m-d H:i:s'),
        ]);
    }

    /**
     * @param list<mixed> $rows
     */
    public static function applySourceStructure(CorpusRepository $repo, int $corpusId, array $rows): void
    {
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $sourceId = (int) ($row['source_id'] ?? 0);
            if ($sourceId < 1) {
                continue;
            }
            $src = $repo->getSourceForCorpus($sourceId, $corpusId);
            if ($src === null) {
                continue;
            }
            $locator = null;
            if (isset($src['locator_json']) && \is_string($src['locator_json']) && $src['locator_json'] !== '') {
                try {
                    $locator = json_decode($src['locator_json'], true, 64, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $locator = null;
                }
            }
            if (! \is_array($locator)) {
                $locator = [];
            }
            $locator['structure_analysis'] = [
                'similarity'    => $row['similarity'] ?? null,
                'outlier'       => ! empty($row['outlier']),
                'reason'        => isset($row['reason']) ? (string) $row['reason'] : '',
                'segment_count' => (int) ($row['segment_count'] ?? 0),
            ];
            try {
                $encoded = json_encode($locator, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            $repo->updateSourceLocator($sourceId, $corpusId, $encoded);
        }
    }
}
