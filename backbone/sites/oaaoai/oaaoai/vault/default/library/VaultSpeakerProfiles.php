<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * Vault-scoped speaker voiceprint profiles — cosine match + enrollment.
 *
 * Embeddings are L2-normalized float vectors stored as JSON arrays in {@code oaao_vault_speaker_profile.embedding_json}.
 */
final class VaultSpeakerProfiles
{
    public const DEFAULT_MATCH_THRESHOLD = 0.72;

    /**
     * @return list<array{profile_id: int, vault_id: int, display_name: string, embedding: list<float>, sample_count: int}>
     */
    public static function loadProfilesForVault(\PDO $pdo, int $vaultId): array
    {
        if ($vaultId < 1) {
            return [];
        }

        $st = $pdo->prepare(
            'SELECT profile_id, vault_id, display_name, embedding_json, sample_count
             FROM oaao_vault_speaker_profile
             WHERE vault_id = ?
             ORDER BY display_name ASC, profile_id ASC',
        );
        $st->execute([$vaultId]);

        /** @var list<array{profile_id: int, vault_id: int, display_name: string, embedding: list<float>, sample_count: int}> $rows */
        $rows = [];
        while (($raw = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($raw)) {
                continue;
            }
            $emb = self::parseEmbedding($raw['embedding_json'] ?? null);
            if ($emb === null) {
                continue;
            }
            $rows[] = [
                'profile_id'   => (int) ($raw['profile_id'] ?? 0),
                'vault_id'     => (int) ($raw['vault_id'] ?? 0),
                'display_name' => trim((string) ($raw['display_name'] ?? '')),
                'embedding'    => $emb,
                'sample_count' => max(1, (int) ($raw['sample_count'] ?? 1)),
            ];
        }

        return $rows;
    }

    /**
     * @param list<float> $a
     * @param list<float> $b
     */
    public static function cosineSimilarity(array $a, array $b): float
    {
        if ($a === [] || $b === [] || \count($a) !== \count($b)) {
            return 0.0;
        }

        $dot = 0.0;
        $na = 0.0;
        $nb = 0.0;
        $n = \count($a);
        for ($i = 0; $i < $n; ++$i) {
            $dot += $a[$i] * $b[$i];
            $na += $a[$i] * $a[$i];
            $nb += $b[$i] * $b[$i];
        }
        if ($na <= 0.0 || $nb <= 0.0) {
            return 0.0;
        }

        return $dot / (sqrt($na) * sqrt($nb));
    }

    /**
     * @param list<float> $embedding
     *
     * @return array{profile_id: int, display_name: string, confidence: float}|null
     */
    public static function matchEmbedding(
        \PDO $pdo,
        int $vaultId,
        array $embedding,
        float $threshold = self::DEFAULT_MATCH_THRESHOLD,
    ): ?array {
        /** @var array{profile_id: int, display_name: string, confidence: float}|null $best */
        $best = null;
        $bestScore = $threshold;

        foreach (self::loadProfilesForVault($pdo, $vaultId) as $profile) {
            $score = self::cosineSimilarity($embedding, $profile['embedding']);
            if ($score >= $bestScore) {
                $bestScore = $score;
                $best = [
                    'profile_id'   => $profile['profile_id'],
                    'display_name' => $profile['display_name'],
                    'confidence'   => round($score, 4),
                ];
            }
        }

        return $best;
    }

