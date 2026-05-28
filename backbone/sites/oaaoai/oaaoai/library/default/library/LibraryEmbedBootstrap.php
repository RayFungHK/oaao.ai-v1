<?php

declare(strict_types=1);

namespace oaaoai\library;

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\LlmOrchestratorPayload;
use Razy\Controller;
use Razy\Database;

/**
 * Resolve embedding binding for Library Soft-RAG (CS-2-S7).
 */
final class LibraryEmbedBootstrap
{
    /**
     * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
     */
    public static function resolveEmbedding(Controller $controller): ?array
    {
        $auth = $controller->api('auth');
        $db = $auth ? $auth->getDB() : null;
        if (! $db instanceof Database) {
            return null;
        }

        $repo = new CanonicalEndpointsRepository($db, $controller->api('core'));
        $bind = $repo->resolveVaultIngestEmbeddingBinding();

        return LlmOrchestratorPayload::fromBinding($bind, $controller->api('chat'));
    }

    /**
     * @param array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null $emb
     *
     * @return array<string, mixed>|null
     */
    public static function embeddingCfgForPayload(?array $emb): ?array
    {
        if ($emb === null) {
            return null;
        }

        return [
            'purpose_key' => (string) ($emb['purpose_key'] ?? ''),
            'base_url'    => (string) ($emb['base_url'] ?? ''),
            'model'       => (string) ($emb['model'] ?? ''),
            'api_key_env' => $emb['api_key_env'] ?? null,
        ];
    }
}
