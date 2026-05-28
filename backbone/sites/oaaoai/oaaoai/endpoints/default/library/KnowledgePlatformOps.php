<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use oaaoai\chat\ChatOrchestratorApi;
use Razy\Database;

/**
 * Platform Knowledge bootstrap: vault provision + conversation signal batch → orchestrator.
 */
final class KnowledgePlatformOps
{
    /**
     * @return array<string, mixed>
     */
    public static function run(Database $db, ?CanonicalEndpointsRepository $repo = null): array
    {
        $repo ??= new CanonicalEndpointsRepository($db, null);
        $pdo = $db->getDBAdapter();

        $vault = KnowledgePlatformVaultProvisioner::ensure($db, $repo);

        $aggregate = KnowledgeConversationSignalAggregator::aggregate(
            $pdo instanceof \PDO ? $pdo : null,
        );

        $merge = null;
        $topics = $aggregate['topics'] ?? [];
        if (\is_array($topics) && $topics !== []) {
            $merge = ChatOrchestratorApi::postInternalJson(
                '/v1/knowledge/signals/merge',
                ['topics' => $topics, 'lookback_days' => $aggregate['lookback_days'] ?? 7],
                120,
            );
        }

        return [
            'vault'     => $vault,
            'aggregate' => $aggregate,
            'merge'     => $merge,
        ];
    }
}
