<?php

/**
 * GET /chat/api/routing_purposes — enabled chat-routing purposes ({@code oaao_purpose}) for the workspace selector.
 */
return function (): void {
    [$authApi, $user] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $user) {
        return;
    }

    $canonDb = $authApi->getDB();
    $purposes = \oaaoai\chat\ChatRoutingPurposes::listSelectable(
        $canonDb instanceof \Razy\Database ? $canonDb : null
    );
    $default = \oaaoai\chat\ChatRoutingPurposes::defaultPurposeKey(
        $canonDb instanceof \Razy\Database ? $canonDb : null
    );

    echo json_encode([
        'success'             => true,
        'purposes'            => $purposes,
        'default_purpose_key' => $default,
    ]);
};
