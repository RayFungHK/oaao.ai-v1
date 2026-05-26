<?php

declare(strict_types=1);

function oaao_research_internal_token_ok(): bool
{
    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = isset($_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'])
        ? trim((string) $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'])
        : '';

    return $hdr !== '' && hash_equals($secret, $hdr);
}
