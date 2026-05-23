<?php

namespace Module\oaao\rag;

use Razy\Agent;
use Razy\Controller;

/**
 * Retrieval stack — owns {@code pa-rag}, vault-adjacent purpose slots ({@code pa-rerank}, {@code pa-vault}, {@code pa-graph}), and file ingest {@code vault_document_hook} rows ({@code vh.rag.*}, {@code vh.vault.*}).
 *
 * Vault **shell** surfaces only embedding-related hooks in the sidebar; rerank/summary remain in the global registry for Settings and orchestrator contracts.
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        return true;
    }

    public function __onReady(): void
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $ragJs = '/webassets/core/default/js/oaao-rag-settings-panel.js';
            $coreApi->registerSettingsSection(
                'settings-rag',
                'RAG',
                'Retrieval tuning',
                'Qdrant top-K, minimum similarity score, GraphRAG limits, and ASR transcript boosts — stored on your embedding purpose (vector search).',
                'book-open',
                [
                    'sort'            => 27,
                    'panel_js_module' => $ragJs,
                    'label_key'       => 'settings.nav.rag.label',
                    'title_key'       => 'settings.nav.rag.title',
                    'sub_key'         => 'settings.nav.rag.sub',
                ],
            );
        }
    }
};
