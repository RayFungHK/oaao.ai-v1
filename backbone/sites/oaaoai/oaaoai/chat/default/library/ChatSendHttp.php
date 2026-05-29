<?php

declare(strict_types=1);

namespace oaaoai\chat;

/** JSON HTTP helpers for chat send abort paths. */
final class ChatSendHttp
{
    public static function emitAbort(ChatSendAbort $abort): void
    {
        http_response_code($abort->httpStatus);
        echo json_encode($abort->payload, JSON_UNESCAPED_UNICODE);
    }
}
