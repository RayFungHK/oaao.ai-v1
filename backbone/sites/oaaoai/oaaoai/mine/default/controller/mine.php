<?php

namespace Module\oaao\mine;

use Oaaoai\Core\NotificationRepository;
use Razy\Agent;
use Razy\Controller;

require_once __DIR__ . '/../library/_bootstrap.php';

/**
 * Data Mining — mine CRUD, SQLite rows API, orchestrator worker trigger.
 */
return new class extends Controller {
    /**
     * @param array<string, mixed>|null $data
     */
    private function oaao_mine_json_exit(int $httpStatus, bool $success, string $message = '', ?array $data = null): never
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

    protected function oaao_mine_require_pg(): ?array
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
            echo json_encode(['success' => false, 'message' => 'Data Mining requires PostgreSQL']);

            return null;
        }

        $auth->ensurePgCoreTables($db);

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

    /**
     * @param array<string, mixed> $mine
     * @param array<string, mixed> $stats
     */
    protected function oaao_mine_maybe_notify(\PDO $pdo, int $userId, int $mineId, int $runId, array $mine, array $stats): void
    {
        $notify = [];
        if (isset($mine['notify_json']) && \is_string($mine['notify_json']) && $mine['notify_json'] !== '') {
            try {
                $decoded = json_decode($mine['notify_json'], true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($decoded)) {
                    $notify = $decoded;
                }
            } catch (\JsonException) {
            }
        }
        if (empty($notify['in_app'])) {
            return;
        }

        $newCount = (int) ($stats['rows_inserted'] ?? $stats['new_rows'] ?? 0);
        $minRows = (int) ($notify['min_new_rows'] ?? 1);
        if ($newCount < max(1, $minRows)) {
            return;
        }

        require_once dirname(__DIR__, 3) . '/core/default/library/NotificationRepository.php';
        $label = trim((string) ($mine['label'] ?? 'Mine'));
        $repo = new NotificationRepository($pdo);
        $repo->create(
            $userId,
            'mine_new_rows',
            "Data Mining: {$label}",
            "{$newCount} new row(s) in run #{$runId}",
            [
                'mine_id'   => $mineId,
                'run_id'    => $runId,
                'new_count' => $newCount,
            ],
        );
    }

    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerSpaPage(
                'workspace/mines',
                'Data Mining',
                'Scheduled fetch → structured SQLite tables',
                'database',
                [
                    'shell_panel_url' => '/mine/workspace-panel',
                    'shell_js_module' => '/webassets/mine/default/js/mine-panel.js',
                ],
            );
        }

        $agent->addRoute('GET /mine/workspace-panel', 'panel/workspace_panel');

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addLazyRoute([
            'api' => [
                'GET mine_list'    => 'mine_list',
                'POST mine_save'   => 'mine_save',
                'POST mine_delete' => 'mine_delete',
                'POST source_discover' => 'source_discover',
                'POST run_now'     => 'run_now',
                'GET rows'         => 'rows',
                'GET export_csv'   => 'export_csv',
                'POST export_vault'=> 'export_vault',
                'POST cron_run'    => 'cron_run',
            ],
        ]);

        return true;
    }
};
