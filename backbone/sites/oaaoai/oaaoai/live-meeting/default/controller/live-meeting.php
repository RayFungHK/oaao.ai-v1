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
        }

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
