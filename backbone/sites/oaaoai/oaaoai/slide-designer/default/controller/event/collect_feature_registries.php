<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/slide-designer}. */
return function (array $payload): void {
    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'slide_designer',
        'name'        => 'Slide designer',
        'description' => 'Create and continue slide decks (outline, per-slide HTML, export)',
        'extras'      => [
            'sort'            => 25,
            'module_code'     => 'oaaoai/slide-designer',
            'i18n_label_key'  => 'settings.planner.agent.slide_designer',
            'i18n_desc_key'   => 'workspace.task.agent_desc.slide_designer',
            'planner_hint'    => 'Use when the user wants a presentation or slide deck: outline markdown, per-slide content, '
                . 'HTML layout via sandbox, and deck export. Prefer after vault_rag or sandbox_code when source data or '
                . 'calculations are needed. Plan exactly one slide_designer agent task per run (use requires_ask on that '
                . 'same task if confirmation is needed). The runtime expands one slide_designer row into outline + parallel '
                . 'per-slide workers + export (SD-4) — do not add extra slide_designer rows yourself.',
            'ask_enabled'           => true,
            'ask_hint'              => 'Set requires_ask=true when the user might only be exploring (Q&A, summary) and has '
                . 'not clearly asked to build or export a slide deck. Ask before running slide_designer. '
                . 'When another agent ran first, the runtime will phase-summarize then ask again — do not add a second slide_designer row.',
            'ask_default_message'   => 'I can start the slide designer to build a deck (outline, per-slide HTML, export). '
                . 'Should I proceed?',
            'i18n_ask_title_key'    => 'chat.agent_ask.slide_designer.title',
            'i18n_ask_message_key'  => 'chat.agent_ask.slide_designer.message',
            'i18n_ask_proceed_key'  => 'chat.agent_ask.proceed',
            'i18n_ask_skip_key'     => 'chat.agent_ask.skip',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.slide_designer.preview_strip',
        'kind'     => 'message_block',
        'label'    => 'Slide preview strip',
        'extras'   => [
            'sort'         => 80,
            'module_code'  => 'oaaoai/slide-designer',
            'block_type'   => 'slide_preview_strip',
            'message_zone' => 'after',
            'esm_url'      => '/webassets/slide-designer/default/js/slide-preview-strip.js',
            'description'  => 'Per-slide HTML previews + material thumb (SD-3).',
        ],
    ]);

    $this->trigger('micro_skill_provider.register')->resolve([
        'provider_id' => 'slide_designer.bound_template',
        'kind'        => 'bound_template',
        'label'       => 'PPTX template micro skills',
        'extras'      => [
            'sort'        => 10,
            'module_code' => 'oaaoai/slide-designer',
            'description' => 'Layout, typography, and color rules bound to one published template_id.',
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-slide-template',
        'label'   => 'Slide template',
        'title'   => 'Slide template',
        'sub'     => 'LLM for PPTX import analyze, dummy preview copy, and per-layout fix ({@code slide_template.*}).',
        'icon'    => 'square-dashed-kanban',
        'extras'  => [
            'sort'               => 76,
            'purpose_key_prefix' => 'slide_template',
            'module_code'        => 'oaaoai/slide-designer',
            'label_key'          => 'settings.slot.slide_template.label',
            'sub_key'            => 'settings.slot.slide_template.sub',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.slide_designer.template_import',
        'kind'     => 'composer_slot',
        'label'    => 'Slide template import',
        'extras'   => [
            'sort'          => 22,
            'module_code'   => 'oaaoai/slide-designer',
            'composer_zone' => 'composer_extra_toolbar',
            'esm_url'       => '/webassets/slide-designer/default/js/template-import-dialog.js',
            'description'   => 'Legacy composer slot id — PPTX import is on workspace/templates; Chat uses /template slug only.',
        ],
    ]);
};
