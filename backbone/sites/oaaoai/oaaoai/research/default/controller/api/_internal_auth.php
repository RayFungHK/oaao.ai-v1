<?php

declare(strict_types=1);

function oaao_research_internal_token_ok(): bool
{
    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : 'oaao_dev_shared_secret';
    $hdr = isset($_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'])
        ? trim((string) $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'])
        : '';

    return $hdr !== '' && hash_equals($secret, $hdr);
}
