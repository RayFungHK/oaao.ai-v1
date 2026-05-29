<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Ordered phases for {@see ChatSendPipeline} — each maps to {@code chat.send.{phase}} on {@code oaaoai/chat}.
 *
 * Migration order (see {@code docs/design/chat-send-pipeline.md}):
 * prepare → message → scope → … conversation_settle → orchestrator_ready → run_start → respond.
 * {@code gate} runs before prepare when wired.
 */
final class ChatSendPhase
{
    public const GATE = 'gate';

    public const PREPARE = 'prepare';

    public const MESSAGE = 'message';

    public const SCOPE = 'scope';

    public const PERSIST = 'persist';

    public const CONVERSATION_SETTLE = 'conversation_settle';

    public const ORCHESTRATOR_READY = 'orchestrator_ready';

    public const RUN_START = 'run_start';

    public const RESPOND = 'respond';

    /** @var list<string> */
    public const ORDER = [
        self::GATE,
        self::PREPARE,
        self::MESSAGE,
        self::SCOPE,
        self::PERSIST,
        self::CONVERSATION_SETTLE,
        self::ORCHESTRATOR_READY,
        self::RUN_START,
        self::RESPOND,
    ];

    public static function eventName(string $phase): string
    {
        return 'chat.send.' . $phase;
    }
}
