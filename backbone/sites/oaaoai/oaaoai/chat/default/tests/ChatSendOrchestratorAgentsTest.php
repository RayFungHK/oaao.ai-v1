<?php

declare(strict_types=1);

use oaaoai\chat\ChatSendOrchestratorAgents;
use PHPUnit\Framework\TestCase;

final class ChatSendOrchestratorAgentsTest extends TestCase
{
    public function test_filter_for_bubble_thread_strips_slide_designer(): void
    {
        $out = ChatSendOrchestratorAgents::filterForBubbleThread(['chat', 'slide_designer', 'web_search']);
        self::assertSame(['chat', 'web_search'], $out);
    }

    public function test_filter_web_search_unless_enabled(): void
    {
        $agents = ['chat', 'web_search', 'vault_rag'];
        self::assertSame(
            ['chat', 'vault_rag'],
            ChatSendOrchestratorAgents::filterWebSearchUnlessEnabled($agents, false),
        );
        self::assertSame(
            $agents,
            ChatSendOrchestratorAgents::filterWebSearchUnlessEnabled($agents, true),
        );
    }
}
