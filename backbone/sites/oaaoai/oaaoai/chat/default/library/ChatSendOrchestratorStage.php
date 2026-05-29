<?php

declare(strict_types=1);

namespace oaaoai\chat;

/** Sub-stages for {@see ChatSendPhase::ORCHESTRATOR_READY}. */
final class ChatSendOrchestratorStage
{
    public const BIND = 'bind';

    public const PAYLOAD = 'payload';

    public const AGENTS = 'agents';
}
