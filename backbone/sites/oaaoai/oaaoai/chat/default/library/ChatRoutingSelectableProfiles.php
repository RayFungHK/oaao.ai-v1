<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Razy\Database;

/**
 * Enabled chat completion profiles ({@code oaao_chat_endpoint}) runnable by the orchestrator — workspace header picker.
 */
final class ChatRoutingSelectableProfiles
{
    /**
     * @return list<array{chat_endpoint_id: int, label: string}>
     */
    public static function listForWorkspace(Database $canonicalDb): array
    {
        $repo = new ChatEndpointsRepository($canonicalDb);
        $out = [];
        foreach ($repo->listProfiles() as $p) {
            if (! \is_array($p)) {
                continue;
            }
            if ((int) ($p['is_enabled'] ?? 1) !== 1) {
                continue;
            }
            $id = (int) ($p['id'] ?? 0);
            if ($id < 1) {
                continue;
            }
            if (ChatOrchestratorBootstrap::resolveBindingForProfile($canonicalDb, $id) === null) {
                continue;
            }
            $name = trim((string) ($p['name'] ?? ''));
            $out[] = [
                'chat_endpoint_id' => $id,
                'label'            => $name !== '' ? $name : ('#' . $id),
            ];
        }

        return $out;
    }

    public static function defaultChatEndpointId(Database $canonicalDb): int
    {
        $b = ChatOrchestratorBootstrap::resolveDefaultBinding($canonicalDb);

        return \is_array($b) ? (int) ($b['profile']['id'] ?? 0) : 0;
    }

    public static function isRunnableId(Database $canonicalDb, int $chatEndpointId): bool
    {
        if ($chatEndpointId < 1) {
            return false;
        }

        return ChatOrchestratorBootstrap::resolveBindingForProfile($canonicalDb, $chatEndpointId) !== null;
    }
}
