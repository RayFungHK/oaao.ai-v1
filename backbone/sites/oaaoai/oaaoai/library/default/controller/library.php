<?php

namespace Module\oaao\library;

use Razy\Agent;
use Razy\Controller;

/**
 * Library — workspace/library split shell (CS-2-S4 list + block editor).
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/library',
                'Library',
                'Documents with blocks + markdown mirror',
                'file-text',
                [
                    'shell_panel_url' => '/library/workspace-panel',
                    'shell_js_module' => '/webassets/library/default/js/library-panel.js',
                ],
            );
        }

        $agent->addRoute('GET /library/workspace-panel', 'panel/workspace_panel');
        $agent->addLazyRoute([
            'api' => [
                'GET library_documents_list'     => 'library_documents_list',
                'GET library_documents_search'   => 'library_documents_search',
                'GET library_document_get'       => 'library_document_get',
                'POST library_document_create'   => 'library_document_create',
                'POST library_revision_save'     => 'library_revision_save',
                'POST library_document_convert'  => 'library_document_convert',
                'POST library_document_embed'    => 'library_document_embed',
                'POST library_finalize_to_vault'   => 'library_finalize_to_vault',
            ],
        ]);

        return true;
    }
};
