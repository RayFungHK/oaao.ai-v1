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
     * Prepare-only web search — omit from planner registry unless composer globe is on.
     * Python may still force-add when {@code planning.intent} scores public-web need.
     *
     * @param list<string> $allowedAgents
     * @return list<string>
     */
    public static function filterWebSearchUnlessEnabled(array $allowedAgents, bool $enableWebSearch): array
    {
        if ($enableWebSearch) {
            return $allowedAgents;
        }

        return array_values(array_filter(
            $allowedAgents,
            static fn ($k) => (string) $k !== 'web_search',
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
        bool $enableWebSearch = false,
    ): array {
        if ($endpointsApi !== null && method_exists($endpointsApi, 'resolveAllowedAgents')) {
            $allowedAgents = $endpointsApi->resolveAllowedAgents();
        } else {
            $allowedAgents = \oaaoai\endpoints\ChatAllowedAgentsPurposeConfig::defaultAllowed();
        }

        if ($bubbleThread) {
            return self::filterWebSearchUnlessEnabled(
                self::filterForBubbleThread(
                    PlannerAgentRegister::filterDispatchableKinds($allowedAgents),
                ),
                $enableWebSearch,
            );
        }

        return self::filterWebSearchUnlessEnabled(
            ChatTeachingIntent::ensureSlideDesignerAllowed(
                PlannerAgentRegister::filterDispatchableKinds($allowedAgents),
                $orchestratorUserContent,
                $hasPublishedSlideTemplate,
            ),
            $enableWebSearch,
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
