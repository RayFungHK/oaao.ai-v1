<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * OpenAPI tool servers — modules register via {@code tool_server.register}.
 *
 * Consumed by chat send payload → orchestrator {@code tool_servers[]}.
 */
final class ToolServerRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $servers = [];

    /** @param array<string, mixed> $extras */
    public static function add(
        string $server_id,
        string $base_url,
        string $label = '',
        array $extras = [],
    ): void {
        $server_id = trim($server_id);
        $base_url = trim($base_url);
        if ($server_id === '' || $base_url === '') {
            return;
        }

        $row = [
            'id'        => $server_id,
            'base_url'  => $base_url,
            'label'     => $label !== '' ? $label : $server_id,
        ];

        if (isset($extras['openapi_url']) && is_string($extras['openapi_url'])) {
            $row['openapi_url'] = trim($extras['openapi_url']);
        }
        if (isset($extras['allowed_purposes']) && is_array($extras['allowed_purposes'])) {
            $row['allowed_purposes'] = array_values(array_filter(
                array_map(static fn ($p) => is_string($p) ? trim($p) : '', $extras['allowed_purposes']),
                static fn ($p) => $p !== '',
            ));
        }
        if (isset($extras['openapi_spec']) && is_array($extras['openapi_spec'])) {
            $row['openapi_spec'] = $extras['openapi_spec'];
        }

        self::$servers[$server_id] = $row;
    }

    /** @return list<array<string, mixed>> */
    public static function allSorted(): array
    {
        $rows = array_values(self::$servers);
        usort($rows, static fn ($a, $b) => strcmp((string) ($a['id'] ?? ''), (string) ($b['id'] ?? '')));

        return $rows;
    }
}
