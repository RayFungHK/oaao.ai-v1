<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/sandbox-coder}. */
return function (array $payload): void {
    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'sandbox_code',
        'name'        => 'Sandbox coder',
        'description' => 'Write, run, and self-check code in an isolated sandbox',
        'extras'      => [
            'sort'            => 20,
            'module_code'     => 'oaaoai/sandbox-coder',
            'i18n_label_key'  => 'settings.planner.agent.sandbox_code',
            'i18n_desc_key'   => 'workspace.task.agent_desc.sandbox_code',
            'planner_hint'    => 'Use for Python/JS/shell scripts, numeric or data analysis, generating intermediate files, '
                . 'rendering slide HTML with syntax self-check loops, or any step that must execute code before the final '
                . 'answer. Chain before slide_designer when deck layout needs computed charts or validated HTML.',
        ],
    ]);
};
