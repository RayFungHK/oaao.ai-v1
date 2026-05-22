<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

use oaaoai\chat\ChatOrchestratorBootstrap;
use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * Resolve slide-template LLM from {@code oaao_purpose} ({@code slide_template.*}) — not chat profiles.
 */
final class SlideTemplateLlm
{
    public static function isAnalyzeConfigured(?\Razy\Database $canonDb): bool
    {
        return self::resolveAnalyzePayload($canonDb) !== null;
    }

    /**
     * @return array<string, mixed>|null orchestrator endpoint payload
     */
    public static function resolveAnalyzePayload(?\Razy\Database $canonDb): ?array
    {
        if (! $canonDb instanceof \Razy\Database) {
            return null;
        }

        $binding = (new CanonicalEndpointsRepository($canonDb))->resolveSlideTemplateAnalyzeBinding();
        if ($binding === null) {
            return null;
        }

        $bu = trim((string) ($binding['base_url'] ?? ''));
        $model = trim((string) ($binding['model'] ?? ''));
        if ($bu === '' || $model === '') {
            return null;
        }

        return [
            'endpoint_ref' => trim((string) ($binding['purpose_key'] ?? 'slide_template')),
            'base_url'     => $bu,
            'model'        => $model,
            'api_key_env'  => ChatOrchestratorBootstrap::inferApiKeyEnv(
                isset($binding['api_key_ref']) ? (string) $binding['api_key_ref'] : null
            ),
        ];
    }
}
