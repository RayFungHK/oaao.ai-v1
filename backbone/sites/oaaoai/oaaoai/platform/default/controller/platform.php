<?php

namespace Module\oaao\platform;

use Oaaoai\Core\TenantContext;
use Razy\Agent;
use Razy\Controller;
use Razy\Database;

require_once dirname(__DIR__, 3) . '/core/default/library/SettingsRegister.php';
require_once dirname(__DIR__, 3) . '/core/default/library/TenantContext.php';
require_once dirname(__DIR__, 3) . '/core/default/library/TenantRepository.php';

use Oaaoai\Core\SettingsRegister;

/**
 * Platform control plane — tenant CRUD + usage (host {@code admin.localhost} / {@code kind=platform}).
 */
return new class extends Controller {
    protected function oaao_platform_require_pg(): ?Database
    {
        header('Content-Type: application/json; charset=UTF-8');

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return null;
        }

        $auth->restrict(true);

        $db = $auth->getDB();
        if (! $db instanceof Database || ! $db->getDBAdapter() instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Database unavailable']);

            return null;
        }

        $pdo = $db->getDBAdapter();
        $auth->ensurePgCoreTables($db);

        $core = $this->api('core');
        if ($core && $pdo instanceof \PDO) {
            $core->bootstrapTenantContext($pdo);
        }

        if (! $core || ! $core->tenantIsPlatform()) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Platform console is only available on the platform host']);

            return null;
        }

        $user = $auth->getUser();
        $UserModel = $auth->loadModel('User');
        if (! $UserModel || ! $UserModel::isPlatformOperator($user)) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Platform administrator required']);

            return null;
        }

        return $db;
    }

    public function __onInit(Agent $agent): bool
    {
        // {@see SettingsRegister} directly — {@code api('core')} is null during {@code __onInit} (target not Loaded yet).
        SettingsRegister::add(
            'settings-platform-tenants',
            'Tenants',
            'Tenant registry',
            'Whitelabel hosts, signup policy, and cross-tenant usage (platform host only).',
            'building-2',
            [
                'sort'            => 5,
                'panel_js_module' => '/webassets/platform/default/js/platform-tenants-panel.js',
                'label_key'       => 'settings.nav.platform_tenants.label',
                'title_key'       => 'settings.nav.platform_tenants.title',
                'sub_key'         => 'settings.nav.platform_tenants.sub',
            ],
        );

        $agent->addLazyRoute([
            'api' => [
                'GET tenants_list'      => 'tenants_list',
                'POST tenants_save'     => 'tenants_save',
                'POST tenants_hosts_add' => 'tenants_hosts_add',
                'POST qdrant_migrate'   => 'qdrant_migrate',
                'GET usage_summary'     => 'usage_summary',
            ],
        ]);

        return true;
    }
};
