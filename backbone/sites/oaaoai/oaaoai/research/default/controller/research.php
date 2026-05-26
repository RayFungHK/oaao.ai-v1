<?php

namespace Module\oaao\research;

use Razy\Agent;
use Razy\Controller;

require_once __DIR__ . '/../library/_bootstrap.php';

/**
 * Article Research — watch CRUD + run trigger (fetch worker on orchestrator).
 */
return new class extends Controller {
    /**
     * @param array<string, mixed>|null $data
     */
    private function oaao_research_json_exit(int $httpStatus, bool $success, string $message = '', ?array $data = null): never
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

    protected function oaao_research_require_pg(): ?array
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return null;
        }

        $auth->restrict(true);
        $user = $auth->getUser();
        $uid = (int) ($user->user_id ?? 0);
        if ($uid < 1) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Invalid session']);

            return null;
        }

        $db = $auth->getDB();
        if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $pdo = $db->getDBAdapter();
        if (! ($pdo instanceof \PDO) || $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME) !== 'pgsql') {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Research requires PostgreSQL']);

            return null;
        }

        require_once dirname(__DIR__, 3) . '/auth/default/controller/api/_ensure_pg_core_tables.php';
        oaao_auth_ensure_pg_core_tables($db);

        $core = $this->api('core');
        $tenantId = $core ? $core->bootstrapTenantContext($pdo) : 1;

        return [
            'db'        => $db,
            'pdo'       => $pdo,
            'user'      => $user,
            'uid'       => $uid,
            'tenant_id' => max(1, $tenantId),
        ];
    }

    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/research',
                'Article Research',
                'Fetch articles → Vault markdown + summary',
                'microscope',
                [
                    'shell_panel_url' => '/research/workspace-panel',
                    'shell_js_module' => '/webassets/research/default/js/research-panel.js',
                ],
            );
        }

        $agent->addRoute('GET /research/workspace-panel', 'panel/workspace_panel');

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addLazyRoute([
            'api' => [
                'GET watch_list'      => 'watch_list',
                'GET fetch_queue_status' => 'fetch_queue_status',
                'POST watch_save'     => 'watch_save',
                'POST watch_delete'   => 'watch_delete',
                'POST source_discover'=> 'source_discover',
                'POST source_discover_step' => 'source_discover_step',
                'POST source_discover_finalize' => 'source_discover_finalize',
                'POST run_now'        => 'run_now',
                'POST refetch_all'    => 'refetch_all',
                'POST purge_orphans'  => 'purge_orphans',
                'POST cron_run'       => 'cron_run',
                'POST item_upsert'    => 'item_upsert',
                'POST fetch_job_enqueue'  => 'fetch_job_enqueue',
                'POST fetch_job_claim'    => 'fetch_job_claim',
                'POST fetch_job_finish'   => 'fetch_job_finish',
                'POST fetch_job_worker_context' => 'fetch_job_worker_context',
                'POST refetch_item_claim'  => 'refetch_item_claim',
                'POST refetch_item_finish' => 'refetch_item_finish',
                'POST refetch_orphans_reset' => 'refetch_orphans_reset',
                'POST item_refetch_purge'  => 'item_refetch_purge',
                'POST source_state_patch' => 'source_state_patch',
                'POST watch_config_patch' => 'watch_config_patch',
                'POST match_notify'       => 'match_notify',
                'POST match_prompt_preview' => 'match_prompt_preview',
            ],
        ]);

        return true;
    }
};
