<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\vault\VaultTranscriptSummaryLanguages;
use oaaoai\vault\VaultTranscriptSummaryTemplates;

/**
 * POST /vault/api/document_transcript_summary — generate or refresh AI summary for a transcript.
 *
 * JSON body: {@code document_id}, {@code template_id} (optional), optional {@code workspace_id},
 * optional {@code regenerate} (bool), optional {@code summary_language}, optional {@code embed_to_rag} (bool).
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
    if (\is_string($raw) && trim($raw) !== '') {
        try {
            $dec = json_decode(trim($raw), true, 512, JSON_THROW_ON_ERROR);
            if (\is_array($dec)) {
                $body = $dec;
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

    $regenerate = ! empty($body['regenerate']);
    $embedToRag = ! empty($body['embed_to_rag']);
    $summaryLanguage = VaultTranscriptSummaryLanguages::normalize(
        isset($body['summary_language']) ? (string) $body['summary_language'] : '',
    );
    $templateId = isset($body['template_id']) ? VaultTranscriptSummaryTemplates::normalizeId((string) $body['template_id']) : '';
    if ($templateId === '') {
        $templateId = VaultTranscriptSummaryTemplates::defaultTemplateId();
    }

    $template = VaultTranscriptSummaryTemplates::loadTemplate($templateId);
    if ($template === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Unknown summary template']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    /** @var array<string, mixed>|false $doc */
    $doc = $db->prepare()
        ->select('id, vault_id, file_name, source_text, meta_json')
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

    /** @var array<string, mixed> $existingSummary */
    $existingSummary = \is_array($metaRoot['transcript_summary'] ?? null) ? $metaRoot['transcript_summary'] : [];
    $existingLang = VaultTranscriptSummaryLanguages::normalize((string) ($existingSummary['summary_language'] ?? ''));
    $existingStatus = trim((string) ($existingSummary['status'] ?? ''));
    if (! $regenerate && isset($existingSummary['text'], $existingSummary['template_id'])
        && trim((string) $existingSummary['text']) !== ''
        && (string) $existingSummary['template_id'] === $template['id']
        && $existingLang === $summaryLanguage
        && ! \in_array($existingStatus, ['queued', 'generating'], true)) {
        echo json_encode([
            'success' => true,
            'data'    => [
                'document_id'  => $docId,
                'summary'      => $existingSummary,
                'cached'       => true,
                'embed_queued' => false,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $sourceText = trim((string) ($doc['source_text'] ?? ''));
    if ($sourceText === '') {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'Transcript not available yet']);

        return;
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
    $bind = $repo->resolveAsrSummaryBinding();
    if ($bind === null) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Configure ASR Summary purpose allocation (Settings → Purpose → asr_summary)',
        ]);

        return;
    }

    $jobId = $this->oaao_vault_enqueue_transcript_summary_job(
        $db,
        $docId,
        $vaultId,
        $wid,
        $template,
        $summaryLanguage,
        $embedToRag,
        $sourceText,
        trim((string) ($doc['file_name'] ?? '')),
        $bind,
    );

    if ($jobId < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Could not queue summary job']);

        return;
    }

    /** @var array<string, mixed> $summaryMeta */
    $summaryMeta = [
        'status'           => 'queued',
        'template_id'      => $template['id'],
        'template_label'   => $template['label'],
        'template_emoji'   => $template['emoji'],
        'summary_language' => $summaryLanguage,
        'embed_to_rag'     => $embedToRag,
        'text'             => '',
        'queued_at'        => date('Y-m-d H:i:s'),
        'job_id'           => $jobId,
    ];

    echo json_encode([
        'success' => true,
        'data'    => [
            'document_id'  => $docId,
            'summary'      => $summaryMeta,
            'queued'       => true,
            'job_id'       => $jobId,
            'cached'       => false,
            'embed_queued' => false,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
