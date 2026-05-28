<?php

declare(strict_types=1);

namespace oaaoai\corpus;

use Razy\Database;

/**
 * Load corpus profile style for Chat orchestrator payload (CS-1-S10).
 */
final class CorpusStyleResolver
{
    /**
     * @return array<string, mixed>|null { corpus_id, name, description, status, style_json }
     */
    public static function forChatRun(
        Database $db,
        int $corpusId,
        int $tenantId,
        int $userId,
        ?int $workspaceId,
    ): ?array {
        if ($corpusId < 1) {
            return null;
        }

        $repo = new CorpusRepository($db);
        $profile = $repo->getProfileInScope($corpusId, $tenantId, $userId, $workspaceId);
        if ($profile === null) {
            return null;
        }

        $status = (string) ($profile['status'] ?? '');
        if ($status !== 'ready') {
            return null;
        }

        $style = CorpusRepository::decodeStyleJson(
            isset($profile['style_json']) ? (string) $profile['style_json'] : null,
        );
        if ($style === null) {
            return null;
        }

        return [
            'corpus_id'   => $corpusId,
            'name'        => (string) ($profile['name'] ?? ''),
            'description' => isset($profile['description']) ? (string) $profile['description'] : null,
            'status'      => $status,
            'style_json'  => $style,
        ];
    }
}
