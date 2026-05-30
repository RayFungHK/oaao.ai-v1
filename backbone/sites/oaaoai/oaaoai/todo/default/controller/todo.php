<?php

namespace Module\oaao\todo;

use Razy\Agent;
use Razy\Controller;

/**
 * Todo Agent — header panel CRUD (CS-6-S1…S2).
 */
return new class extends Controller {
    /**
     * @return list<array{todo_id: int, title: string}>
     */
    public function openItemsForConversation(
        \PDO $canonPdo,
        int $tenantId,
        int $userId,
        int $conversationId,
        int $limit = 20,
    ): array {
        return \oaaoai\todo\TodoOpenItemsForConversation::listForConversation(
            $canonPdo,
            $tenantId,
            $userId,
            $conversationId,
            $limit,
        );
    }

    public function __onInit(Agent $agent): bool
    {
        $agent->addLazyRoute([
            'api' => [
                'GET todos_list'     => 'todos_list',
                'POST todos_save'    => 'todos_save',
                'POST todos_resolve' => 'todos_resolve',
            ],
        ]);

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addAPICommand([
            'openItemsForConversation' => 'openItemsForConversation',
        ]);

        return true;
    }
};
