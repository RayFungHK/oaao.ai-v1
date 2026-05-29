<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Resolves {@code allowed_agents} and {@code agent_catalog} for orchestrator chat runs.
 */
final class ChatSendOrchestratorAgents
{
    /**
     * @param list<string> $allowedAgents
     * @return list<string>
     */
    public static function filterForBubbleThread(array $allowedAgents): array
    {
        return array_values(array_filter(
            $allowedAgents,
            static fn ($k) => (string) $k !== 'slide_designer',
        ));
    }

    /**
     * @param list<string> $allowedAgents
     * @return list<string>
     */
    public static function resolveAllowedAgents(
        ?object $endpointsApi,
        bool $bubbleThread,
        string $orchestratorUserContent,
        bool $hasPublishedSlideTemplate,
    ): array {
        if ($endpointsApi !== null && method_exists($endpointsApi, 'resolveAllowedAgents')) {
            $allowedAgents = $endpointsApi->resolveAllowedAgents();
        } else {
            $allowedAgents = \oaaoai\endpoints\ChatAllowedAgentsPurposeConfig::defaultAllowed();
        }

        if ($bubbleThread) {
            return self::filterForBubbleThread($allowedAgents);
        }

        return ChatTeachingIntent::ensureSlideDesignerAllowed(
            $allowedAgents,
            $orchestratorUserContent,
            $hasPublishedSlideTemplate,
        );
    }

    /**
     * @param list<string> $allowedAgents
     * @return list<array<string, mixed>>
     */
    public static function catalogForAllowed(array $allowedAgents): array
    {
        return PlannerAgentRegister::catalogForAllowed($allowedAgents);
    }
}
