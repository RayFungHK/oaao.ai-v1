<?php

declare(strict_types=1);

use oaaoai\vault\VaultSpeakerProfiles;

/**
 * POST /vault/api/vault_speaker_match — orchestrator voiceprint match + auto-rename ({@code X-OAAO-Internal-Token}).
 *
 * JSON body: {@code document_id}, {@code vault_id}, {@code speakers} (list of {@code speaker_id}, {@code embedding}),
 * optional {@code pseudo_diarization} (bool), optional {@code asr} (speaker-mode meta fragment — used before job finish).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (! $this->oaao_vault_internal_token_ok()) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $ctx = $this->oaao_vault_sidecar_pg_context();
    if ($ctx === null) {
        return;
    }
    $pdo = $ctx['pdo'];

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && trim($raw) !== '') {
        $dec = json_decode($raw, true);
        if (\is_array($dec)) {
            $body = $dec;
        }
    }

    $docId = isset($body['document_id']) ? (int) $body['document_id'] : 0;
    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($docId < 1 || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id and vault_id required']);

        return;
    }

    /** @var list<array<string, mixed>> $speakerEmbeddings */
    $speakerEmbeddings = [];
    if (isset($body['speakers']) && \is_array($body['speakers'])) {
        foreach ($body['speakers'] as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $sid = (int) ($row['speaker_id'] ?? -1);
            $emb = VaultSpeakerProfiles::parseEmbedding($row['embedding'] ?? null);
            if ($sid < 0 || $emb === null) {
                continue;
            }
            $speakerEmbeddings[] = [
                'speaker_id' => $sid,
                'embedding'  => $emb,
            ];
        }
    }

    if ($speakerEmbeddings === []) {
        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id' => $docId,
                'vault_id'    => $vaultId,
                'matches'     => [],
                'applied'     => false,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $pseudo = ! empty($body['pseudo_diarization']);

    /** @var array<string, mixed> $asrMeta */
    $asrMeta = [];
    if (isset($body['asr']) && \is_array($body['asr'])) {
        $asrMeta = $body['asr'];
    } else {
        $st = $pdo->prepare('SELECT meta_json FROM oaao_vault_document WHERE id = ? AND vault_id = ? LIMIT 1');
        $st->execute([$docId, $vaultId]);
        /** @var array<string, mixed>|false $docRow */
        $docRow = $st->fetch(\PDO::FETCH_ASSOC);
        if ($docRow === false) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Document not found']);

            return;
        }
        $rawMeta = $docRow['meta_json'] ?? null;
        if (\is_string($rawMeta) && trim($rawMeta) !== '') {
            try {
                $dec = json_decode(trim($rawMeta), true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($dec) && \is_array($dec['asr'] ?? null)) {
                    $asrMeta = $dec['asr'];
                }
            } catch (\JsonException) {
                $asrMeta = [];
            }
        }
    }

    if (($asrMeta['mode'] ?? '') !== 'speaker') {
        $asrMeta['mode'] = 'speaker';
    }

    $matches = VaultSpeakerProfiles::matchSpeakersForDocument($pdo, $vaultId, $speakerEmbeddings, $pseudo);
    $applied = false;
    $sourceText = null;

    if ($pseudo) {
        $matches = [];
    }

    if ($matches !== []) {
        $asrMeta = VaultSpeakerProfiles::applyMatchesToAsrMeta($asrMeta, $matches);
        $sourceText = VaultSpeakerProfiles::rebuildSpeakerSourceText(
            \is_array($asrMeta['segments'] ?? null) ? $asrMeta['segments'] : [],
        );

        /** @var list<array{speaker_id: int, profile_id: int|null, match_confidence: float|null}> $maps */
        $maps = [];
        foreach ($matches as $m) {
            $maps[] = [
                'speaker_id'       => (int) $m['speaker_id'],
                'profile_id'       => (int) $m['profile_id'],
                'match_confidence' => (float) $m['confidence'],
            ];
        }
        VaultSpeakerProfiles::saveDocumentSpeakerMaps($pdo, $docId, $maps);
        $applied = true;
    }

    // Persist speaker embeddings on the ASR meta for later manual enrollment.
    /** @var array<int, list<float>> $embBySpeaker */
    $embBySpeaker = [];
    foreach ($speakerEmbeddings as $row) {
        $embBySpeaker[(int) $row['speaker_id']] = $row['embedding'];
    }
    /** @var list<array<string, mixed>> $speakers */
    $speakers = \is_array($asrMeta['speakers'] ?? null) ? $asrMeta['speakers'] : [];
    foreach ($speakers as &$sp) {
        if (! \is_array($sp)) {
            continue;
        }
        $sid = (int) ($sp['speaker_id'] ?? -1);
        if ($sid < 0 || ! isset($embBySpeaker[$sid])) {
            continue;
        }
        $sp['embedding'] = $embBySpeaker[$sid];
    }
    unset($sp);
    $asrMeta['speakers'] = $speakers;
    $asrMeta['voiceprint_dim'] = isset($speakerEmbeddings[0]['embedding'])
        ? \count($speakerEmbeddings[0]['embedding'])
        : null;

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id'  => $docId,
            'vault_id'     => $vaultId,
            'matches'      => $matches,
            'applied'      => $applied,
            'source_text'  => $sourceText,
            'asr'          => $asrMeta,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
