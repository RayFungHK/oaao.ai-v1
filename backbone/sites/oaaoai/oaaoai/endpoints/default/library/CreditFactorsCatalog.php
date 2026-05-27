<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use Oaaoai\Core\CreditLedgerRepository;

/**
 * Aggregate credit ratios / factors for admin Credit settings page.
 *
 * Loaded by Razy module library autoload: {@code oaaoai/endpoints/CreditFactorsCatalog}.
 */
final class CreditFactorsCatalog
{
    /** @return list<string> */
    public static function resolutionTiers(): array
    {
        return ['1k', '2k', '4k', '8k'];
    }

    /** @return list<string> */
    public static function mmTasks(): array
    {
        return ['t2i', 't2v', 'x2t_image', 'x2t_video', 'image_edit', 'video_edit'];
    }

    /** @return array<string, mixed> */
    public static function defaultMmCreditFactors(): array
    {
        $gen = ['1k' => 1.0, '2k' => 2.0, '4k' => 4.0, '8k' => 8.0];
        $edit = ['1k' => 1.5, '2k' => 3.0, '4k' => 6.0, '8k' => 12.0];
        $understand = ['1k' => 0.25, '2k' => 0.5, '4k' => 1.0, '8k' => 2.0];

        return [
            'resolutions' => self::resolutionTiers(),
            'axes'        => [
                'generate'   => $gen,
                'edit'       => $edit,
                'understand' => $understand,
            ],
            'tasks' => [
                't2i'        => $gen,
                't2v'        => ['1k' => 2.0, '2k' => 4.0, '4k' => 8.0, '8k' => 16.0],
                'x2t_image'  => $understand,
                'x2t_video'  => ['1k' => 0.5, '2k' => 1.0, '4k' => 2.0, '8k' => 4.0],
                'image_edit' => $edit,
                'video_edit' => ['1k' => 3.0, '2k' => 6.0, '4k' => 12.0, '8k' => 24.0],
            ],
        ];
    }

    /**
     * @param array<string, mixed> $raw
     *
     * @return array<string, mixed>
     */
    public static function normalizeMmCreditFactors(array $raw): array
    {
        $defaults = self::defaultMmCreditFactors();
        $out = $defaults;
        $tiers = self::resolutionTiers();

        foreach (['axes', 'tasks'] as $section) {
            $src = $raw[$section] ?? null;
            if (! \is_array($src)) {
                continue;
            }
            foreach ($src as $key => $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $merged = [];
                foreach ($tiers as $tier) {
                    if (isset($row[$tier]) && is_numeric($row[$tier])) {
                        $merged[$tier] = (float) $row[$tier];
                    } elseif (isset($defaults[$section][$key][$tier])) {
                        $merged[$tier] = (float) $defaults[$section][$key][$tier];
                    }
                }
                if ($merged !== []) {
                    $out[$section][(string) $key] = $merged;
                }
            }
        }

        return $out;
    }

    /**
     * @return array<string, mixed>
     */
    public static function mmCreditFactorsFromConfig(): array
    {
        $cfg = MmModuleSettings::load();
        $raw = $cfg['credit_factors'] ?? null;

        return self::normalizeMmCreditFactors(\is_array($raw) ? $raw : []);
    }

    /**
     * Resolve credits for a multimodal run (generate/edit by resolution tier).
     */
    public static function creditsForMmRun(string $task, string $resolutionTier = '1k'): float
    {
        $factors = self::mmCreditFactorsFromConfig();
        $tier = strtolower(trim($resolutionTier));
        if (! \in_array($tier, self::resolutionTiers(), true)) {
            $tier = '1k';
        }
        $task = trim($task);
        $tasks = \is_array($factors['tasks'] ?? null) ? $factors['tasks'] : [];
        if (isset($tasks[$task]) && \is_array($tasks[$task]) && isset($tasks[$task][$tier])) {
            return max(0.0, (float) $tasks[$task][$tier]);
        }
        $axis = match ($task) {
            't2i', 't2v' => 'generate',
            'image_edit', 'video_edit' => 'edit',
            default => 'understand',
        };
        $axes = \is_array($factors['axes'] ?? null) ? $factors['axes'] : [];
        if (isset($axes[$axis][$tier])) {
            return max(0.0, (float) $axes[$axis][$tier]);
        }

        return 0.0;
    }

