<?php

namespace Module\oaao\todo;

use Razy\Agent;
use Razy\Controller;

/**
 * Todo Agent — header panel CRUD (CS-6-S1…S2).
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $agent->addLazyRoute([
            'api' => [
                'GET todos_list'   => 'todos_list',
                'POST todos_save'  => 'todos_save',
                'POST todos_resolve' => 'todos_resolve',
            ],
        ]);

        return true;
    }
};
