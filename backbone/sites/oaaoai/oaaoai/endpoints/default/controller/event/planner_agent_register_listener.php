<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\chat\\PlannerAgentRegister} — loaded from {@code oaaoai/endpoints} ({@see endpoints.php})
 * so feature modules can register planner agent hints during {@code __onInit}.
 */

require_once dirname(__DIR__, 4) . '/chat/default/library/PlannerAgentRegister.php';

use oaaoai\chat\PlannerAgentRegister;

return function (array $payload): void {
    $agent_kind = isset($payload['agent_kind']) && is_string($payload['agent_kind'])
        ? trim($payload['agent_kind'])
        : '';
    $name = isset($payload['name']) && is_string($payload['name']) ? trim($payload['name']) : '';
    $description = isset($payload['description']) && is_string($payload['description'])
        ? trim($payload['description'])
        : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    PlannerAgentRegister::add($agent_kind, $name, $description, $extras);
};
