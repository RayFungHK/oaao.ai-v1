<?php

namespace Module\oaao\calendar;

use Razy\Agent;
use Razy\Controller;

/**
 * Calendar — workspace/calendar list + month view (CS-5-S1…S3).
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/calendar',
                'Calendar',
                'Events and schedule',
                'calendar',
                [
                    'shell_panel_url' => '/calendar/workspace-panel',
                    'shell_js_module' => '/webassets/calendar/default/js/calendar-panel.js',
                ],
            );
        }

        $agent->addRoute('GET /calendar/workspace-panel', 'panel/workspace_panel');
        $agent->addLazyRoute([
            'api' => [
                'GET calendar_events_list'  => 'calendar_events_list',
                'POST calendar_events_save' => 'calendar_events_save',
                'POST calendar_event_delete'=> 'calendar_event_delete',
            ],
        ]);

        return true;
    }
};
