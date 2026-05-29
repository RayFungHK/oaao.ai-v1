<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\slide_designer\SlideSendScope;

/** Slide-designer {@code chat.send.prepare} — published template resolution. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    if ($ctx->slideTemplateId === '') {
        return;
    }

    $resolved = SlideSendScope::resolvePublishedTemplate($this, $ctx->slideTemplateId);
    if (! $resolved['hasPublished']) {
        $ctx->abort(400, [
            'success' => false,
            'message' => 'Slide template not found or not published. Publish it in Templates, then use “Use in chat” again.',
        ]);
    }

    $ctx->hasPublishedSlideTemplate = true;
    $ctx->slideTemplateLabel = $resolved['label'];
};
