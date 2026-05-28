<?php

namespace Module\oaao\livemeeting;

use Razy\Agent;
use Razy\Controller;

/**
 * Live meeting workspace — SPA shell + session APIs (streaming on orchestrator only).
 */
return new class extends Controller {
    /**
     * @param array<string, mixed>|null $data
     */
    private function oaao_live_json_exit(int $httpStatus, bool $success, string $message = '', ?array $data = null): never
    {
        http_response_code($httpStatus);
        header('Content-Type: application/json; charset=UTF-8');
        $payload = ['success' => $success];
        if ($message !== '') {
            $payload['message'] = $message;
        }
        if ($data !== null) {
            $payload['data'] = $data;
        }
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        exit;
    }

    /**
     * @return array{mixed|null, object|null}
     */
    protected function oaao_live_require_authenticated_only(): array
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return [null, null];
        }

        $auth->restrict(true);

        $user = $auth->getUser();
        $uid = (int) ($user->user_id ?? 0);
        if ($uid < 1) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Invalid session']);

            return [null, null];
        }

        return [$auth, $user];
    }

    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/live-meeting',
                'Live meeting',
                'Streaming meeting transcript — audio via orchestrator',
                'mic',
                [
                    'shell_panel_url' => '/live-meeting/workspace-panel',
                    'shell_js_module' => '/webassets/live-meeting/default/js/live-meeting-panel.js',
                ],
            );

            $prefJs = '/webassets/live-meeting/default/js/asr-user-preferences-panel.js';
            $coreApi->registerPreferencesSection(
                'pref-asr',
                'Speech',
                'Speech & ASR',
                'Voice input polish and related ASR preferences.',
                'mic',
                [
                    'sort'            => 15,
                    'levels'          => ['personal'],
                    'panel_js_module' => $prefJs,
                    'label_key'       => 'preferences.nav.asr.label',
                    'title_key'       => 'preferences.nav.asr.title',
                    'sub_key'         => 'preferences.nav.asr.sub',
                ],
            );
        }

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addRoute('GET /live-meeting/workspace-panel', 'panel/workspace_panel');

        $agent->addLazyRoute([
            'api' => [
                'POST session_start' => 'session_start',
                'POST session_stop'   => 'session_stop',
            ],
        ]);

        return true;
    }
};
