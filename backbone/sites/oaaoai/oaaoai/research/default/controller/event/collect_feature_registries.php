<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/research}. */
return function (array $payload): void {
    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-research-discover',
        'label'   => 'Research discover',
        'title'   => 'Research discover',
        'sub'     => 'Analyze sources — page classify and article link filtering ({@code research.discover.*}).',
        'icon'    => 'search',
        'extras'  => [
            'sort'               => 46,
            'purpose_key_prefix' => 'research.discover',
            'module_code'        => 'oaaoai/research',
            'label_key'          => 'settings.slot.research_discover.label',
            'sub_key'            => 'settings.slot.research_discover.sub',
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-research-summary',
        'label'   => 'Research summary',
        'title'   => 'Research summary',
        'sub'     => 'Per-article vault summaries during fetch runs ({@code research.summary.*}).',
        'icon'    => 'file-text',
        'extras'  => [
            'sort'               => 47,
            'purpose_key_prefix' => 'research.summary',
            'module_code'        => 'oaaoai/research',
            'label_key'          => 'settings.slot.research_summary.label',
            'sub_key'            => 'settings.slot.research_summary.sub',
        ],
    ]);

    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-research-match',
        'label'   => 'Research match',
        'title'   => 'Research match',
        'sub'     => 'Match criteria normalize + article hit scoring ({@code research.match.*}).',
        'icon'    => 'target',
        'extras'  => [
            'sort'               => 48,
            'purpose_key_prefix' => 'research.match',
            'module_code'        => 'oaaoai/research',
            'label_key'          => 'settings.slot.research_match.label',
            'sub_key'            => 'settings.slot.research_match.sub',
        ],
    ]);
};
