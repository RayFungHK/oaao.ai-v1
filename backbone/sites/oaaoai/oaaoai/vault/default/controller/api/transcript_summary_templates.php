<?php

declare(strict_types=1);

use oaaoai\vault\VaultTranscriptSummaryLanguages;
use oaaoai\vault\VaultTranscriptSummaryTemplates;

require_once dirname(__DIR__, 2) . '/library/VaultTranscriptSummaryTemplates.php';
require_once dirname(__DIR__, 2) . '/library/VaultTranscriptSummaryLanguages.php';

/**
 * GET /vault/api/transcript_summary_templates — list HiNote-style summary prompt templates.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: private, max-age=60');

    try {
        $ctx = $this->oaao_vault_require_pg_api_context(null);
        if ($ctx === null) {
            return;
        }

        $summaryConfigured = false;
        try {
            $summaryConfigured = $this->oaao_vault_resolve_asr_summary_configured($ctx['db']);
        } catch (\Throwable) {
            $summaryConfigured = false;
        }

        echo json_encode([
            'success' => true,
            'data'    => [
                'summary_configured'  => $summaryConfigured,
                'templates'           => VaultTranscriptSummaryTemplates::listTemplatesForApi(),
                'summary_languages'   => VaultTranscriptSummaryLanguages::listForApi(),
                'default_template_id' => VaultTranscriptSummaryTemplates::defaultTemplateId(),
                'templates_dir'       => VaultTranscriptSummaryTemplates::templatesDir(),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\Throwable) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Failed to load summary templates',
        ], JSON_UNESCAPED_UNICODE);
    }
};
