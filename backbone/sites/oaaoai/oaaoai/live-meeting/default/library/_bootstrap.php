<?php

declare(strict_types=1);

/**
 * Eager-load live-meeting library — API closure files are not autoloaded by Razy.
 */
require_once __DIR__ . '/LiveMeetingOrchestrator.php';
require_once __DIR__ . '/LiveMeetingStorage.php';
