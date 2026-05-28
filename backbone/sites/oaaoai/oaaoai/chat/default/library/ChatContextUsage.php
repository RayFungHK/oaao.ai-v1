<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Oaaoai\Core\OaaoRepoPaths;
use oaaoai\endpoints\ChatAllowedAgentsPurposeConfig;
use oaaoai\endpoints\FeatureRegistryBootstrap;
use oaaoai\endpoints\ToolServerRegister;
use oaaoai\user\UserPersonalization;

/**
 * Conversation context budget estimates for the chat toolbar (Cursor-style usage panel).
 */
final class ChatContextUsage
{
    public const DEFAULT_CONTEXT_TOKENS = 200_000;

    public const DEFAULT_AUTO_COMPACT_THRESHOLD_PCT = 82;

    public static function estimateTokens(string $text, ?string $tokenizerProfile = null): int
    {
        return ChatTokenEstimator::estimateTokens($text, $tokenizerProfile);
    }

    /**
     * @param mixed $payload
     */
    public static function estimateJsonTokens(mixed $payload, ?string $tokenizerProfile = null): int
    {
        return ChatTokenEstimator::estimateJsonTokens($payload, $tokenizerProfile);
    }

    public static function messagePromptSuperseded(?string $metaJson): bool
    {
        if ($metaJson === null || trim($metaJson) === '') {
            return false;
        }
        try {
            $meta = json_decode($metaJson, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }

        return \is_array($meta) && ! empty($meta['prompt_superseded']);
    }

    public static function messageIsCitCmtHandoff(?string $metaJson): bool
    {
        if ($metaJson === null || trim($metaJson) === '') {
            return false;
        }
        try {
            $meta = json_decode($metaJson, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }

        return \is_array($meta) && ! empty($meta['fork_cit_cmt']);
    }

    public static function autoCompactThresholdPct(?\PDO $canonPdo = null): int
    {
        $raw = getenv('OAAO_CHAT_AUTO_COMPACT_THRESHOLD_PCT');
        if ($raw !== false && trim((string) $raw) !== '') {
            $n = (int) $raw;

            return max(50, min(98, $n));
        }

        if ($canonPdo instanceof \PDO) {
            $cfg = ChatHistorySettings::resolveTenantChatConfig($canonPdo);
            $n = (int) ($cfg['auto_compact_threshold_pct'] ?? self::DEFAULT_AUTO_COMPACT_THRESHOLD_PCT);

            return max(50, min(98, $n));
        }

        return self::DEFAULT_AUTO_COMPACT_THRESHOLD_PCT;
    }

    /**
     * @param array<string, mixed> $usage {@see usageReport}
     */
    public static function shouldAutoCompactBeforeSend(
        array $usage,
        int $contextLimitTokens,
        int $outputReserveTokens,
        ?\PDO $canonPdo = null,
    ): bool {
        if (empty($usage['can_compact'])) {
            return false;
        }
        $used = (int) ($usage['used_tokens'] ?? 0);
        $limit = max(8_192, $contextLimitTokens);
        $projected = $used + max(0, $outputReserveTokens);
        $pct = (int) round(($projected / $limit) * 100);
        $threshold = self::autoCompactThresholdPct($canonPdo);

        return $pct >= $threshold;
    }

    /**
     * @param array{profile: array<string, mixed>, endpoint: array<string, mixed>, max_tokens?: int}|null $binding
     */
    public static function resolveContextLimitFromBinding(?array $binding): int
    {
        if ($binding === null) {
            return self::DEFAULT_CONTEXT_TOKENS;
        }
        $merged = [];
        $epRaw = trim((string) ($binding['endpoint']['config_json'] ?? ''));
        if ($epRaw !== '') {
            try {
                $dec = json_decode($epRaw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($dec)) {
                    $merged = $dec;
                }
            } catch (\JsonException) {
                /* ignore */
            }
        }
        $profRaw = trim((string) ($binding['profile']['config_json'] ?? ''));
        if ($profRaw !== '') {
            try {
                $dec = json_decode($profRaw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($dec)) {
                    $merged = array_merge($merged, $dec);
                }
            } catch (\JsonException) {
                /* ignore */
            }
        }

        return self::resolveContextLimitTokens($merged);
    }

    public static function outputReserveTokens(?array $binding, int $contextLimitTokens): int
    {
        $maxOut = 0;
        if ($binding !== null && isset($binding['max_tokens'])) {
            $maxOut = (int) $binding['max_tokens'];
        }
        if ($maxOut > 0) {
            return $maxOut;
        }

        return max(512, (int) round($contextLimitTokens * 0.12));
    }

    /**
     * Live overhead buckets aligned with orchestrator send payload sizing.
     *
     * @return array<string, int>
     */
    public static function measureOverheadTokens(
        \Razy\Controller $controller,
        int $userId,
        ?int $workspaceId,
        ?\PDO $splitPdo = null,
        ?\PDO $canonPdo = null,
        ?string $plannerModeId = 'default',
        ?string $tokenizerProfile = null,
    ): array {
        try {
            FeatureRegistryBootstrap::collect($controller);
        } catch (\Throwable) {
            /* registry optional for usage estimate */
        }

        $system = 0;
        $repoRoot = OaaoRepoPaths::root();
        $paths = [
            $repoRoot . '/docker/polish-templates/turn_agent_intent.md',
            $repoRoot . '/python/materials/prompts/planning/turn_agent_intent.md',
        ];
        foreach ($paths as $path) {
            if (is_readable($path)) {
                $system += self::estimateTokens((string) file_get_contents($path), $tokenizerProfile);
                break;
            }
        }
        if ($system < 1) {
            $system = 400;
        }

        if ($canonPdo instanceof \PDO && $userId > 0) {
            try {
                $pers = UserPersonalization::forOrchestratorPayload(
                    UserPersonalization::loadForUser($canonPdo, $userId),
                );
                $system += self::estimateJsonTokens($pers, $tokenizerProfile);
            } catch (\Throwable) {
                /* personalization optional */
            }
        }

        $toolServers = [];
        $endpointsApi = $controller->api('endpoints');
        if ($endpointsApi && \method_exists($endpointsApi, 'getToolServerRegistry')) {
            $toolServers = $endpointsApi->getToolServerRegistry();
        } else {
            $toolServers = ToolServerRegister::allSorted();
        }

        $mcpRows = [];
        $toolOnly = [];
        foreach ($toolServers as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $id = strtolower((string) ($row['id'] ?? ''));
            if (str_contains($id, 'mcp') || str_contains($id, 'model-context')) {
                $mcpRows[] = $row;
            } else {
                $toolOnly[] = $row;
            }
        }

        $toolDefs = self::estimateJsonTokens($toolOnly, $tokenizerProfile);
        $mcp = self::estimateJsonTokens($mcpRows, $tokenizerProfile);

        $hotPlug = SkillsManifestStorage::enabledForPurpose('chat');
        $skillsTok = self::estimateJsonTokens($hotPlug, $tokenizerProfile);

        $microTok = 0;
        if ($splitPdo instanceof \PDO && $userId > 0) {
            try {
                $authApi = $controller->api('auth');
                $slideDesignerApi = $controller->api('slide-designer');
                $microTok = self::estimateJsonTokens(
                    MicroSkillCatalog::forPlanner(
                        $splitPdo,
                        (object) ['user_id' => $userId],
                        $authApi,
                        $userId,
                        $workspaceId,
                        null,
                        $controller,
                        $slideDesignerApi,
                    ),
                    $tokenizerProfile,
                );
            } catch (\Throwable) {
                $microTok = 0;
            }
        }
        $skillsTok += $microTok;

        $rules = 0;
        if ($canonPdo instanceof \PDO && $userId > 0) {
            $norm = UserPersonalization::loadForUser($canonPdo, $userId);
            if (! empty($norm['use_knowledge_in_chat'])) {
                $rules += self::estimateTokens((string) ($norm['custom_instructions'] ?? ''), $tokenizerProfile);
                $rules += self::estimateTokens((string) ($norm['knowledge'] ?? ''), $tokenizerProfile);
            }
        }
        $crystPath = CrystallizedSkillsStorage::configPath();
        if (is_readable($crystPath)) {
            $rules += self::estimateTokens((string) file_get_contents($crystPath), $tokenizerProfile);
        }

        $allowed = ChatAllowedAgentsPurposeConfig::defaultAllowed();
        $subagents = self::estimateJsonTokens(
            PlannerAgentRegister::catalogForAllowed($allowed),
            $tokenizerProfile,
        );

        return [
            'system_prompt'        => $system,
            'tool_definitions'     => $toolDefs,
            'rules'                => $rules,
            'skills'               => $skillsTok,
            'mcp'                  => $mcp,
            'subagent_definitions' => $subagents,
        ];
    }

    /**
     * @param array<string, int>|null $overheadTokens
     *
     * @return array<string, mixed>
     */
    public static function usageReport(
        \Razy\Database $splitDb,
        int $conversationId,
        int $contextLimitTokens,
        int $promptMessageLimit,
        ?array $overheadTokens = null,
        ?\PDO $canonPdo = null,
        ?string $tokenizerProfile = null,
    ): array {
        $rows = $splitDb->prepare()
            ->select('id, role, content, meta_json')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $conversationId])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        $conversationTokens = 0;
        $summarizedTokens = 0;
        $activeCount = 0;
        $supersededCount = 0;
        $totalCount = 0;

        if (\is_array($rows)) {
            foreach ($rows as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $totalCount++;
                $role = strtolower(trim((string) ($row['role'] ?? '')));
                if (! \in_array($role, ['user', 'assistant', 'system'], true)) {
                    continue;
                }
                $metaJson = isset($row['meta_json']) ? (string) $row['meta_json'] : null;
                if (self::messagePromptSuperseded($metaJson)) {
                    $supersededCount++;

                    continue;
                }
                $activeCount++;
                $tok = self::estimateTokens((string) ($row['content'] ?? ''), $tokenizerProfile);
                if (self::messageIsCitCmtHandoff($metaJson)) {
                    $summarizedTokens += $tok;
                } else {
                    $conversationTokens += $tok;
                }
            }
        }

        $oh = $overheadTokens ?? [];
        $segments = [
            [
                'key'    => 'system_prompt',
                'label'  => 'System prompt',
                'tokens' => (int) ($oh['system_prompt'] ?? 0),
            ],
            [
                'key'    => 'tool_definitions',
                'label'  => 'Tool definitions',
                'tokens' => (int) ($oh['tool_definitions'] ?? 0),
            ],
            [
                'key'    => 'rules',
                'label'  => 'Rules',
                'tokens' => (int) ($oh['rules'] ?? 0),
            ],
            [
                'key'    => 'skills',
                'label'  => 'Skills',
                'tokens' => (int) ($oh['skills'] ?? 0),
            ],
            [
                'key'    => 'mcp',
                'label'  => 'MCP',
                'tokens' => (int) ($oh['mcp'] ?? 0),
            ],
            [
                'key'    => 'subagent_definitions',
                'label'  => 'Subagent definitions',
                'tokens' => (int) ($oh['subagent_definitions'] ?? 0),
            ],
            [
                'key'    => 'summarized_conversation',
                'label'  => 'Summarized conversation',
                'tokens' => $summarizedTokens,
            ],
            [
                'key'    => 'conversation',
                'label'  => 'Conversation',
                'tokens' => $conversationTokens,
            ],
        ];

        $used = 0;
        foreach ($segments as $seg) {
            $used += (int) ($seg['tokens'] ?? 0);
        }

        $limit = max(8_192, $contextLimitTokens);
        $percent = $limit > 0 ? min(100, (int) round(($used / $limit) * 100)) : 0;

        return [
            'context_limit_tokens'       => $limit,
            'used_tokens'                => $used,
            'percent_full'               => $percent,
            'segments'                   => $segments,
            'message_count_total'        => $totalCount,
            'message_count_active'       => $activeCount,
            'message_count_superseded'   => $supersededCount,
            'prompt_message_limit'       => $promptMessageLimit,
            'can_compact'                => $activeCount > 6,
            'auto_compact_threshold_pct' => self::autoCompactThresholdPct($canonPdo),
            'overhead_measured_live'     => $overheadTokens !== null,
            'tokenizer_profile'          => $tokenizerProfile ?? ChatTokenEstimator::PROFILE_DEFAULT,
            'tokenizer_method'           => 'chars_per_token_heuristic',
        ];
    }

    public static function resolveContextLimitTokens(?array $configRow): int
    {
        if (\is_array($configRow)) {
            foreach (['max_model_len', 'max_context_tokens', 'context_length'] as $key) {
                if (! isset($configRow[$key])) {
                    continue;
                }
                $n = (int) $configRow[$key];
                if ($n > 0) {
                    return $n;
                }
            }
        }

        return self::DEFAULT_CONTEXT_TOKENS;
    }
}
