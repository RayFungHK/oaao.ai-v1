<?php

namespace Module\oaao\library;

use Razy\Agent;
use Razy\Controller;

/**
 * Library — workspace/library gallery shell (CS-2-S1 skeleton).
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
                'GET library_documents_list' => 'library_documents_list',
                'POST library_document_convert' => 'library_document_convert',
            ],
        ]);

        return true;
    }
};
