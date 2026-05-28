<?php

declare(strict_types=1);

/** ASR user preference fields — {@see live-meeting.php::__onInit}. */
return function (array $payload): void {
    unset($payload);

    $this->trigger('asr_user_preference.register')->resolve([
        'field_id' => 'polish_style',
        'extras'   => [
            'pref_key'     => 'polish_style',
            'type'         => 'select',
            'default'      => 'natural',
            'sort'         => 10,
            'module_code'  => 'oaaoai/live-meeting',
            'label_key'    => 'preferences.asr.polish_style',
            'desc_key'     => 'preferences.asr.polish_style_desc',
            'options'      => [
                ['value' => 'professional', 'label_key' => 'preferences.asr.polish_style.professional'],
                ['value' => 'natural', 'label_key' => 'preferences.asr.polish_style.natural'],
                ['value' => 'concise', 'label_key' => 'preferences.asr.polish_style.concise'],
            ],
        ],
    ]);
};
