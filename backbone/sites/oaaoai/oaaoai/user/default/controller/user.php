<?php

namespace Module\oaao\user;

use Razy\Agent;
use Razy\Controller;

/**
 * User module: personal profile APIs ({@code /user/api/*}) + admin user management Settings panel.
 *
 * Preferences dialog sections (Dashboard, Personal) are registered from {@see oaaoai/core} {@code __onInit}
 * so {@code #oaao-preferences-registry} is populated before {@see core.main.php} embed.
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerFeatureScope(
                'profile.preferences',
                'Preferences',
                'Profile and personal defaults (user-global within the tenant when no workspace context).',
                ['personal'],
                80,
            );
        }

        $agent->addLazyRoute([
            'api' => [
                'GET profile'           => 'profile',
                'GET dashboard'         => 'dashboard',
                'POST profile_save'     => 'profile_save',
                'POST password_change'  => 'password_change',
                'POST preferences_save' => 'preferences_save',
                'GET personalization'         => 'personalization',
                'POST personalization_save'   => 'personalization_save',
                'GET notifications_list'        => 'notifications_list',
                'POST notifications_mark_read'  => 'notifications_mark_read',
                'POST notifications_send'       => 'notifications_send',
                'GET users_list'        => 'users_list',
                'POST users_save'       => 'users_save',
            ],
        ]);

        if ($coreApi) {
            $js = '/webassets/core/default/js/oaao-access-settings-panel.js';
            $coreApi->registerSettingsSection(
                'settings-users',
                'Users',
                'User management',
                'Create accounts, assign permission groups, and manage access.',
                'users',
                [
                    'sort'            => 16,
                    'panel_js_module' => $js,
                    'label_key'       => 'settings.nav.users.label',
                    'title_key'       => 'settings.nav.users.title',
                    'sub_key'         => 'settings.nav.users.sub',
                ],
            );
        }

        return true;
    }
};
