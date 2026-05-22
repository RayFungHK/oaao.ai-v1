<?php

/**
 * GET /chat/api/routing_profiles — enabled runnable chat completion profiles ({@code name} → workspace picker label).
 */
return function (): void {
    [$authApi, $user] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $user) {
        return;
    }

    $canonDb = $authApi->getDB();
    if (! $canonDb instanceof \Razy\Database) {
        echo json_encode([
            'success'                   => true,
            'profiles'                  => [],
            'default_chat_endpoint_id' => 0,
        ]);

        return;
    }

    $profiles = \oaaoai\chat\ChatRoutingSelectableProfiles::listForWorkspace($canonDb);
    $default = \oaaoai\chat\ChatRoutingSelectableProfiles::defaultChatEndpointId($canonDb);

    echo json_encode([
        'success'                   => true,
        'profiles'                  => $profiles,
        'default_chat_endpoint_id' => $default,
    ]);
};
