<?php

declare(strict_types=1);

/**
 * Eager-load slide-designer library — API closure files are not autoloaded by Razy.
 */
require_once __DIR__ . '/SlideProjectStorage.php';
require_once __DIR__ . '/SlideProjectRegistry.php';
require_once __DIR__ . '/SlideCanvas.php';

require_once __DIR__ . '/SlideTemplateStorage.php';
require_once __DIR__ . '/SlideTemplateScope.php';
require_once __DIR__ . '/SlideChatEndpoint.php';
require_once __DIR__ . '/SlideTemplateLlm.php';
require_once __DIR__ . '/SlideOrchestrator.php';
