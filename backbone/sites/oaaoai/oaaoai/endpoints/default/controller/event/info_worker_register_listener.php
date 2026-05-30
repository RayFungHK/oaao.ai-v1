<?php

declare(strict_types=1);

/**
 * Merge rows into {@see \\oaaoai\\chat\\InfoWorkerRegister}.
 */

require_once dirname(__DIR__, 4) . '/chat/default/library/InfoWorkerRegister.php';

use oaaoai\chat\InfoWorkerRegister;

return function (array $payload): void {
    $worker_id = isset($payload['worker_id']) && is_string($payload['worker_id'])
        ? trim($payload['worker_id'])
        : '';
    $label = isset($payload['label']) && is_string($payload['label']) ? trim($payload['label']) : '';
    /** @var array<string, mixed> $extras */
    $extras = (isset($payload['extras']) && is_array($payload['extras'])) ? $payload['extras'] : [];

    InfoWorkerRegister::add($worker_id, $label, $extras);
};