    /**
     * @return array<string, mixed>
     */
    public static function catalogForAdmin(
        \PDO $pdo,
        int $tenantId,
        ?CanonicalEndpointsRepository $repo = null,
        bool $purposesAvailable = true,
    ): array {
        $tokensPerCredit = CreditLedgerRepository::DEFAULT_TOKENS_PER_CREDIT;
        if ($tenantId > 0) {
            $tokensPerCredit = CreditLedgerRepository::resolveTokensPerCredit($pdo, $tenantId, 0);
        }

        $purposes = [];
        $endpoints = [];
        if ($repo !== null && $purposesAvailable) {
            foreach ($repo->listPurposesWithDefaultEndpointName() as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $meta = [];
                $raw = $row['meta_json'] ?? null;
                if (\is_string($raw) && trim($raw) !== '') {
                    try {
                        $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($dec)) {
                            $meta = $dec;
                        }
                    } catch (\Throwable) {
                    }
                } elseif (\is_array($raw)) {
                    $meta = $raw;
                }
                $mult = (float) ($meta['credit_multiplier'] ?? 1);
                $purposes[] = [
                    'purpose_key'       => (string) ($row['purpose_key'] ?? ''),
                    'label'             => (string) ($row['label'] ?? ''),
                    'credit_multiplier' => $mult > 0 ? $mult : 1.0,
                ];
            }

            foreach ($repo->listEndpoints() as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $cfg = [];
                $raw = $row['config_json'] ?? null;
                if (\is_string($raw) && trim($raw) !== '') {
                    try {
                        $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($dec)) {
                            $cfg = $dec;
                        }
                    } catch (\Throwable) {
                    }
                } elseif (\is_array($raw)) {
                    $cfg = $raw;
                }
                $tpc = (float) ($cfg['tokens_per_credit'] ?? 0);
                $endpoints[] = [
                    'endpoint_id'       => (int) ($row['id'] ?? 0),
                    'label'             => (string) ($row['name'] ?? ''),
                    'tokens_per_credit' => $tpc > 0 ? $tpc : CreditLedgerRepository::DEFAULT_TOKENS_PER_CREDIT,
                ];
            }
        }

        $chatEndpoints = [];
        try {
            $chatSql = 'SELECT id, name, config_json FROM oaao_chat_endpoint ORDER BY id';
            $st3 = $pdo->query($chatSql);
            if ($st3) {
                while ($row = $st3->fetch(\PDO::FETCH_ASSOC)) {
                    if (! \is_array($row)) {
                        continue;
                    }
                    $cfg = [];
                    $raw = trim((string) ($row['config_json'] ?? ''));
                    if ($raw !== '') {
                        try {
                            $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                            if (\is_array($dec)) {
                                $cfg = $dec;
                            }
                        } catch (\Throwable) {
                        }
                    }
                    $mult = (float) ($cfg['credit_multiplier'] ?? 1);
                    $chatEndpoints[] = [
                        'chat_endpoint_id'  => (int) ($row['id'] ?? 0),
                        'label'             => (string) ($row['name'] ?? ''),
                        'credit_multiplier' => $mult > 0 ? $mult : 1.0,
                    ];
                }
            }
        } catch (\Throwable) {
        }

        return [
            'formula' => [
                'chat_completion' => 'credits = (total_tokens / tokens_per_credit) × purpose_multiplier × chat_endpoint_multiplier',
                'multimodal'      => 'credits = mm_task_factor[resolution] (from mm_modules.json credit_factors)',
            ],
            'defaults' => [
                'tokens_per_credit' => CreditLedgerRepository::DEFAULT_TOKENS_PER_CREDIT,
            ],
            'tokens_per_credit' => $tokensPerCredit,
            'purposes'          => $purposes,
            'endpoints'         => $endpoints,
            'chat_endpoints'    => $chatEndpoints,
            'mm_credit_factors'        => self::mmCreditFactorsFromConfig(),
            'mm_config_path'           => MmModuleSettings::configPath(),
            'purposes_postgresql_only' => ! $purposesAvailable,
        ];
    }
}
