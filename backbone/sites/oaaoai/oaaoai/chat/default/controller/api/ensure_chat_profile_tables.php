<?php

declare(strict_types=1);

/** Chat endpoint profile tables on canonical DB ({@see chat} {@code ensureChatProfileTables}). */
return function (\Razy\Database $database): void {
    $auth = $this->api('auth');
    if (! $auth) {
        return;
    }
    $auth->ensureChatEndpointTables($database);
};
