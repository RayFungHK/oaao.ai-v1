<?php

declare(strict_types=1);

namespace Oaaoai\Core;

/** Blob domain keys stored in {@code oaao_tenant.storage_json.domains}. */
final class StorageDomain
{
    public const VAULT = 'vault';

    public const CHAT_ATTACHMENTS = 'chat_attachments';

    public const SLIDE_PROJECTS = 'slide_projects';

    public const SLIDE_TEMPLATES = 'slide_templates';

    public const LIVE_MEETING = 'live_meeting';

    public const MINE = 'mine';

    public const AGENT_MATERIALS = 'agent_materials';

    /** @return list<string> */
    public static function all(): array
    {
        return [
            self::VAULT,
            self::CHAT_ATTACHMENTS,
            self::SLIDE_PROJECTS,
            self::SLIDE_TEMPLATES,
            self::LIVE_MEETING,
            self::MINE,
            self::AGENT_MATERIALS,
        ];
    }

    public static function isValid(string $domain): bool
    {
        return \in_array($domain, self::all(), true);
    }

    public static function defaultLocalRoot(string $domain): string
    {
        return match ($domain) {
            self::VAULT => self::envRoot('OAAO_VAULT_STORAGE', '/var/www/html/storage/vault'),
            self::CHAT_ATTACHMENTS => self::chatAttachmentRoot(),
            self::SLIDE_PROJECTS => self::envRoot('OAAO_SLIDE_PROJECT_ROOT', self::authDataRoot() . '/slide-projects'),
            self::SLIDE_TEMPLATES => self::envRoot('OAAO_SLIDE_TEMPLATE_CUSTOM_ROOT', self::authDataRoot() . '/slide-templates/custom'),
            self::LIVE_MEETING => self::envRoot('OAAO_LIVE_MEETING_ROOT', self::authDataRoot() . '/live-meeting'),
            self::MINE => self::envRoot('OAAO_MINE_DATA_ROOT', '/var/www/html/storage/mine'),
            self::AGENT_MATERIALS => self::envRoot('OAAO_AGENT_MATERIAL_ROOT', self::authDataRoot() . '/agent-materials'),
            default => self::envRoot('OAAO_VAULT_STORAGE', '/var/www/html/storage/vault'),
        };
    }

    private static function envRoot(string $envKey, string $fallback): string
    {
        $env = getenv($envKey);
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/\\');
        }

        return rtrim($fallback, '/\\');
    }

    private static function authDataRoot(): string
    {
        $data = getenv('OAAO_AUTH_SQLITE_PATH');
        if (\is_string($data) && trim($data) !== '') {
            return dirname(trim($data));
        }

        return dirname(__DIR__, 4) . '/data';
    }

    private static function chatAttachmentRoot(): string
    {
        $env = getenv('OAAO_CHAT_ATTACHMENT_ROOT');
        if (\is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/\\');
        }

        return self::authDataRoot() . '/chat-attachments';
    }
}
