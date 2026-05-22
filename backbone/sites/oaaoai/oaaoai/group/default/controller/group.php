<?php

namespace Module\oaao\group;

use Razy\Agent;
use Razy\Controller;

/**
 * Permission groups — admin Settings panel + {@code /group/api/*} CRUD.
 */
return new class extends Controller {
    protected function oaao_group_require_admin(): ?\Razy\Database
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return null;
        }

        $auth->restrict(true);

        if (! $auth->requireAdmin()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Administrator required']);

            return null;
        }

        $db = $auth->getDB();
        if (! $db || ! $db->getDBAdapter() instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        require_once __DIR__ . '/../library/PermissionGroup.php';
        $pdo = $db->getDBAdapter();
        if ($pdo instanceof \PDO) {
            $auth->ensurePermissionGroupSchema($pdo);
        }

        return $db;
    }

    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $js = '/webassets/core/default/js/oaao-access-settings-panel.js';
            $coreApi->registerSettingsSection(
                'settings-permission-groups',
                'Permission groups',
                'Permission groups',
                'Feature access, workspace limits, and storage quotas per group.',
                'shield-check',
                [
                    'sort'            => 18,
                    'panel_js_module' => $js,
                    'label_key'       => 'settings.nav.groups.label',
                    'title_key'       => 'settings.nav.groups.title',
                    'sub_key'         => 'settings.nav.groups.sub',
                ],
            );
        }

        $agent->addLazyRoute([
            'api' => [
                'GET groups_list'   => 'groups_list',
                'POST groups_save'  => 'groups_save',
                'POST groups_delete'=> 'groups_delete',
            ],
        ]);

        return true;
    }
};
