<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\endpoints\\AsrUserPreferenceRegister}.
 */

use oaaoai\endpoints\AsrUserPreferenceRegister;

return function (array $payload): void {
    $fieldId = isset($payload['field_id']) && is_string($payload['field_id'])
        ? trim($payload['field_id'])
        : '';
    if ($fieldId === '') {
        return;
    }
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    AsrUserPreferenceRegister::addField($fieldId, $extras);
};
