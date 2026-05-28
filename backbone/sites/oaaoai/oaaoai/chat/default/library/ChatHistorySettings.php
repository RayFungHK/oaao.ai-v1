<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Chat thread lazy-load page size (UI) and orchestrator prompt history (server DB only).
 *
 * Tenant administrators configure defaults via Settings → Chat → General
 * ({@code oaao_tenant.limits_json.chat}). End users do not override these values.
 */
final class ChatHistorySettings
{
    public const MIN_PAGE_SIZE = 3;

    public const MAX_PAGE_SIZE = 10;

    public const DEFAULT_PAGE_SIZE = 5;

    public const DEFAULT_PROMPT_MESSAGE_LIMIT = 60;

    public const MAX_PROMPT_MESSAGE_LIMIT = 120;

    public const MAX_PROMPT_CONTENT_CHARS = 12000;

    public static function clampPageSize(int $value): int
    {
        return max(self::MIN_PAGE_SIZE, min(self::MAX_PAGE_SIZE, $value));
    }

    public static function clampPromptMessageLimit(int $value): int
    {
        return max(self::MIN_PAGE_SIZE, min(self::MAX_PROMPT_MESSAGE_LIMIT, $value));
    }

    public static function promptMessageLimit(): int
    {
        $raw = getenv('OAAO_CHAT_PROMPT_MESSAGE_LIMIT');
        if ($raw === false || trim((string) $raw) === '') {
            return self::DEFAULT_PROMPT_MESSAGE_LIMIT;
        }
        $n = (int) $raw;

        return self::clampPromptMessageLimit($n);
    }

    /**
     * @return array{history_page_size: int, prompt_message_limit: int}
     */
    public static function resolveTenantChatConfig(\PDO $pdo, ?int $tenantId = null): array
    {
        $pageSize = self::DEFAULT_PAGE_SIZE;
        $promptLimit = self::promptMessageLimit();
        $autoCompactPct = ChatContextUsage::DEFAULT_AUTO_COMPACT_THRESHOLD_PCT;

        if ($tenantId === null || $tenantId < 1) {
            require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';

            $tenantId = \Oaaoai\Core\TenantContext::id();
        }

        if ($tenantId < 1) {
            return [
                'history_page_size'            => $pageSize,
                'prompt_message_limit'         => $promptLimit,
                'auto_compact_threshold_pct'     => $autoCompactPct,
            ];
        }

        // Tenant limits live on PostgreSQL canonical DB — adjunct SQLite has no oaao_tenant.
        try {
            if ($pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
                return [
                    'history_page_size'            => $pageSize,
                    'prompt_message_limit'         => $promptLimit,
                    'auto_compact_threshold_pct'     => $autoCompactPct,
                ];
            }

            $stmt = $pdo->prepare('SELECT limits_json FROM oaao_tenant WHERE tenant_id = ? LIMIT 1');
            $stmt->execute([$tenantId]);
            $raw = $stmt->fetchColumn();
        } catch (\PDOException) {
            return [
                'history_page_size'            => $pageSize,
                'prompt_message_limit'         => $promptLimit,
                'auto_compact_threshold_pct'     => $autoCompactPct,
            ];
        }

        if (! \is_string($raw) || trim($raw) === '') {
            return [
                'history_page_size'            => $pageSize,
                'prompt_message_limit'         => $promptLimit,
                'auto_compact_threshold_pct'     => $autoCompactPct,
            ];
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [
                'history_page_size'            => $pageSize,
                'prompt_message_limit'         => $promptLimit,
                'auto_compact_threshold_pct'     => $autoCompactPct,
            ];
        }

        if (! \is_array($decoded)) {
            return [
                'history_page_size'            => $pageSize,
                'prompt_message_limit'         => $promptLimit,
                'auto_compact_threshold_pct'     => $autoCompactPct,
            ];
        }

        $chat = $decoded['chat'] ?? null;
        if (\is_array($chat)) {
            if (isset($chat['history_page_size'])) {
                $pageSize = self::clampPageSize((int) $chat['history_page_size']);
            }
            if (isset($chat['prompt_message_limit'])) {
                $promptLimit = self::clampPromptMessageLimit((int) $chat['prompt_message_limit']);
            }
            if (isset($chat['auto_compact_threshold_pct'])) {
                $autoCompactPct = max(50, min(98, (int) $chat['auto_compact_threshold_pct']));
            }
        }

        return [
            'history_page_size'            => $pageSize,
            'prompt_message_limit'         => $promptLimit,
            'auto_compact_threshold_pct'   => $autoCompactPct,
        ];
    }

