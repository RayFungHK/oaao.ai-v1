<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/vault}. */
return function (array $payload): void {
    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-asr-summary',
        'label'   => 'ASR Summary',
        'title'   => 'ASR Summary',
        'sub'     => 'LLM for View Transcript → Customize Summary ({@code asr_summary.*}).',
        'icon'    => 'file-text',
        'extras'  => [
            'sort'               => 71,
            'purpose_key_prefix' => 'asr_summary',
            'allocation_mode'    => 'vault_documents',
            'module_code'        => 'oaaoai/vault',
            'label_key'          => 'settings.slot.asr_summary.label',
            'sub_key'            => 'settings.slot.asr_summary.sub',
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-embedding',
        'label'   => 'Embedding',
        'title'   => 'Embedding',
        'sub'     => 'Vector embedding models for vault documents and retrieval indexes ({@code embedding.*}).',
        'icon'    => 'layers',
        'extras'  => [
            'sort'               => 20,
            'purpose_key_prefix' => 'embedding',
            'allocation_mode'    => 'vault_documents',
            'module_code'        => 'oaaoai/vault',
            'label_key'          => 'settings.slot.embedding.label',
            'sub_key'            => 'settings.slot.embedding.sub',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.vault.source_selector',
        'kind'     => 'composer_slot',
        'label'    => 'Vault sources',
        'extras'   => [
            'sort'           => 18,
            'module_code'    => 'oaaoai/vault',
            'composer_zone'  => 'composer_extra_toolbar',
            'description'    => 'Chat composer mounts vault / folder / embedded-file multi-select when this row is present.',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.vault.scoped_retrieval_rail',
        'kind'     => 'step_rail',
        'label'    => 'Vault-scoped retrieval',
        'extras'   => [
            'sort'        => 28,
            'module_code' => 'oaaoai/vault',
            'description' => 'Orchestrator may attach vault-grounded retrieval steps when chat sends vault_source_refs / vault_source_ids.',
        ],
    ]);
};
