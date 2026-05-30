<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/PostTurnActionRegister.php';
require_once dirname(__DIR__, 4) . '/endpoints/default/library/FeatureRegistryBootstrap.php';
require_once dirname(__DIR__, 2) . '/library/ComposePromptRegister.php';
require_once dirname(__DIR__, 2) . '/library/PlannerPromptRegister.php';

use oaaoai\chat\ComposePromptRegister;
use oaaoai\chat\PlannerPromptRegister;
use oaaoai\chat\PostTurnActionRegister;
use oaaoai\endpoints\FeatureRegistryBootstrap;

/** GET /chat/api/registry_probe — dev registry fan-out check */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    FeatureRegistryBootstrap::reset();
    FeatureRegistryBootstrap::collect($this);

    $postTurn = PostTurnActionRegister::forOrchestrator();
    $compose = ComposePromptRegister::allSorted();
    $planner = PlannerPromptRegister::slotMap();

    echo json_encode([
        'success'         => true,
        'post_turn_count' => count($postTurn),
        'post_turn_ids'   => array_column($postTurn, 'action_id'),
        'compose_count'   => count($compose),
        'compose_slots'   => array_column($compose, 'slot'),
        'planner_slots'   => array_keys($planner),
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
};
