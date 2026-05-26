<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\endpoints\\MmPythonModuleRegister}.
 */

require_once dirname(__DIR__, 2) . '/library/MmPythonModuleRegister.php';

use oaaoai\endpoints\MmPythonModuleRegister;

return function (array $payload): void {
    $moduleId = isset($payload['module_id']) && is_string($payload['module_id'])
        ? trim($payload['module_id'])
        : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    $description = isset($payload['description']) && is_string($payload['description'])
        ? trim($payload['description'])
        : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    MmPythonModuleRegister::add($moduleId, $label, $description, $extras);
};