    /**
     * @param array{history_page_size?: int, prompt_message_limit?: int} $patch
     * @return array{history_page_size: int, prompt_message_limit: int}
     */
    public static function saveTenantChatConfig(\PDO $pdo, int $tenantId, array $patch): array
    {
        if ($tenantId < 1) {
            return self::resolveTenantChatConfig($pdo, $tenantId);
        }

        $current = self::resolveTenantChatConfig($pdo, $tenantId);
        if (isset($patch['history_page_size'])) {
            $current['history_page_size'] = self::clampPageSize((int) $patch['history_page_size']);
        }
        if (isset($patch['prompt_message_limit'])) {
            $current['prompt_message_limit'] = self::clampPromptMessageLimit((int) $patch['prompt_message_limit']);
        }

        $limits = [];
        $stmt = $pdo->prepare('SELECT limits_json FROM oaao_tenant WHERE tenant_id = ? LIMIT 1');
        $stmt->execute([$tenantId]);
        $raw = $stmt->fetchColumn();
        if (\is_string($raw) && trim($raw) !== '') {
            try {
                $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($decoded)) {
                    $limits = $decoded;
                }
            } catch (\JsonException) {
                $limits = [];
            }
        }

        if (! isset($limits['chat']) || ! \is_array($limits['chat'])) {
            $limits['chat'] = [];
        }
        $limits['chat']['history_page_size'] = $current['history_page_size'];
        $limits['chat']['prompt_message_limit'] = $current['prompt_message_limit'];

        $json = json_encode($limits, JSON_UNESCAPED_UNICODE);
        $pdo->prepare('UPDATE oaao_tenant SET limits_json = ?, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = ?')
            ->execute([$json, $tenantId]);

        return $current;
    }

    public static function resolvePageSizeForUser(\PDO $pdo, int $userId): int
    {
        unset($userId);

        return (int) (self::resolveTenantChatConfig($pdo)['history_page_size'] ?? self::DEFAULT_PAGE_SIZE);
    }

    public static function resolvePromptMessageLimit(\PDO $pdo): int
    {
        return (int) (self::resolveTenantChatConfig($pdo)['prompt_message_limit'] ?? self::promptMessageLimit());
    }

    public static function truncatePromptContent(string $content): string
    {
        if ($content === '') {
            return '';
        }
        if (\strlen($content) <= self::MAX_PROMPT_CONTENT_CHARS) {
            return $content;
        }

        return substr($content, 0, self::MAX_PROMPT_CONTENT_CHARS);
    }

    /**
     * Latest {@code $limit} messages for orchestrator — authoritative server memory, not UI cache.
     *
     * @return list<array{role: string, content: string}>
     */
    public static function buildPromptMessagesFromDb(\Razy\Database $splitDb, int $conversationId, ?int $limit = null, ?\PDO $canonPdo = null): array
    {
        if ($conversationId < 1) {
            return [];
        }

        $lim = $limit;
        if ($lim === null) {
            $lim = $canonPdo instanceof \PDO
                ? self::resolvePromptMessageLimit($canonPdo)
                : self::promptMessageLimit();
        }
        $lim = max(1, min(self::MAX_PROMPT_MESSAGE_LIMIT, $lim));

        require_once __DIR__ . '/ChatContextUsage.php';

        $histRaw = $splitDb->prepare()
            ->select('role, content, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $conversationId])
            ->order('-id')
            ->limit($lim * 2)
            ->query()
            ->fetchAll();

        /** @var list<array{role: string, content: string, meta_json?: string|null}> $rowsDesc */
        $rowsDesc = \is_array($histRaw) ? $histRaw : [];
        $rowsDesc = \array_reverse($rowsDesc);

        $messages = [];
        foreach ($rowsDesc as $r) {
            if (! \is_array($r)) {
                continue;
            }
            $metaJson = isset($r['meta_json']) ? (string) $r['meta_json'] : null;
            if (ChatContextUsage::messagePromptSuperseded($metaJson)) {
                continue;
            }
            $role = strtolower(trim((string) ($r['role'] ?? '')));
            if (! \in_array($role, ['system', 'user', 'assistant'], true)) {
                continue;
            }
            $c = self::truncatePromptContent((string) ($r['content'] ?? ''));
            if ($c === '' && $role === 'assistant') {
                continue;
            }
            $messages[] = ['role' => $role, 'content' => $c];
            if (\count($messages) >= $lim) {
                break;
            }
        }

        return $messages;
    }

    /**
     * @return array<string, mixed>
     */
    public static function publicLimitsPayload(int $historyPageSize, ?int $promptLimit = null): array
    {
        $pl = $promptLimit ?? self::promptMessageLimit();

        return [
            'history_page_size'         => self::clampPageSize($historyPageSize),
            'history_page_size_min'     => self::MIN_PAGE_SIZE,
            'history_page_size_max'     => self::MAX_PAGE_SIZE,
            'history_page_size_default' => self::DEFAULT_PAGE_SIZE,
            'prompt_message_limit'      => self::clampPromptMessageLimit($pl),
            'prompt_message_limit_min'  => self::MIN_PAGE_SIZE,
            'prompt_message_limit_max'  => self::MAX_PROMPT_MESSAGE_LIMIT,
            'prompt_content_max_chars'  => self::MAX_PROMPT_CONTENT_CHARS,
            'prompt_source'             => 'server_db',
            'config_scope'              => 'tenant_admin',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function publicLimitsPayloadFromConfig(array $config): array
    {
        return self::publicLimitsPayload(
            (int) ($config['history_page_size'] ?? self::DEFAULT_PAGE_SIZE),
            (int) ($config['prompt_message_limit'] ?? self::promptMessageLimit()),
        );
    }
}
