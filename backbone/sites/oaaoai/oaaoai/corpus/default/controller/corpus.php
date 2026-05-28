<?php

namespace Module\oaao\corpus;

use Razy\Agent;
use Razy\Controller;

/**
 * Corpus Studio — workspace/corpus gallery (EPIC-CS-1).
 */
return new class extends Controller {
    /**
     * @param array<string, mixed>|null $data
     */
    private function oaao_corpus_json_exit(int $httpStatus, bool $success, string $message = '', ?array $data = null): never
    {
        http_response_code($httpStatus);
        header('Content-Type: application/json; charset=UTF-8');
        $payload = ['success' => $success];
        if ($message !== '') {
            $payload['message'] = $message;
        }
        if ($data !== null) {
            $payload['data'] = $data;
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    public function __onInit(Agent $agent): bool
    {
        require_once dirname(__DIR__, 3) . '/chat/default/library/PlannerAgentRegister.php';
        \oaaoai\chat\PlannerAgentRegister::add(
            'office_generate',
            'Office export',
            'Generate PDF from Corpus HTML template',
            [
                'sort'         => 45,
                'module_code'  => 'oaaoai/corpus',
                'planner_hint' => 'Use when the user wants a downloadable PDF/document from an active Corpus profile '
                    . '(source=corpus_template, format=pdf). Requires corpus_id on the chat run. '
                    . 'Do not use for markdown-only replies — use llm_stream for prose.',
            ],
        );

        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/corpus',
                'Corpus',
                'Style profiles from uploads or Vault sources',
                'book-marked',
                [
                    'shell_panel_url' => '/corpus/workspace-panel',
                    'shell_js_module' => '/webassets/corpus/default/js/corpus-panel.js',
                ],
            );
        }

        $agent->addRoute('GET /corpus/workspace-panel', 'panel/workspace_panel');

        $agent->addLazyRoute([
            'api' => [
                'GET corpus_profiles_list'   => 'corpus_profiles_list',
                'GET corpus_sources_list'    => 'corpus_sources_list',
                'POST corpus_profile_save'   => 'corpus_profile_save',
                'POST corpus_profile_delete' => 'corpus_profile_delete',
                'POST corpus_source_upload'  => 'corpus_source_upload',
                'POST corpus_source_vault_ref' => 'corpus_source_vault_ref',
                'POST corpus_source_delete'  => 'corpus_source_delete',
                'POST corpus_profile_analyze_enqueue' => 'corpus_profile_analyze_enqueue',
                'GET corpus_profile_status'         => 'corpus_profile_status',
                'GET corpus_job_poll'               => 'corpus_job_poll',
                'POST corpus_profile_generate'      => 'corpus_profile_generate',
                'POST corpus_profile_render'        => 'corpus_profile_render',
            ],
        ]);

        return true;
    }
};
