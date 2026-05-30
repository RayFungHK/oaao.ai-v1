<?php

declare(strict_types=1);

use oaaoai\chat\ComposePromptRegister;
use oaaoai\chat\PlannerPromptRegister;
use oaaoai\todo\TodoComposePrompt;

require_once dirname(__DIR__, 4) . '/chat/default/library/ComposePromptRegister.php';
require_once dirname(__DIR__, 4) . '/chat/default/library/PlannerPromptRegister.php';

/** Lazy registry wiring for {@code oaaoai/todo}. */
return function (array $payload): void {
    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'todo_extract',
        'name'        => 'Todo extract',
        'description' => 'Turn checklist items and action items into user todos',
        'extras'      => [
            'sort'           => 46,
            'module_code'    => 'oaaoai/todo',
            'i18n_label_key' => 'settings.planner.agent.todo_extract',
            'planner_hint'   => 'Use when the user asks for a todo list, checklist, or actionable next steps '
                . 'they may want tracked in the header todos panel — not for long-form preferences (use UX-1 tags).',
            'intent_only'    => true,
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-productivity-todo',
        'label'   => 'Productivity todo',
        'title'   => 'Productivity todo',
        'sub'     => 'Post-turn todo extraction ({@code productivity.todo.*}).',
        'icon'    => 'list-checks',
        'extras'  => [
            'sort'               => 83,
            'purpose_key_prefix' => 'productivity.todo',
            'module_code'        => 'oaaoai/todo',
        ],
    ]);

    $this->trigger('post_turn_action.register')->resolve([
        'action_id' => 'todo_items_suggested',
        'label'     => 'Todo batch suggestion',
        'extras'    => [
            'sort'               => 21,
            'module_code'        => 'oaaoai/todo',
            'purpose_key_prefix' => 'productivity.todo',
            'template_ref'       => 'materials/prompts/productivity/todo_item_post_turn.md',
            'sse_event'          => 'todo_items_suggested',
            'min_confidence'     => 0.58,
            'description'        => 'Post-turn LLM JSON classifier — attaches todo_item(s)_suggested to message meta.',
        ],
    ]);

    $this->trigger('post_turn_action.register')->resolve([
        'action_id' => 'todo_resolve_suggested',
        'label'     => 'Todo resolve suggestion',
        'extras'    => [
            'sort'               => 22,
            'module_code'        => 'oaaoai/todo',
            'sse_event'          => 'todo_resolve_suggested',
            'min_confidence'     => 0.60,
            'enabled'            => true,
            'description'        => 'Heuristic completion hint against open todos for this conversation.',
        ],
    ]);

    $this->trigger('strip_action.register')->resolve([
        'action_id' => 'todo_item_suggested',
        'extras'    => [
            'sort'                 => 21,
            'agent_kind'           => 'todo_extract',
            'confirmation_default' => true,
            'confirm_api'          => 'todos_save',
            'module_code'          => 'oaaoai/todo',
        ],
    ]);

    $this->trigger('strip_action.register')->resolve([
        'action_id' => 'todo_items_suggested',
        'extras'    => [
            'sort'                 => 22,
            'agent_kind'           => 'todo_extract',
            'confirmation_default' => true,
            'confirm_api'          => 'todos_save',
            'module_code'          => 'oaaoai/todo',
        ],
    ]);

    $this->trigger('strip_action.register')->resolve([
        'action_id' => 'todo_resolve_suggested',
        'extras'    => [
            'sort'                 => 23,
            'agent_kind'           => 'todo_extract',
            'confirmation_default' => false,
            'confirm_api'          => 'todos_resolve',
            'module_code'          => 'oaaoai/todo',
        ],
    ]);

    $this->trigger('info_worker.register')->resolve([
        'worker_id' => 'todo',
        'label'     => 'Todo post-turn',
        'extras'    => [
            'sort'                 => 21,
            'pill_kind'            => 'todo',
            'module_code'          => 'oaaoai/todo',
            'post_turn_action_ids' => [
                'todo_items_suggested',
                'todo_item_suggested',
                'todo_resolve_suggested',
            ],
            'meta_keys' => [
                'todo_items_suggested',
                'todo_item_suggested',
                'todo_resolve_suggested',
            ],
            'only_last'   => true,
            'description' => 'Post-turn todo classifier — [info] pill + [strip] chips.',
        ],
    ]);

    PlannerPromptRegister::add(
        'todo',
        'productivity',
        'When the user asks for a checklist or actionable tasks, avoid duplicating open todos listed in the planner appendix; '
        . 'calendar scheduling is not a todo.',
        true,
        83,
    );
    ComposePromptRegister::add('todo', 'todo', TodoComposePrompt::body(), 83);
};
