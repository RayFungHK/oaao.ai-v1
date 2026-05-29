<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;

/** Slide-designer {@code chat.send.conversation_settle} — user meta for template picks. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext || ! $ctx->hasPublishedSlideTemplate) {
        return;
    }

    $ctx->userMetaArr['slide_template_id'] = $ctx->slideTemplateId;
    $ctx->userMetaArr['slide_template_label'] = $ctx->slideTemplateLabel;
    $ctx->userMetaArr['slide_template_ui'] = true;
};
