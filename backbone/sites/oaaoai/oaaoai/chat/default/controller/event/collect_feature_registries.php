<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/chat} — {@see chat.php::__onInit}. */
return function (array $payload): void {
    $this->oaao_chat_seed_planner_agents();

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.chat.milestone_vertical',
        'kind'     => 'step_rail',
        'label'    => 'Milestone timeline',
        'extras'   => [
            'sort'        => 10,
            'module_code' => 'oaaoai/chat',
            'description' => 'Vertical milestone rail — orchestrator payload key oaao_pipeline.milestone.',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.chat.markdown_stream',
        'kind'     => 'message_block',
        'label'    => 'Markdown stream bubble',
        'extras'   => [
            'sort'        => 20,
            'module_code' => 'oaaoai/chat',
            'block_type'  => 'markdown_stream',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.chat.task_files_cta',
        'kind'     => 'message_block',
        'label'    => 'Task files affordance',
        'extras'   => [
            'sort'        => 90,
            'module_code' => 'oaaoai/chat',
            'block_type'  => 'task_files_cta',
        ],
    ]);

    $this->trigger('chat_pipeline.register')->resolve([
        'entry_id' => 'cp.chat.task_materials',
        'kind'     => 'message_block',
        'label'    => 'Task materials dialog',
        'extras'   => [
            'sort'        => 91,
            'module_code' => 'oaaoai/chat',
            'block_type'  => 'task_materials',
            'esm_url'     => '/webassets/chat/default/js/task-materials-dialog.js',
        ],
    ]);

    $this->trigger('micro_skill_provider.register')->resolve([
        'provider_id' => 'chat.conversation',
        'kind'        => 'conversation',
        'label'       => 'Conversation micro skills',
        'extras'      => [
            'sort'        => 20,
            'module_code' => 'oaaoai/chat',
            'description' => 'User-saved skills from chat analysis (preview markdown, then publish).',
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-planning',
        'label'   => 'Planning',
        'title'   => 'Planning',
        'sub'     => 'Planner and step routing for chat-side orchestration (<code class="font-mono text-xs">planning.*</code>).',
        'icon'    => 'map',
        'extras'  => [
            'sort'               => 50,
            'purpose_key_prefix' => 'planning',
            'module_code'        => 'oaaoai/chat',
            'label_key'          => 'settings.slot.planning.label',
            'sub_key'            => 'settings.slot.planning.sub',
        ],
    ]);
};
