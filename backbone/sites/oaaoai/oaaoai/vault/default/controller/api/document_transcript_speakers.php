<?php

declare(strict_types=1);

use oaaoai\vault\VaultSpeakerProfiles;

require_once dirname(__DIR__, 2) . '/library/VaultSpeakerProfiles.php';

/**
 * POST /vault/api/document_transcript_speakers — rename a speaker in ASR metadata.
 *
 * JSON body: {@code document_id}, {@code speaker_id}, {@code display_name}, optional {@code workspace_id},
 * optional {@code remember_profile} (bool) to enroll/update vault voiceprint profile.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $body */
    $body = [];
    $raw = file_get_contents('php://input');
    if (\is_string($raw) && $raw !== '') {
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($decoded)) {
                $body = $decoded;
            }
        } catch (\JsonException) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);

            return;
        }
    }

    $ctx = $this->oaao_vault_require_pg_api_context($body);
    if ($ctx === null) {
        return;
    }

    $docId = isset($body['document_id']) ? (int) $body['document_id'] : 0;
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    $speakerId = isset($body['speaker_id']) ? (int) $body['speaker_id'] : -1;
    if ($speakerId < 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid speaker_id']);

        return;
    }

    $displayName = isset($body['display_name']) ? trim((string) $body['display_name']) : '';
    if ($displayName === '' || \strlen($displayName) > 80) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'display_name must be 1–80 characters.']);

        return;
    }

    $rememberProfile = ! empty($body['remember_profile']);

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];
    $pdo = $ctx['pdo'];

    /** @var array<string, mixed>|false $doc */
    $doc = $db->prepare()
        ->select('id, vault_id, source_text, meta_json')
        ->from('vault_document')
        ->where('id=:id')
        ->assign(['id' => $docId])
        ->limit(1)
        ->query()
        ->fetch();

    if ($doc === false || ! \is_array($doc)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $vaultId = (int) ($doc['vault_id'] ?? 0);
    if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    /** @var array<string, mixed> $metaRoot */
    $metaRoot = [];
    $rawMeta = $doc['meta_json'] ?? null;
    if (\is_array($rawMeta)) {
        $metaRoot = $rawMeta;
    } elseif (\is_string($rawMeta) && trim($rawMeta) !== '') {
        try {
            $dec = json_decode(trim($rawMeta), true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($dec)) {
                $metaRoot = $dec;
            }
        } catch (\JsonException) {
            $metaRoot = [];
        }
    }

    /** @var array<string, mixed> $asrMeta */
    $asrMeta = \is_array($metaRoot['asr'] ?? null) ? $metaRoot['asr'] : [];
    if (($asrMeta['mode'] ?? '') !== 'speaker') {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'Document is not in speaker transcript mode']);

        return;
    }

    /** @var list<array<string, mixed>> $segments */
    $segments = \is_array($asrMeta['segments'] ?? null) ? $asrMeta['segments'] : [];
    /** @var list<array<string, mixed>> $speakers */
    $speakers = \is_array($asrMeta['speakers'] ?? null) ? $asrMeta['speakers'] : [];

    $foundSpeaker = false;
    /** @var list<float>|null $speakerEmbedding */
    $speakerEmbedding = null;
    $existingProfileId = null;
    foreach ($speakers as &$sp) {
        if (! \is_array($sp)) {
            continue;
        }
        if ((int) ($sp['speaker_id'] ?? -1) === $speakerId) {
            $sp['label'] = $displayName;
            $sp['display_name'] = $displayName;
            $sp['auto_matched'] = false;
            $speakerEmbedding = VaultSpeakerProfiles::parseEmbedding($sp['embedding'] ?? null);
            if (isset($sp['profile_id']) && is_numeric($sp['profile_id'])) {
                $existingProfileId = (int) $sp['profile_id'];
            }
            $foundSpeaker = true;
            break;
        }
    }
    unset($sp);

    if (! $foundSpeaker) {
        $speakers[] = [
            'speaker_id'   => $speakerId,
            'label'        => $displayName,
            'display_name' => $displayName,
            'utterance_count' => 0,
            'total_ms'     => 0,
        ];
    }

    $matchedSegments = 0;
    foreach ($segments as &$seg) {
        if (! \is_array($seg)) {
            continue;
        }
        if ((int) ($seg['speaker_id'] ?? -1) !== $speakerId) {
            continue;
        }
        $seg['speaker_label'] = $displayName;
        ++$matchedSegments;
    }
    unset($seg);

    if ($matchedSegments < 1) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Speaker not found in transcript segments']);

        return;
    }

    $asrMeta['speakers'] = $speakers;
    $asrMeta['segments'] = $segments;
    $metaRoot['asr'] = $asrMeta;

    $profileId = null;
    if ($rememberProfile && $speakerEmbedding !== null) {
        try {
            $profileId = VaultSpeakerProfiles::upsertProfile(
                $pdo,
                $vaultId,
                $displayName,
                $speakerEmbedding,
                $existingProfileId > 0 ? $existingProfileId : null,
                $wid,
                $uid,
            );
            foreach ($speakers as &$sp) {
                if (! \is_array($sp)) {
                    continue;
                }
                if ((int) ($sp['speaker_id'] ?? -1) !== $speakerId) {
                    continue;
                }
                $sp['profile_id'] = $profileId;
                unset($sp['match_confidence'], $sp['auto_matched']);
            }
            unset($sp);
            $asrMeta['speakers'] = $speakers;
            $metaRoot['asr'] = $asrMeta;

            VaultSpeakerProfiles::saveDocumentSpeakerMaps($pdo, $docId, [[
                'speaker_id'       => $speakerId,
                'profile_id'       => $profileId,
                'match_confidence' => null,
            ]]);
        } catch (\Throwable) {
            // Rename still succeeds when enrollment fails.
        }
    }

    $sourceText = VaultSpeakerProfiles::rebuildSpeakerSourceText($segments);

    $ts = date('Y-m-d H:i:s');
    $db->update('vault_document', ['source_text', 'meta_json', 'updated_at'])
        ->where('id=:id')
        ->assign([
            'source_text' => $sourceText,
            'meta_json'   => json_encode($metaRoot, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'updated_at'  => $ts,
            'id'          => $docId,
        ])
        ->query();

    /** @var list<array<string, mixed>> $outSpeakers */
    $outSpeakers = [];
    foreach ($speakers as $sp) {
        if (! \is_array($sp)) {
            continue;
        }
        $sid = (int) ($sp['speaker_id'] ?? 0);
        $outSpeakers[] = [
            'speaker_id'      => max(0, $sid),
            'label'           => trim((string) ($sp['display_name'] ?? $sp['label'] ?? ('Speaker ' . ($sid + 1)))),
            'display_name'    => trim((string) ($sp['display_name'] ?? $sp['label'] ?? ('Speaker ' . ($sid + 1)))),
            'profile_id'      => isset($sp['profile_id']) ? (int) $sp['profile_id'] : null,
            'auto_matched'    => ! empty($sp['auto_matched']),
            'match_confidence'=> isset($sp['match_confidence']) && is_numeric($sp['match_confidence'])
                ? (float) $sp['match_confidence']
                : null,
            'utterance_count' => max(0, (int) ($sp['utterance_count'] ?? 0)),
            'total_ms'        => max(0, (int) ($sp['total_ms'] ?? 0)),
        ];
    }

    /** @var list<array<string, mixed>> $outSegments */
    $outSegments = [];
    foreach ($segments as $seg) {
        if (! \is_array($seg)) {
            continue;
        }
        $text = trim((string) ($seg['text'] ?? ''));
        if ($text === '') {
            continue;
        }
        $sid = (int) ($seg['speaker_id'] ?? 0);
        $outSegments[] = [
            'speaker_id'    => max(0, $sid),
            'speaker_label' => trim((string) ($seg['speaker_label'] ?? ('Speaker ' . ($sid + 1)))),
            'begin_ms'      => max(0, (int) ($seg['begin_ms'] ?? 0)),
            'end_ms'        => max(0, (int) ($seg['end_ms'] ?? 0)),
            'text'          => $text,
        ];
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id'  => $docId,
            'speaker_id'   => $speakerId,
            'display_name' => $displayName,
            'profile_id'   => $profileId,
            'remembered'   => $rememberProfile && $profileId !== null && $profileId > 0,
            'source_text'  => $sourceText,
            'speakers'     => $outSpeakers,
            'segments'     => $outSegments,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
