<?php

declare(strict_types=1);

use oaaoai\vault\VaultTranscriptSummaryLanguages;
use oaaoai\vault\VaultTranscriptSummaryTemplates;

require_once __DIR__ . '/_vault_hook_jobs.php';
require_once dirname(__DIR__, 2) . '/library/VaultTranscriptSummaryTemplates.php';
require_once dirname(__DIR__, 2) . '/library/VaultTranscriptSummaryLanguages.php';

/**
 * GET /vault/api/document_transcript — ASR transcript payload for vault detail UI.
 *
 * Query: {@code document_id} (required), optional {@code workspace_id}.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $query */
    $query = [];
    if (isset($_GET['workspace_id']) && (is_string($_GET['workspace_id']) || is_numeric($_GET['workspace_id']))) {
        $query['workspace_id'] = $_GET['workspace_id'];
    }

    $ctx = $this->oaao_vault_require_pg_api_context($query);
    if ($ctx === null) {
        return;
    }

    $docId = isset($_GET['document_id']) ? (int) $_GET['document_id'] : 0;
    if ($docId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid document_id']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    /** @var array<string, mixed>|false $doc */
    $doc = $db->prepare()
        ->select('id, vault_id, file_name, mime_type, byte_size, storage_path, source_text, meta_json, embed_status')
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

    $fileName = (string) ($doc['file_name'] ?? '');
    $mime = oaao_vault_normalize_upload_mime((string) ($doc['mime_type'] ?? ''), $fileName);
    $sourceText = isset($doc['source_text']) ? trim((string) $doc['source_text']) : '';
    $relPath = isset($doc['storage_path']) ? trim((string) $doc['storage_path']) : '';
    $hasMedia = $relPath !== '' && oaao_vault_is_audio_upload($mime, $fileName);

    if ($sourceText === '') {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'message' => 'Transcript not available yet',
            'data'    => [
                'document_id'  => $docId,
                'embed_status' => (string) ($doc['embed_status'] ?? ''),
                'has_media'    => $hasMedia,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

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
    $mode = isset($asrMeta['mode']) ? trim((string) $asrMeta['mode']) : 'normal';
    if ($mode === '') {
        $mode = 'normal';
    }

    /** @var list<array<string, mixed>> $segments */
    $segments = [];
    if (isset($asrMeta['segments']) && \is_array($asrMeta['segments'])) {
        foreach ($asrMeta['segments'] as $seg) {
            if (! \is_array($seg)) {
                continue;
            }
            $text = trim((string) ($seg['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $sid = isset($seg['speaker_id']) ? (int) $seg['speaker_id'] : 0;
            $segments[] = [
                'speaker_id'    => max(0, $sid),
                'speaker_label' => trim((string) ($seg['speaker_label'] ?? ('Speaker ' . ($sid + 1)))),
                'begin_ms'      => max(0, (int) ($seg['begin_ms'] ?? 0)),
                'end_ms'        => max(0, (int) ($seg['end_ms'] ?? 0)),
                'text'          => $text,
            ];
        }
    }

    /** @var list<array<string, mixed>> $speakers */
    $speakers = [];
    if (isset($asrMeta['speakers']) && \is_array($asrMeta['speakers'])) {
        foreach ($asrMeta['speakers'] as $sp) {
            if (! \is_array($sp)) {
                continue;
            }
            $sid = isset($sp['speaker_id']) ? (int) $sp['speaker_id'] : 0;
            $label = trim((string) ($sp['display_name'] ?? $sp['label'] ?? ('Speaker ' . ($sid + 1))));
            $speakers[] = [
                'speaker_id'       => max(0, $sid),
                'label'            => $label,
                'display_name'     => $label,
                'profile_id'       => isset($sp['profile_id']) ? (int) $sp['profile_id'] : null,
                'auto_matched'     => ! empty($sp['auto_matched']),
                'match_confidence' => isset($sp['match_confidence']) && is_numeric($sp['match_confidence'])
                    ? (float) $sp['match_confidence']
                    : null,
                'utterance_count'  => max(0, (int) ($sp['utterance_count'] ?? 0)),
                'total_ms'         => max(0, (int) ($sp['total_ms'] ?? 0)),
            ];
        }
    }

    $mediaQs = 'document_id=' . $docId;
    if ($wid !== null && $wid > 0) {
        $mediaQs .= '&workspace_id=' . $wid;
    }

    /** @var array<string, mixed>|null $summaryMeta */
    $summaryMeta = null;
    if (\is_array($metaRoot['transcript_summary'] ?? null)) {
        $sm = $metaRoot['transcript_summary'];
        $summaryText = trim((string) ($sm['text'] ?? ''));
        $status = trim((string) ($sm['status'] ?? ''));
        if ($status === '' && $summaryText !== '') {
            $status = 'completed';
        }
        if ($status !== '' || $summaryText !== '') {
            $summaryMeta = [
                'status'           => $status,
                'template_id'      => trim((string) ($sm['template_id'] ?? '')),
                'template_label'   => trim((string) ($sm['template_label'] ?? '')),
                'template_emoji'   => trim((string) ($sm['template_emoji'] ?? '')),
                'summary_language' => VaultTranscriptSummaryLanguages::normalize(
                    (string) ($sm['summary_language'] ?? ''),
                ),
                'text'             => $summaryText,
                'generated_at'     => isset($sm['generated_at']) ? (string) $sm['generated_at'] : null,
                'queued_at'        => isset($sm['queued_at']) ? (string) $sm['queued_at'] : null,
                'embed_to_rag'     => ! empty($sm['embed_to_rag']),
                'embed_queued_at'  => isset($sm['embed_queued_at']) ? (string) $sm['embed_queued_at'] : null,
                'error'            => isset($sm['error']) ? trim((string) $sm['error']) : null,
            ];
        }
    }

    $summaryConfigured = $this->oaao_vault_resolve_asr_summary_configured($db);

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id'  => $docId,
            'vault_id'     => $vaultId,
            'file_name'    => $fileName,
            'mime_type'    => $mime,
            'mode'         => $mode,
            'source_text'  => $sourceText,
            'segments'     => $segments,
            'speakers'     => $speakers,
            'duration_sec' => isset($asrMeta['duration_sec']) && is_numeric($asrMeta['duration_sec'])
                ? (float) $asrMeta['duration_sec']
                : null,
            'speaker_count'=> isset($asrMeta['speaker_count']) ? (int) $asrMeta['speaker_count'] : \count($speakers),
            'pseudo_diarization' => ! empty($asrMeta['pseudo_diarization']),
            'timestamp_source'   => ! empty($asrMeta['pseudo_diarization']) ? 'pseudo' : 'asr',
            'speaker_profiles_matched' => isset($asrMeta['speaker_profiles_matched'])
                ? (int) $asrMeta['speaker_profiles_matched']
                : 0,
            'voiceprint_dim' => isset($asrMeta['voiceprint_dim']) && is_numeric($asrMeta['voiceprint_dim'])
                ? (int) $asrMeta['voiceprint_dim']
                : null,
            'has_media'    => $hasMedia,
            'media_url'    => $hasMedia ? ('document_media?' . $mediaQs) : null,
            'summary'             => $summaryMeta,
            'summary_configured'  => $summaryConfigured,
            'summary_templates'   => VaultTranscriptSummaryTemplates::listTemplatesForApi(),
            'summary_languages'   => VaultTranscriptSummaryLanguages::listForApi(),
            'default_template_id' => VaultTranscriptSummaryTemplates::defaultTemplateId(),
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
