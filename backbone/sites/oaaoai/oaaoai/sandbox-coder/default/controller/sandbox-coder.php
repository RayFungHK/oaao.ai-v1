<?php

namespace Module\oaao\sandbox_coder;

use Razy\Agent;
use Razy\Controller;

/**
 * Sandbox coder — enriches {@code sandbox_code} planner hints for automatic task planning (SD-0).
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        return true;
    }
};
