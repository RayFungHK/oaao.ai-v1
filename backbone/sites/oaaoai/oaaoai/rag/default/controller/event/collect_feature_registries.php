<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/rag} — {@see rag.php::__onInit}. */
return function (array $payload): void {
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
};
