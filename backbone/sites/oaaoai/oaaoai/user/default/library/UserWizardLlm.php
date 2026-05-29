<?php

declare(strict_types=1);

namespace oaaoai\user;

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\LlmOrchestratorPayload;
use Razy\Controller;
use Razy\Database;

/**
 * Resolve planning/chat LLM binding for personalization survey wizard (UX-1).
 */
final class UserWizardLlm
{
    /**
     * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
     */
    public static function resolveWizardLlm(Controller $controller): ?array
    {
        $auth = $controller->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return null;
        }

        $repo = new CanonicalEndpointsRepository($db, $controller->api('core'));
        $bind = $repo->resolvePlanningBinding();

        return LlmOrchestratorPayload::fromBinding($bind, $controller->api('chat'));
    }

    /**
     * @param array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null $llm
     *
     * @return array<string, mixed>|null
     */
    public static function llmCfgForPayload(?array $llm): ?array
    {
        if ($llm === null) {
            return null;
        }

        return [
            'purpose_key' => (string) ($llm['purpose_key'] ?? ''),
            'base_url'    => (string) ($llm['base_url'] ?? ''),
            'model'       => (string) ($llm['model'] ?? ''),
            'api_key_env' => $llm['api_key_env'] ?? null,
        ];
    }
}