    /**
     * @param list<float> $embedding
     */
    public static function upsertProfile(
        \PDO $pdo,
        int $vaultId,
        string $displayName,
        array $embedding,
        ?int $profileId = null,
        ?int $workspaceId = null,
        ?int $createdBy = null,
    ): int {
        $displayName = trim($displayName);
        if ($displayName === '') {
            throw new \InvalidArgumentException('display_name required');
        }

        $embedding = self::normalizeEmbedding($embedding);
        $embJson = json_encode($embedding, JSON_THROW_ON_ERROR);
        $ts = date('Y-m-d H:i:s');

        if ($profileId !== null && $profileId > 0) {
            $st = $pdo->prepare(
                'SELECT embedding_json, sample_count FROM oaao_vault_speaker_profile WHERE profile_id = ? AND vault_id = ? LIMIT 1',
            );
            $st->execute([$profileId, $vaultId]);
            /** @var array<string, mixed>|false $row */
            $row = $st->fetch(\PDO::FETCH_ASSOC);
            if (\is_array($row)) {
                $prev = self::parseEmbedding($row['embedding_json'] ?? null) ?? $embedding;
                $count = max(1, (int) ($row['sample_count'] ?? 1));
                $merged = self::mergeEmbeddings($prev, $count, $embedding);
                $embJson = json_encode($merged, JSON_THROW_ON_ERROR);
                $up = $pdo->prepare(
                    'UPDATE oaao_vault_speaker_profile
                     SET display_name = ?, embedding_json = ?, sample_count = sample_count + 1, updated_at = ?
                     WHERE profile_id = ? AND vault_id = ?',
                );
                $up->execute([$displayName, $embJson, $ts, $profileId, $vaultId]);

                return $profileId;
            }
        }

        $ins = $pdo->prepare(
            'INSERT INTO oaao_vault_speaker_profile
                (vault_id, workspace_id, display_name, embedding_json, sample_count, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)
             RETURNING profile_id',
        );
        $ins->execute([
            $vaultId,
            $workspaceId,
            $displayName,
            $embJson,
            $createdBy,
            $ts,
            $ts,
        ]);
        $newId = (int) $ins->fetchColumn();

        return $newId > 0 ? $newId : 0;
    }

    /**
     * @param list<array{speaker_id: int, embedding: list<float>}> $speakerEmbeddings
     *
     * @return list<array{speaker_id: int, profile_id: int, display_name: string, confidence: float}>
     */
    public static function matchSpeakersForDocument(
        \PDO $pdo,
        int $vaultId,
        array $speakerEmbeddings,
        bool $pseudoDiarization = false,
    ): array {
        // Pseudo diarization assigns speaker_id by sentence rotation — not distinct voices.
        if ($pseudoDiarization) {
            return [];
        }

        $threshold = self::DEFAULT_MATCH_THRESHOLD;
        /** @var list<array{speaker_id: int, profile_id: int, display_name: string, confidence: float}> $matches */
        $matches = [];
        /** @var array<int, true> $usedProfileIds */
        $usedProfileIds = [];

        foreach ($speakerEmbeddings as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $sid = (int) ($row['speaker_id'] ?? -1);
            $emb = $row['embedding'] ?? null;
            if ($sid < 0 || ! \is_array($emb)) {
                continue;
            }
            $norm = self::normalizeEmbedding($emb);
            $hit = self::matchEmbedding($pdo, $vaultId, $norm, $threshold);
            if ($hit === null) {
                continue;
            }
            $pid = (int) $hit['profile_id'];
            if (isset($usedProfileIds[$pid])) {
                continue;
            }
            $usedProfileIds[$pid] = true;
            $matches[] = [
                'speaker_id'   => $sid,
                'profile_id'   => $pid,
                'display_name' => $hit['display_name'],
                'confidence'   => $hit['confidence'],
            ];
        }

        return $matches;
    }

    /**
     * @param array<string, mixed> $asrMeta
     * @param list<array{speaker_id: int, profile_id: int, display_name: string, confidence: float}> $matches
     *
     * @return array<string, mixed>
     */
    public static function applyMatchesToAsrMeta(array $asrMeta, array $matches): array
    {
        if ($matches === []) {
            return $asrMeta;
        }

        /** @var array<int, array{profile_id: int, display_name: string, confidence: float}> $bySpeaker */
        $bySpeaker = [];
        foreach ($matches as $m) {
            $bySpeaker[(int) $m['speaker_id']] = [
                'profile_id'   => (int) $m['profile_id'],
                'display_name' => (string) $m['display_name'],
                'confidence'   => (float) $m['confidence'],
            ];
        }

        /** @var list<array<string, mixed>> $speakers */
        $speakers = \is_array($asrMeta['speakers'] ?? null) ? $asrMeta['speakers'] : [];
        foreach ($speakers as &$sp) {
            if (! \is_array($sp)) {
                continue;
            }
            $sid = (int) ($sp['speaker_id'] ?? -1);
            if (! isset($bySpeaker[$sid])) {
                continue;
            }
            $hit = $bySpeaker[$sid];
            $sp['label'] = $hit['display_name'];
            $sp['display_name'] = $hit['display_name'];
            $sp['profile_id'] = $hit['profile_id'];
            $sp['match_confidence'] = $hit['confidence'];
            $sp['auto_matched'] = true;
        }
        unset($sp);
        $asrMeta['speakers'] = $speakers;

        /** @var list<array<string, mixed>> $segments */
        $segments = \is_array($asrMeta['segments'] ?? null) ? $asrMeta['segments'] : [];
        foreach ($segments as &$seg) {
            if (! \is_array($seg)) {
                continue;
            }
            $sid = (int) ($seg['speaker_id'] ?? -1);
            if (! isset($bySpeaker[$sid])) {
                continue;
            }
            $seg['speaker_label'] = $bySpeaker[$sid]['display_name'];
        }
        unset($seg);
        $asrMeta['segments'] = $segments;
        $asrMeta['speaker_profiles_matched'] = \count($matches);

        return $asrMeta;
    }

