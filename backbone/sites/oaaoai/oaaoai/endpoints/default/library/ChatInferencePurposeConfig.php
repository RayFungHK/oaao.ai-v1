<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use oaaoai\chat\ChatOrchestratorBootstrap;
use oaaoai\user\UserModelParams;
use Razy\Database;

/**
 * Chat purpose / profile inference defaults under {@code meta_json.inference_params}.
 */
final class ChatInferencePurposeConfig
{
    /**
     * @return array<string, mixed>
     */
    public static function decodePurposeMeta(mixed $metaJson): array
    {
        if (\is_array($metaJson)) {
            return $metaJson;
        }
        if (! \is_string($metaJson) || trim($metaJson) === '') {
            return [];
        }
        try {
            $dec = json_decode(trim($metaJson), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return \is_array($dec) ? $dec : [];
    }

    /**
     * @param array<string, mixed>|null $meta
     *
     * @return array<string, int|float|null>
     */
    public static function paramsFromMeta(?array $meta): array
    {
        $root = ($meta !== null && $meta !== []) ? $meta : [];
        $block = \is_array($root['inference_params'] ?? null) ? $root['inference_params'] : [];
        if ($block === []) {
            return [];
        }

        return UserModelParams::normalize($block);
    }

    /**
     * @param array<string, mixed> $existing
     * @param array<string, mixed> $patch
     *
     * @return array<string, mixed>
     */
    public static function mergeParamsIntoMeta(array $existing, array $patch): array
    {
        $existing['inference_params'] = UserModelParams::normalize(
            array_merge(self::paramsFromMeta($existing), UserModelParams::normalize($patch)),
        );

        return $existing;
    }

    /**
     * Purpose {@code chat.*} row + optional chat completion profile binding.
     *
     * @return array<string, int|float>
     */
    public static function resolveDefaultsForChatEndpoint(Database $canonicalDb, int $chatEndpointId): array
    {
        $out = [];
        $repo = new CanonicalEndpointsRepository($canonicalDb);
        $row = $repo->findChatPurposeRowForSettings();
        if ($row !== null) {
            $meta = self::decodePurposeMeta($row['meta_json'] ?? null);
            $out = UserModelParams::activeOverrides(self::paramsFromMeta($meta));
        }

        if ($chatEndpointId > 0) {
            $binding = ChatOrchestratorBootstrap::resolveBindingForProfile($canonicalDb, $chatEndpointId);
            if (\is_array($binding)) {
                if (isset($binding['temperature']) && is_numeric($binding['temperature'])) {
                    $out['temperature'] = (float) $binding['temperature'];
                }
                if (isset($binding['max_tokens']) && is_numeric($binding['max_tokens'])) {
                    $out['max_tokens'] = (int) $binding['max_tokens'];
                }
            }
        }

        return $out;
    }
}
