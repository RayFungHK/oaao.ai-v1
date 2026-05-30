<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/calendar}. */
return function (array $payload): void {
    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'calendar_schedule',
        'name'        => 'Calendar schedule',
        'description' => 'Extract focus blocks, meetings, and calendar events from the turn',
        'extras'      => [
            'sort'           => 45,
            'module_code'    => 'oaaoai/calendar',
            'i18n_label_key' => 'settings.planner.agent.calendar_schedule',
            'planner_hint'   => 'Use when the user asks to schedule time, book a meeting room, block focus time, '
                . 'or when the assistant proposes a concrete date/time block the user may want on their calendar. '
                . 'Do not use for vague "someday" mentions without a time anchor.',
            'intent_only'    => true,
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-productivity-calendar',
        'label'   => 'Productivity calendar',
        'title'   => 'Productivity calendar',
        'sub'     => 'Post-turn calendar event extraction ({@code productivity.calendar.*}).',
        'icon'    => 'calendar',
        'extras'  => [
            'sort'               => 82,
            'purpose_key_prefix' => 'productivity.calendar',
            'module_code'        => 'oaaoai/calendar',
        ],
    ]);

    $this->trigger('post_turn_action.register')->resolve([
        'action_id' => 'calendar_event_suggested',
        'label'     => 'Calendar event suggestion',
        'extras'    => [
            'sort'                => 20,
            'module_code'         => 'oaaoai/calendar',
            'purpose_key_prefix'  => 'productivity.calendar',
            'template_ref'        => 'materials/prompts/productivity/calendar_event_post_turn.md',
            'sse_event'           => 'calendar_event_suggested',
            'min_confidence'      => 0.62,
            'description'         => 'Post-turn LLM JSON classifier — attaches calendar_event_suggested to message meta.',
        ],
    ]);

    $this->trigger('strip_action.register')->resolve([
        'action_id' => 'calendar_event_suggested',
        'extras'    => [
            'sort'                  => 20,
            'agent_kind'            => 'calendar_schedule',
            'confirmation_default'  => true,
            'confirm_api'           => 'calendar_events_save',
            'module_code'           => 'oaaoai/calendar',
        ],
    ]);

    $this->trigger('info_worker.register')->resolve([
        'worker_id' => 'calendar',
        'label'     => 'Calendar post-turn',
        'extras'    => [
            'sort'                  => 20,
            'pill_kind'             => 'calendar',
            'module_code'           => 'oaaoai/calendar',
            'post_turn_action_ids'  => ['calendar_event_suggested'],
            'meta_keys'             => ['calendar_event_suggested'],
            'description'           => 'Post-turn calendar classifier — [info] pill + [strip] chip.',
        ],
    ]);
};
