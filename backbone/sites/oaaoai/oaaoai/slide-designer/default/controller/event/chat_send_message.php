<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendContext;
use oaaoai\slide_designer\SlideSendTemplateSlug;

/** Slide-designer {@code chat.send.message} — published template slug display vs orchestrator text. */
return function (array $payload): void {
    $ctx = $payload['context'] ?? null;
    if (! $ctx instanceof ChatSendContext) {
        return;
    }

    SlideSendTemplateSlug::apply($ctx);
};
