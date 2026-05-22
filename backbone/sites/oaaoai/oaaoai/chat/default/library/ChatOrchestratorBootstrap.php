<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\endpoints\CanonicalEndpointsRepository;
use Razy\Database;

/**
 * Resolves default chat completion profile + bound {@code oaao_endpoint} row for sidecar runs (PHP → JSON → Python).
 *
 * Roadmap: endpoint/provider typing beyond OpenAI-compatible {@code base_url} + {@code model} + optional env-bound key
 * may later align with Open Web UI–style supported connection types (same mental model for admins).
 */
final class ChatOrchestratorBootstrap
{
    /**
     * @return array{profile: array<string, mixed>, endpoint: array<string, mixed>, endpoint_id: int, temperature: float, max_tokens?: int}|null
     */
    public static function resolveDefaultBinding(Database $canonicalDb): ?array
    {
        $repo = new ChatEndpointsRepository($canonicalDb);
        $profiles = $repo->listProfiles();
        if ($profiles === []) {
            return null;
        }

        $picked = null;
        foreach ($profiles as $p) {
            if (! \is_array($p)) {
                continue;
            }
            if ((int) ($p['is_enabled'] ?? 1) !== 1) {
                continue;
            }
            if ((int) ($p['is_default'] ?? 0) === 1) {
                $picked = $p;

                break;
            }
        }
        if ($picked === null) {
            foreach ($profiles as $p) {
                if (\is_array($p) && (int) ($p['is_enabled'] ?? 1) === 1) {
                    $picked = $p;

                    break;
                }
            }
        }
        if (! \is_array($picked)) {
            return null;
        }

        return self::bindingFromProfileRow($canonicalDb, $picked);
    }

    /**
     * Resolve binding for a specific chat completion profile id ({@code oaao_chat_endpoint.id}).
     *
     * @return array{profile: array<string, mixed>, endpoint: array<string, mixed>, endpoint_id: int, temperature: float, max_tokens?: int}|null
     */
    public static function resolveBindingForProfile(Database $canonicalDb, int $profileId): ?array
    {
        if ($profileId < 1) {
            return null;
        }

        $repo = new ChatEndpointsRepository($canonicalDb);
        foreach ($repo->listProfiles() as $p) {
            if (! \is_array($p)) {
                continue;
            }
            if ((int) ($p['id'] ?? 0) !== $profileId) {
                continue;
            }
            if ((int) ($p['is_enabled'] ?? 1) !== 1) {
                return null;
            }

            return self::bindingFromProfileRow($canonicalDb, $p);
        }

        return null;
    }

    /**
     * @param array<string, mixed> $picked profile row from {@see ChatEndpointsRepository::listProfiles()}
     *
     * @return array{profile: array<string, mixed>, endpoint: array<string, mixed>, endpoint_id: int, temperature: float, max_tokens?: int}|null
     */
    private static function bindingFromProfileRow(Database $canonicalDb, array $picked): ?array
    {
        $type = strtolower(trim((string) ($picked['type'] ?? 'single')));
        $llms = isset($picked['llms']) && \is_array($picked['llms']) ? $picked['llms'] : [];

        $endpointId = self::pickEndpointIdForType($type, $llms);
        if ($endpointId < 1) {
            return null;
        }

        $canon = new CanonicalEndpointsRepository($canonicalDb);
        $endpoint = $canon->getEndpointById($endpointId);
        if ($endpoint === null || (int) ($endpoint['is_enabled'] ?? 1) !== 1) {
            return null;
        }

        $temperature = 0.7;
        $maxTokens = null;
        $cfgRaw = trim((string) ($picked['config_json'] ?? ''));
        if ($cfgRaw !== '') {
            try {
                /** @var mixed $cfg */
                $cfg = json_decode($cfgRaw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($cfg)) {
                    if (isset($cfg['temperature']) && is_numeric($cfg['temperature'])) {
                        $temperature = (float) $cfg['temperature'];
                    }
                    $maxTokens = self::parseMaxTokensFromConfig($cfg) ?? $maxTokens;
                }
            } catch (\Throwable) {
                /* ignore */
            }
        }
        $temperature = max(0.0, min(2.0, $temperature));

        $epCfgRaw = trim((string) ($endpoint['config_json'] ?? ''));
        if ($epCfgRaw !== '') {
            try {
                /** @var mixed $epCfg */
                $epCfg = json_decode($epCfgRaw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($epCfg)) {
                    $epMax = self::parseMaxTokensFromConfig($epCfg);
                    if ($epMax !== null) {
                        $maxTokens = $epMax;
                    }
                }
            } catch (\Throwable) {
                /* ignore */
            }
        }

        $out = [
            'profile'     => $picked,
            'endpoint'    => $endpoint,
            'endpoint_id' => $endpointId,
            'temperature' => $temperature,
        ];
        if ($maxTokens !== null && $maxTokens > 0) {
            $out['max_tokens'] = $maxTokens;
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $cfg decoded config_json
     */
    private static function parseMaxTokensFromConfig(array $cfg): ?int
    {
        if (! isset($cfg['max_tokens']) || ! is_numeric($cfg['max_tokens'])) {
            return null;
        }
        $mt = (int) $cfg['max_tokens'];

        return $mt > 0 ? min($mt, 128_000) : null;
    }

    /**
     * @param list<array<string, mixed>> $llms
     */
    private static function pickEndpointIdForType(string $type, array $llms): int
    {
        $order = ($type === 'tree' || $type === 'tot' || $type === 'thought_tree')
            ? ['hint', 'expand', 'judge']
            : (($type === 'ddtree' || $type === 'dd_tree') ? ['hint', 'expand', 'judge'] : ['default']);

        foreach ($order as $wantRole) {
            foreach ($llms as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $role = strtolower(trim((string) ($row['role'] ?? '')));
                if ($role !== $wantRole) {
                    continue;
                }
                $eid = (int) ($row['endpoint_id'] ?? 0);
                if ($eid > 0) {
                    return $eid;
                }
            }
        }

        return 0;
    }

    /**
     * Map {@code api_key_ref} column to an environment variable name consumed by the Python sidecar (never ship plaintext keys).
     */
    public static function inferApiKeyEnv(?string $apiKeyRef): ?string
    {
        $ref = trim((string) $apiKeyRef);
        if ($ref === '') {
            return 'OPENAI_API_KEY';
        }
        if (preg_match('/^env:([A-Za-z][A-Za-z0-9_]*)$/', $ref, $m)) {
            return $m[1];
        }

        return null;
    }
}
