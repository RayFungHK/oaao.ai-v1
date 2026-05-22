<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\chat\\MicroSkillsRegister}.
 */

require_once dirname(__DIR__, 4) . '/chat/default/library/MicroSkillsRegister.php';

use oaaoai\chat\MicroSkillsRegister;

return function (array $payload): void {
    $providerId = isset($payload['provider_id']) && is_string($payload['provider_id'])
        ? trim($payload['provider_id'])
        : '';
    $kind = isset($payload['kind']) && is_string($payload['kind']) ? trim($payload['kind']) : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    if ($providerId === '' || $kind === '' || $label === '') {
        return;
    }

    MicroSkillsRegister::addProvider($providerId, $kind, $label, $extras);
};
