<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Razy\Controller;

/**
 * Runs {@code chat.send.*} hook phases on {@code oaaoai/chat}.
 *
 * Listeners register via {@code $agent->listen('oaaoai/chat:chat.send.prepare', 'event/chat_send_prepare')} in their module {@code __onInit}.
 */
final class ChatSendPipeline
{
    public function __construct(
        private readonly Controller $controller,
    ) {
    }

    public function run(string $phase, ChatSendContext $context): ChatSendContext
    {
        $event = ChatSendPhase::eventName($phase);
        $this->controller->trigger($event)->resolve(['context' => $context]);

        return $context;
    }

    /**
     * @param list<string>|null $phases Defaults to {@see ChatSendPhase::ORDER}
     */
    public function runMany(ChatSendContext $context, ?array $phases = null): ChatSendContext
    {
        foreach ($phases ?? ChatSendPhase::ORDER as $phase) {
            $context = $this->run($phase, $context);
        }

        return $context;
    }
}