    /**
     * @param list<array{speaker_id: int, profile_id: int|null, match_confidence: float|null}> $maps
     */
    public static function saveDocumentSpeakerMaps(\PDO $pdo, int $documentId, array $maps): void
    {
        if ($documentId < 1 || $maps === []) {
            return;
        }

        $del = $pdo->prepare('DELETE FROM oaao_vault_document_speaker_map WHERE document_id = ?');
        $del->execute([$documentId]);

        $ins = $pdo->prepare(
            'INSERT INTO oaao_vault_document_speaker_map (document_id, speaker_id, profile_id, match_confidence)
             VALUES (?, ?, ?, ?)',
        );
        foreach ($maps as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $sid = (int) ($row['speaker_id'] ?? -1);
            if ($sid < 0) {
                continue;
            }
            $pid = isset($row['profile_id']) ? (int) $row['profile_id'] : null;
            $conf = isset($row['match_confidence']) && is_numeric($row['match_confidence'])
                ? (float) $row['match_confidence']
                : null;
            $ins->execute([$documentId, $sid, $pid > 0 ? $pid : null, $conf]);
        }
    }

    /**
     * @param list<array<string, mixed>> $segments
     */
    public static function rebuildSpeakerSourceText(array $segments): string
    {
        $lines = [];
        foreach ($segments as $seg) {
            if (! \is_array($seg)) {
                continue;
            }
            $text = trim((string) ($seg['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $beginMs = max(0, (int) ($seg['begin_ms'] ?? 0));
            $label = trim((string) ($seg['speaker_label'] ?? 'Speaker'));
            $lines[] = sprintf('[%s] %s: %s', self::formatTimestampHms($beginMs), $label, $text);
        }

        return implode("\n", $lines);
    }

    public static function formatTimestampHms(int $ms): string
    {
        $totalSec = max(0, (int) floor($ms / 1000));
        $h = (int) floor($totalSec / 3600);
        $m = (int) floor(($totalSec % 3600) / 60);
        $s = $totalSec % 60;

        return sprintf('%02d:%02d:%02d', $h, $m, $s);
    }

    /**
     * @return list<float>|null
     */
    public static function parseEmbedding(mixed $raw): ?array
    {
        if (\is_string($raw) && trim($raw) !== '') {
            try {
                $dec = json_decode(trim($raw), true, 512, JSON_THROW_ON_ERROR);
                $raw = $dec;
            } catch (\JsonException) {
                return null;
            }
        }
        if (! \is_array($raw)) {
            return null;
        }
        /** @var list<float> $out */
        $out = [];
        foreach ($raw as $v) {
            if (! is_numeric($v)) {
                return null;
            }
            $out[] = (float) $v;
        }

        return $out !== [] ? self::normalizeEmbedding($out) : null;
    }

    /**
     * @param list<float> $embedding
     *
     * @return list<float>
     */
    public static function normalizeEmbedding(array $embedding): array
    {
        $sum = 0.0;
        foreach ($embedding as $v) {
            $sum += $v * $v;
        }
        if ($sum <= 0.0) {
            return $embedding;
        }
        $inv = 1.0 / sqrt($sum);
        $out = [];
        foreach ($embedding as $v) {
            $out[] = $v * $inv;
        }

        return $out;
    }

    /**
     * Running average of two normalized embeddings, re-normalized.
     *
     * @param list<float> $prev
     * @param list<float> $next
     *
     * @return list<float>
     */
    public static function mergeEmbeddings(array $prev, int $prevCount, array $next): array
    {
        if (\count($prev) !== \count($next)) {
            return self::normalizeEmbedding($next);
        }
        $total = max(1, $prevCount) + 1;
        $merged = [];
        $n = \count($prev);
        for ($i = 0; $i < $n; ++$i) {
            $merged[] = (($prev[$i] * max(1, $prevCount)) + $next[$i]) / $total;
        }

        return self::normalizeEmbedding($merged);
    }
}
