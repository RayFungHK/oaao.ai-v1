<?php

declare(strict_types=1);

namespace Oaaoai\Core;

require_once __DIR__ . '/AuthSchemaBridge.php';

/**
 * User credit balances and debit ledger (tenant-scoped).
 *
 * Config:
 * - {@code oaao_endpoint.config_json.tokens_per_credit} (default 1000)
 * - {@code oaao_purpose.meta_json.credit_multiplier} (default 1)
 * - {@code oaao_chat_endpoint.config_json.credit_multiplier} for chat runs (default 1)
 */
final class CreditLedgerRepository
{
    public const DEFAULT_TOKENS_PER_CREDIT = 1000.0;

    /**
     * @param array<string, mixed> $runMeta
     */
    public static function debitChatCompletion(
        \PDO $pdo,
        int $tenantId,
        int $userId,
        array $runMeta,
        int $usageEventId = 0,
    ): void {
        if ($tenantId < 1 || $userId < 1) {
            return;
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        $prompt = (int) ($runMeta['prompt_tokens'] ?? 0);
        $completion = (int) ($runMeta['completion_tokens'] ?? 0);
        $total = $prompt + $completion;
        if ($total < 1) {
            $total = (int) ($runMeta['tokens_out'] ?? 0);
        }
        if ($total < 1) {
            return;
        }

        $endpointId = (int) ($runMeta['endpoint_id'] ?? 0);
        $chatEndpointId = (int) ($runMeta['chat_endpoint_id'] ?? 0);
        $purposeKey = trim((string) ($runMeta['purpose_key'] ?? 'chat'));

        $tokensPerCredit = self::resolveTokensPerCredit($pdo, $tenantId, $endpointId);
        $purposeMult = self::resolvePurposeMultiplier($pdo, $tenantId, $purposeKey);
        $chatMult = self::resolveChatEndpointMultiplier($pdo, $tenantId, $chatEndpointId);

        $credits = ($total / $tokensPerCredit) * $purposeMult * $chatMult;
        if ($credits <= 0) {
            return;
        }

        self::debitUser(
            $pdo,
            $tenantId,
            $userId,
            $credits,
            'chat.completion',
            'usage_event',
            $usageEventId,
            [
                'total_tokens'       => $total,
                'tokens_per_credit'  => $tokensPerCredit,
                'purpose_multiplier' => $purposeMult,
                'chat_multiplier'    => $chatMult,
                'purpose_key'        => $purposeKey,
                'endpoint_id'        => $endpointId > 0 ? $endpointId : null,
                'chat_endpoint_id'   => $chatEndpointId > 0 ? $chatEndpointId : null,
            ],
        );
    }

    /**
     * @param array<string, mixed>|null $meta
     */
    public static function debitUser(
        \PDO $pdo,
        int $tenantId,
        int $userId,
        float $credits,
        string $reason,
        ?string $refKind = null,
        int $refId = 0,
        ?array $meta = null,
    ): void {
        if ($tenantId < 1 || $userId < 1 || $credits <= 0) {
            return;
        }

        AuthSchemaBridge::ensureTenantSchema($pdo);

        $stmt = $pdo->prepare(
            'SELECT credit_balance FROM oaao_user WHERE user_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE',
        );
        $stmt->execute([$userId, $tenantId]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (! \is_array($row)) {
            return;
        }

        $balanceRaw = $row['credit_balance'] ?? null;
        if ($balanceRaw === null || $balanceRaw === '') {
            // NULL balance = unlimited / credits not enforced — still append ledger for audit when tenant tracks usage.
            $balanceAfter = null;
        } else {
            $balance = (float) $balanceRaw;
            $balanceAfter = max(0, $balance - $credits);
            $pdo->prepare(
                'UPDATE oaao_user SET credit_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND tenant_id = ?',
            )->execute([$balanceAfter, $userId, $tenantId]);
        }

        $metaJson = null;
        if ($meta !== null && $meta !== []) {
            try {
                $metaJson = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $metaJson = null;
            }
        }

        $pdo->prepare(
            'INSERT INTO oaao_credit_ledger (tenant_id, user_id, delta_credits, balance_after, reason, ref_kind, ref_id, meta_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        )->execute([
            $tenantId,
            $userId,
            -abs($credits),
            $balanceAfter,
            $reason,
            $refKind,
            $refId > 0 ? $refId : null,
            $metaJson,
        ]);
    }

    public static function resolveTokensPerCredit(\PDO $pdo, int $tenantId, int $endpointId): float
    {
        if ($endpointId < 1) {
            return self::DEFAULT_TOKENS_PER_CREDIT;
        }

        $stmt = $pdo->prepare(
            'SELECT config_json FROM oaao_endpoint WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?) LIMIT 1',
        );
        $stmt->execute([$endpointId, $tenantId]);
        $raw = $stmt->fetchColumn();
        $cfg = self::decodeJsonObject($raw);
        $v = (float) ($cfg['tokens_per_credit'] ?? 0);

        return $v > 0 ? $v : self::DEFAULT_TOKENS_PER_CREDIT;
    }

    public static function resolvePurposeMultiplier(\PDO $pdo, int $tenantId, string $purposeKey): float
    {
        $purposeKey = trim($purposeKey);
        if ($purposeKey === '') {
            return 1.0;
        }

        $stmt = $pdo->prepare(
            'SELECT meta_json FROM oaao_purpose WHERE purpose_key = ? AND (tenant_id IS NULL OR tenant_id = ?) LIMIT 1',
        );
        $stmt->execute([$purposeKey, $tenantId]);
        $raw = $stmt->fetchColumn();
        $meta = self::decodeJsonObject($raw);
        $v = (float) ($meta['credit_multiplier'] ?? 1);

        return $v > 0 ? $v : 1.0;
    }

    public static function resolveChatEndpointMultiplier(\PDO $pdo, int $tenantId, int $chatEndpointId): float
    {
        if ($chatEndpointId < 1) {
            return 1.0;
        }

        $stmt = $pdo->prepare(
            'SELECT config_json FROM oaao_chat_endpoint WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?) LIMIT 1',
        );
        $stmt->execute([$chatEndpointId, $tenantId]);
        $raw = $stmt->fetchColumn();
        $cfg = self::decodeJsonObject($raw);
        $v = (float) ($cfg['credit_multiplier'] ?? 1);

        return $v > 0 ? $v : 1.0;
    }

    /**
     * @return array<string, mixed>
     */
    public static function userDashboard(\PDO $pdo, int $tenantId, int $userId): array
    {
        AuthSchemaBridge::ensureTenantSchema($pdo);

        $balance = null;
        $stmt = $pdo->prepare('SELECT credit_balance, preferences_json FROM oaao_user WHERE user_id = ? AND tenant_id = ? LIMIT 1');
        $stmt->execute([$userId, $tenantId]);
        $userRow = $stmt->fetch(\PDO::FETCH_ASSOC);
        if (\is_array($userRow)) {
            $balance = $userRow['credit_balance'] !== null && $userRow['credit_balance'] !== ''
                ? (float) $userRow['credit_balance']
                : null;
        }

        $usageStmt = $pdo->prepare(
            "SELECT event_kind, COALESCE(SUM(quantity), 0) AS qty, unit
             FROM oaao_usage_event
             WHERE tenant_id = ? AND user_id = ? AND created_at >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
             GROUP BY event_kind, unit
             ORDER BY event_kind",
        );
        $usageStmt->execute([$tenantId, $userId]);
        /** @var list<array<string, mixed>> $usageByKind */
        $usageByKind = $usageStmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        require_once __DIR__ . '/UsageEventRepository.php';
        $usageByPurpose = UsageEventRepository::aggregateByPurpose($pdo, $tenantId, $userId, 30);

        $ledgerStmt = $pdo->prepare(
            'SELECT ledger_id, delta_credits, balance_after, reason, meta_json, created_at
             FROM oaao_credit_ledger
             WHERE tenant_id = ? AND user_id = ?
             ORDER BY created_at DESC
             LIMIT 20',
        );
        $ledgerStmt->execute([$tenantId, $userId]);
        /** @var list<array<string, mixed>> $ledger */
        $ledger = $ledgerStmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        $tokens30d = 0.0;
        foreach ($usageByKind as $row) {
            if (($row['event_kind'] ?? '') === 'chat.completion' && ($row['unit'] ?? '') === 'tokens') {
                $tokens30d += (float) ($row['qty'] ?? 0);
            }
        }

        $creditsUsed30d = 0.0;
        foreach ($ledger as $row) {
            $delta = (float) ($row['delta_credits'] ?? 0);
            if ($delta < 0) {
                $creditsUsed30d += abs($delta);
            }
        }

        /** @var list<array{date: string, tokens: float, chat_tokens: float}> $dailyTokens */
        $dailyTokens = self::dailyTokenSeries($pdo, $tenantId, $userId, 365);
        $tokens365d = 0.0;
        foreach ($dailyTokens as $row) {
            $tokens365d += (float) ($row['tokens'] ?? 0);
        }

        return [
            'credit_balance'    => $balance,
            'credits_unlimited' => $balance === null,
            'tokens_30d'        => $tokens30d,
            'tokens_365d'       => $tokens365d,
            'credits_used_30d'  => $creditsUsed30d,
            'daily_tokens'      => $dailyTokens,
            'usage_by_kind'     => $usageByKind,
            'usage_by_purpose'  => $usageByPurpose,
            'ledger_recent'     => $ledger,
        ];
    }

    /**
     * Per-day token totals for heatmap ({@code unit = tokens}).
     *
     * @return list<array{date: string, tokens: float, chat_tokens: float}>
     */
    public static function dailyTokenSeries(\PDO $pdo, int $tenantId, int $userId, int $days = 365): array
    {
        if ($tenantId < 1 || $userId < 1 || $days < 1) {
            return [];
        }

        $days = min(366, max(7, $days));

        $stmt = $pdo->prepare(
            "SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
                    event_kind,
                    COALESCE(SUM(quantity), 0) AS qty
             FROM oaao_usage_event
             WHERE tenant_id = ?
               AND user_id = ?
               AND unit = 'tokens'
               AND created_at >= ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - (? - 1) * INTERVAL '1 day')
             GROUP BY day, event_kind
             ORDER BY day ASC",
        );
        $stmt->execute([$tenantId, $userId, $days]);

        /** @var array<string, array{date: string, tokens: float, chat_tokens: float}> $byDay */
        $byDay = [];
        while (($row = $stmt->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $dayRaw = $row['day'] ?? '';
            $day = \is_string($dayRaw) ? $dayRaw : (string) $dayRaw;
            if ($day === '') {
                continue;
            }
            $qty = (float) ($row['qty'] ?? 0);
            $kind = (string) ($row['event_kind'] ?? '');
            if (! isset($byDay[$day])) {
                $byDay[$day] = ['date' => $day, 'tokens' => 0.0, 'chat_tokens' => 0.0];
            }
            $byDay[$day]['tokens'] += $qty;
            if ($kind === 'chat.completion') {
                $byDay[$day]['chat_tokens'] += $qty;
            }
        }

        return array_values($byDay);
    }

    /** @return array<string, mixed> */
    private static function decodeJsonObject(mixed $raw): array
    {
        if (! \is_string($raw) || trim($raw) === '') {
            return [];
        }
        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return \is_array($decoded) ? $decoded : [];
    }
}
