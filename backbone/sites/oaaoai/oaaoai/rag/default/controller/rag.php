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
        $this->trigger('purpose_allocation.register')->resolve([
            'slot_id' => 'pa-rag',
            'label'   => 'RAG',
            'title'   => 'RAG',
            'sub'     => 'Retrieval-augmented generation orchestration (retrieve → optionally rerank → generate).',
            'icon'    => 'book-open',
            'extras'  => [
                'sort'               => 40,
                'purpose_key_prefix' => 'rag',
                'module_code'        => 'oaaoai/rag',
                'label_key'          => 'settings.slot.rag.label',
                'sub_key'            => 'settings.slot.rag.sub',
            ],
        ]);

        /** Wired from Settings → {@code oaao_purpose}; same {@code allocation_mode} as embedding for vault-document consumers. */
        $this->trigger('purpose_allocation.register')->resolve([
            'slot_id' => 'pa-rerank',
            'label'   => 'Rerank',
            'title'   => 'Rerank',
            'sub'     => 'Cross-encoder / passage reranking for vault-grounded retrieval ({@code rerank.*}).',
            'icon'    => 'arrow-down-wide-narrow',
            'extras'  => [
                'sort'               => 30,
                'purpose_key_prefix' => 'rerank',
                'allocation_mode'    => 'vault_documents',
                'module_code'        => 'oaaoai/rag',
                'label_key'          => 'settings.slot.rerank.label',
                'sub_key'            => 'settings.slot.rerank.sub',
            ],
        ]);

        $this->trigger('purpose_allocation.register')->resolve([
            'slot_id' => 'pa-vault',
            'label'   => 'Vault summary',
            'title'   => 'Vault summary',
            'sub'     => 'Knowledge-base summarisation and vault-grounded routing ({@code vault.*}).',
            'icon'    => 'vault',
            'extras'  => [
                'sort'               => 45,
                'purpose_key_prefix' => 'vault',
                'allocation_mode'    => 'vault_documents',
                'module_code'        => 'oaaoai/rag',
                'label_key'          => 'settings.slot.vault.label',
                'sub_key'            => 'settings.slot.vault.sub',
            ],
        ]);

        $this->trigger('purpose_allocation.register')->resolve([
            'slot_id' => 'pa-polish',
            'label'   => 'ASR text polish',
            'title'   => 'ASR text polish',
            'sub'     => 'LLM cleanup for speech transcripts — punctuation, glossary terms ({@code polish.*}).',
            'icon'    => 'sparkles',
            'extras'  => [
                'sort'               => 38,
                'purpose_key_prefix' => 'polish',
                'allocation_mode'    => 'vault_documents',
                'module_code'        => 'oaaoai/rag',
                'label_key'          => 'settings.slot.polish.label',
                'sub_key'            => 'settings.slot.polish.sub',
            ],
        ]);

        $this->trigger('purpose_allocation.register')->resolve([
            'slot_id' => 'pa-graph',
            'label'   => 'Graph RAG',
            'title'   => 'Graph RAG',
            'sub'     => 'Entity/relation graph construction and hybrid retrieval ({@code graph.*}) over Arango + vectors.',
            'icon'    => 'share-2',
            'extras'  => [
                'sort'               => 42,
                'purpose_key_prefix' => 'graph',
                'allocation_mode'    => 'vault_documents',
                'module_code'        => 'oaaoai/rag',
                'label_key'          => 'settings.slot.graph_rag.label',
                'sub_key'            => 'settings.slot.graph_rag.sub',
            ],
        ]);

        $this->trigger('chat_pipeline.register')->resolve([
            'entry_id' => 'cp.rag.retrieval_rail',
            'kind'     => 'step_rail',
            'label'    => 'RAG retrieval summaries',
            'extras'   => [
                'sort'        => 30,
                'module_code' => 'oaaoai/rag',
                'description' => 'Orchestrator fills milestone steps[].rail when retrieval runs.',
            ],
        ]);

        $this->trigger('chat_pipeline.register')->resolve([
            'entry_id' => 'cp.rag.attachment',
            'kind'     => 'composer_slot',
            'label'    => 'Chat file attachment',
            'extras'   => [
                'sort'          => 45,
                'module_code'   => 'oaaoai/rag',
                'composer_zone' => 'composer_actions',
                'esm_url'       => '/webassets/rag/default/js/rag-composer-attach.js',
                'description'   => 'Ephemeral upload — extract/vision for this turn only (not vault).',
            ],
        ]);

        $this->trigger('chat_pipeline.register')->resolve([
            'entry_id' => 'cp.rag.voice_input',
            'kind'     => 'composer_slot',
            'label'    => 'Voice input (ASR)',
            'extras'   => [
                'sort'          => 46,
                'module_code'   => 'oaaoai/rag',
                'composer_zone' => 'composer_actions',
                'esm_url'       => '/webassets/rag/default/js/rag-composer-voice.js',
                'description'   => 'MediaRecorder → orchestrator ASR → composer text.',
            ],
        ]);

        $this->trigger('chat_pipeline.register')->resolve([
            'entry_id' => 'cp.rag.attachment_rail',
            'kind'     => 'step_rail',
            'label'    => 'Attachment extraction',
            'extras'   => [
                'sort'        => 25,
                'module_code' => 'oaaoai/rag',
                'description' => 'Orchestrator milestone when chat attachments are processed.',
            ],
        ]);

        $this->trigger('chat_pipeline.register')->resolve([
            'entry_id' => 'cp.rag.citation_block',
            'kind'     => 'message_block',
            'label'    => 'Citation / passage cards',
            'extras'   => [
                'sort'         => 35,
                'module_code'  => 'oaaoai/rag',
                'block_type'   => 'rag_citations',
                'message_zone' => 'after',
                'esm_url'      => '/webassets/rag/default/js/rag-citations.js',
            ],
        ]);

        /** Vault document hooks — parity with legacy stacks (audio ASR; text/pdf embedding + RAG index). Orchestrator binds {@code hook_id}. */
        $this->trigger('vault_document_hook.register')->resolve([
            'hook_id' => 'vh.rag.audio_asr',
            'kind'    => 'audio_asr',
            'label'   => 'Speech-to-text (ASR)',
            'extras'  => [
                'sort'        => 40,
                'module_code' => 'oaaoai/rag',
                'description' => 'Transcribe vault audio uploads — consumes embedding.* / vault.* allocation when chained to summarisation.',
                'mime_prefixes' => ['audio/'],
                'purpose_keys' => ['embedding', 'vault'],
            ],
        ]);

        $this->trigger('vault_document_hook.register')->resolve([
            'hook_id' => 'vh.rag.document_embed',
            'kind'    => 'text_embed_rag',
            'label'   => 'Embed & index for RAG',
            'extras'  => [
                'sort'        => 50,
                'module_code' => 'oaaoai/rag',
                'description' => 'Chunk, embed, and index PDF, plaintext/JSON/markdown, and Office OOXML (.docx / .xlsx / .pptx) for retrieval.',
                'mime_prefixes' => [
                    'text/',
                    'application/pdf',
                    'application/json',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ],
                'purpose_keys' => ['embedding', 'rerank', 'rag', 'vault'],
            ],
        ]);

        $this->trigger('vault_document_hook.register')->resolve([
            'hook_id' => 'vh.rag.graph_index',
            'kind'    => 'graph_index',
            'label'   => 'Graph index (GraphRAG)',
            'extras'  => [
                'sort'          => 52,
                'module_code'   => 'oaaoai/rag',
                'description'   => 'Build or refresh knowledge-graph nodes/edges for a document (runs after embedding when vault graph_mode is on, or when manually queued).',
                'mime_prefixes' => [
                    'text/',
                    'application/pdf',
                    'application/json',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ],
                'purpose_keys'  => ['graph', 'embedding', 'rag', 'vault'],
            ],
        ]);

        /** Optional post-embed stages — stable {@code hook_id} for orchestrator; do not flip {@code embed_status} on finish ({@see vault_job_finish.php}). */
        $this->trigger('vault_document_hook.register')->resolve([
            'hook_id' => 'vh.vault.rerank_pass',
            'kind'    => 'text_rerank',
            'label'   => 'Passage rerank',
            'extras'  => [
                'sort'          => 55,
                'module_code'   => 'oaaoai/rag',
                'description'   => 'Rerank vault passages — consumes rerank.* purpose allocation.',
                'mime_prefixes' => [
                    'text/',
                    'application/pdf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ],
                'purpose_keys'  => ['rerank', 'vault'],
            ],
        ]);

        $this->trigger('vault_document_hook.register')->resolve([
            'hook_id' => 'vh.vault.summary',
            'kind'    => 'vault_summary',
            'label'   => 'Vault-grounded summary',
            'extras'  => [
                'sort'          => 58,
                'module_code'   => 'oaaoai/rag',
                'description'   => 'Summarise or route using vault context — consumes vault.* purpose allocation.',
                'mime_prefixes' => [
                    'text/',
                    'application/pdf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                ],
                'purpose_keys'  => ['vault', 'embedding'],
            ],
        ]);

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
