<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/PurposeAllocationRegister.php';

use oaaoai\endpoints\PurposeAllocationRegister;

/** Built-in purpose-allocation slots owned by {@code oaaoai/endpoints}. */
return function (array $payload): void {
    PurposeAllocationRegister::add(
        'pa-chat',
        'Chat',
        'Chat',
        'Registered chat pipeline — multiple chat-endpoint profiles in the selector; rows here set default LLMs per routing key.',
        'message-circle-more',
        [
            'sort' => 10,
            'purpose_key_prefix' => 'chat',
            'allocation_mode' => 'chat_multi',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.chat.label',
            'sub_key'   => 'settings.slot.chat.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-uiqe',
        'Input quality',
        'Input quality',
        'Pre-flight scoring (e.g. IQS / ACCS) — fast, low-cost models.',
        'sparkles',
        [
            'sort' => 60,
            'purpose_key_prefix' => 'uiqe',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.uiqe.label',
            'sub_key'   => 'settings.slot.uiqe.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-asr',
        'ASR',
        'ASR',
        'Speech-to-text modules register here (<code class="font-mono text-xs">asr.*</code>).',
        'mic',
        [
            'sort' => 70,
            'purpose_key_prefix' => 'asr',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.asr.label',
            'sub_key'   => 'settings.slot.asr.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-asr-live',
        'ASR-Live',
        'ASR-Live',
        'Composer mic + Live Meeting streaming / input (<code class="font-mono text-xs">asr.live.*</code>).',
        'mic-vocal',
        [
            'sort' => 71,
            'purpose_key_prefix' => 'asr.live',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.asr_live.label',
            'sub_key'   => 'settings.slot.asr_live.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-other',
        'Other',
        'Other purposes',
        'Routing keys that do not match any registered prefix above.',
        'circle-dotted',
        [
            'sort' => 900,
            'fallback' => true,
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.other.label',
            'title_key' => 'settings.slot.other.title',
            'sub_key'   => 'settings.slot.other.sub',
        ]
    );
};
