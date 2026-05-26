<?php

declare(strict_types=1);

/** Lazy registry wiring for {@code oaaoai/mine}. */
return function (array $payload): void {
    $this->trigger('purpose_allocation.register')->resolve([
        'slot_id' => 'pa-mine',
        'label'   => 'Data Mining',
        'title'   => 'Data Mining',
        'sub'     => 'Structured schema/row extraction for scheduled mines ({@code mine.*}).',
        'icon'    => 'database',
        'extras'  => [
            'sort'               => 49,
            'purpose_key_prefix' => 'mine',
            'module_code'        => 'oaaoai/mine',
            'label_key'          => 'settings.slot.mine.label',
            'sub_key'            => 'settings.slot.mine.sub',
        ],
    ]);
};
