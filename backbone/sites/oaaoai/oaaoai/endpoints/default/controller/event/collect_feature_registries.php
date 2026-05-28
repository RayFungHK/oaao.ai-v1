<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/PurposeAllocationRegister.php';
require_once dirname(__DIR__, 2) . '/library/MediaCapabilityRegister.php';
require_once dirname(__DIR__, 2) . '/library/MmPythonModuleRegister.php';

use oaaoai\endpoints\AsrUserPreferenceRegister;
use oaaoai\endpoints\MediaCapabilityRegister;
use oaaoai\endpoints\MmPythonModuleRegister;
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
        'pa-knowledge-orientation',
        'Knowledge orientation',
        'Knowledge orientation',
        'Workspace topic snapshot from chat (<code class="font-mono text-xs">knowledge.orientation.*</code>) — EPIC-WS-1.',
        'compass',
        [
            'sort' => 61,
            'purpose_key_prefix' => 'knowledge.orientation',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.knowledge_orientation.label',
            'sub_key'   => 'settings.slot.knowledge_orientation.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-knowledge-search-plan',
        'Knowledge search plan',
        'Knowledge search plan',
        'Multi-query web search planner (<code class="font-mono text-xs">knowledge.search_plan.*</code>) — EPIC-WS-1.',
        'search',
        [
            'sort' => 62,
            'purpose_key_prefix' => 'knowledge.search_plan',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.knowledge_search_plan.label',
            'sub_key'   => 'settings.slot.knowledge_search_plan.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-knowledge-platform',
        'Knowledge platform',
        'Knowledge platform',
        'Scheduled refresh &amp; RAG merge (<code class="font-mono text-xs">knowledge.platform.*</code>) — EPIC-WS-1-S6.',
        'globe',
        [
            'sort' => 60,
            'purpose_key_prefix' => 'knowledge.platform',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.knowledge_platform.label',
            'sub_key'   => 'settings.slot.knowledge_platform.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-knowledge-classify',
        'Knowledge classify',
        'Knowledge classify',
        'Bucket re-classification (<code class="font-mono text-xs">knowledge.classify.*</code>) — EPIC-WS-1-S9.',
        'tags',
        [
            'sort' => 63,
            'purpose_key_prefix' => 'knowledge.classify',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.knowledge_classify.label',
            'sub_key'   => 'settings.slot.knowledge_classify.sub',
        ]
    );
    PurposeAllocationRegister::add(
        'pa-knowledge-distill',
        'Knowledge distill',
        'Knowledge distill',
        'Bucket distillation for RAG / training (<code class="font-mono text-xs">knowledge.distill.*</code>) — EPIC-WS-1-S9.',
        'sparkles',
        [
            'sort' => 64,
            'purpose_key_prefix' => 'knowledge.distill',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.knowledge_distill.label',
            'sub_key'   => 'settings.slot.knowledge_distill.sub',
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
        'pa-mm-understand',
        'MM understand',
        'MM understand',
        'Attachment / vision understanding (<code class="font-mono text-xs">mm.understand.*</code>) — endpoint or Python module.',
        'scan-eye',
        [
            'sort' => 72,
            'purpose_key_prefix' => 'mm.understand',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.mm_understand.label',
            'sub_key'   => 'settings.slot.mm_understand.sub',
            'meta_defaults' => ['mm_axis' => 'understand'],
        ]
    );
    PurposeAllocationRegister::add(
        'pa-mm-generate',
        'MM generate',
        'MM generate',
        'Image / video generation (<code class="font-mono text-xs">mm.generate.*</code>) — endpoint or Lance module.',
        'image-plus',
        [
            'sort' => 73,
            'purpose_key_prefix' => 'mm.generate',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.mm_generate.label',
            'sub_key'   => 'settings.slot.mm_generate.sub',
            'meta_defaults' => ['mm_axis' => 'generate'],
        ]
    );
    PurposeAllocationRegister::add(
        'pa-mm-edit',
        'MM edit',
        'MM edit',
        'Image / video editing (<code class="font-mono text-xs">mm.edit.*</code>) — endpoint or Lance module.',
        'image-upscale',
        [
            'sort' => 74,
            'purpose_key_prefix' => 'mm.edit',
            'module_code' => 'oaaoai/endpoints',
            'label_key' => 'settings.slot.mm_edit.label',
            'sub_key'   => 'settings.slot.mm_edit.sub',
            'meta_defaults' => ['mm_axis' => 'edit'],
        ]
    );

    MediaCapabilityRegister::add(
        'x2t_image',
        'Image → text',
        'Caption or understand uploaded images',
        ['sort' => 10, 'mm_axis' => 'understand', 'lance_task' => 'x2t_image', 'module_code' => 'oaaoai/endpoints']
    );
    MediaCapabilityRegister::add(
        'x2t_video',
        'Video → text',
        'Summarise or understand uploaded video',
        ['sort' => 11, 'mm_axis' => 'understand', 'lance_task' => 'x2t_video', 'module_code' => 'oaaoai/endpoints']
    );
    MediaCapabilityRegister::add(
        't2i',
        'Text → image',
        'Generate images from prompts',
        ['sort' => 20, 'mm_axis' => 'generate', 'lance_task' => 't2i', 'module_code' => 'oaaoai/endpoints']
    );
    MediaCapabilityRegister::add(
        't2v',
        'Text → video',
        'Generate video from prompts',
        ['sort' => 21, 'mm_axis' => 'generate', 'lance_task' => 't2v', 'module_code' => 'oaaoai/endpoints']
    );
    MediaCapabilityRegister::add(
        'image_edit',
        'Image edit',
        'Edit or inpaint images',
        ['sort' => 30, 'mm_axis' => 'edit', 'lance_task' => 'image_edit', 'module_code' => 'oaaoai/endpoints']
    );
    MediaCapabilityRegister::add(
        'video_edit',
        'Video edit',
        'Edit or extend video clips',
        ['sort' => 31, 'mm_axis' => 'edit', 'lance_task' => 'video_edit', 'module_code' => 'oaaoai/endpoints']
    );

    MmPythonModuleRegister::add(
        'mm_lance',
        'Lance',
        'Hugging Face Lance multimodal worker (t2i, t2v, x2t, edit)',
        [
            'sort'            => 10,
            'module_code'     => 'oaaoai/endpoints',
            'base_url_env'    => 'OAAO_LANCE_BASE_URL',
            'supported_tasks' => ['t2i', 't2v', 'x2t_image', 'x2t_video', 'image_edit', 'video_edit'],
            'aliases'         => ['lance'],
            'i18n_label_key'  => 'settings.mm.module.mm_lance.label',
            'i18n_desc_key'   => 'settings.mm.module.mm_lance.desc',
            'config_fields'   => [
                [
                    'key'          => 'base_url',
                    'type'         => 'url',
                    'label_key'    => 'settings.mm.config.base_url',
                    'placeholder'  => 'http://host.docker.internal:8787',
                    'env_fallback' => 'OAAO_LANCE_BASE_URL',
                    'hint_key'     => 'settings.mm.config.base_url_hint',
                ],
            ],
        ],
    );

    AsrUserPreferenceRegister::addField('polish_style', [
        'pref_key'    => 'polish_style',
        'type'        => 'select',
        'default'     => 'natural',
        'sort'        => 10,
        'module_code' => 'oaaoai/endpoints',
        'label_key'   => 'preferences.asr.polish_style',
        'desc_key'    => 'preferences.asr.polish_style_desc',
        'options'     => [
            ['value' => 'professional', 'label_key' => 'preferences.asr.polish_style.professional'],
            ['value' => 'natural', 'label_key' => 'preferences.asr.polish_style.natural'],
            ['value' => 'concise', 'label_key' => 'preferences.asr.polish_style.concise'],
        ],
    ]);

    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'mm_understand',
        'name'        => 'Multimodal understand',
        'description' => 'Parse attachments with vision / caption models',
        'extras'      => [
            'sort'            => 35,
            'module_code'     => 'oaaoai/endpoints',
            'planner_hint'    => 'Use when attachments (PDF pages, images, video) need dedicated understanding beyond chat LLM vision.',
            'mm_purpose_axis' => 'understand',
        ],
    ]);
    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'mm_generate',
        'name'        => 'Multimodal generate',
        'description' => 'Generate images or video from prompts',
        'extras'      => [
            'sort'            => 41,
            'module_code'     => 'oaaoai/endpoints',
            'planner_hint'    => 'Use when the user wants generated images or video (t2i / t2v). Prefer over legacy image_gen when Settings allocates mm.generate.',
            'mm_purpose_axis' => 'generate',
            'ask_enabled'     => true,
            'ask_default_message' => 'I can generate images or video from your prompt. Proceed?',
        ],
    ]);
    $this->trigger('planner_agent.register')->resolve([
        'agent_kind'  => 'mm_edit',
        'name'        => 'Multimodal edit',
        'description' => 'Edit images or video with inpainting / style tools',
        'extras'      => [
            'sort'            => 42,
            'module_code'     => 'oaaoai/endpoints',
            'planner_hint'    => 'Use when the user wants to edit, inpaint, or restyle an existing image or video clip.',
            'mm_purpose_axis' => 'edit',
            'ask_enabled'     => true,
            'ask_default_message' => 'I can edit the image or video you attached. Proceed?',
        ],
    ]);
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
