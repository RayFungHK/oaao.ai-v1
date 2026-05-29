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
                'GET model_params'        => 'model_params',
                'POST model_params_save'  => 'model_params_save',
                'GET asr_preferences'     => 'asr_preferences',
                'POST asr_preferences'    => 'asr_preferences',
                'GET personalization'         => 'personalization',
                'POST personalization_save'   => 'personalization_save',
                'GET personalization_survey'      => 'personalization_survey',
                'POST personalization_survey_save'  => 'personalization_survey_save',
                'POST personalization_survey_wizard_samples' => 'personalization_survey_wizard_samples',
                'POST personalization_survey_wizard_infer'   => 'personalization_survey_wizard_infer',
                'POST personalization_survey_wizard_finalize' => 'personalization_survey_wizard_finalize',
                'POST personalization_survey_wizard_guided'   => 'personalization_survey_wizard_guided',
                'GET release_notes_list'        => 'release_notes_list',
                'GET notifications_list'        => 'notifications_list',
                'POST notifications_mark_read'  => 'notifications_mark_read',
                'POST notifications_send'       => 'notifications_send',
                'GET users_list'        => 'users_list',
                'GET users_dashboard'   => 'users_dashboard',
                'POST users_save'              => 'users_save',
                'POST users_invite'            => 'users_invite',
                'POST users_invite_resend'     => 'users_invite_resend',
                'POST users_invite_revoke'     => 'users_invite_revoke',
                'GET users_invitations_list'   => 'users_invitations_list',
                'GET register_validate'        => 'register_validate',
                'POST register_complete'       => 'register_complete',
                'POST password_reset_request'  => 'password_reset_request',
                'GET password_reset_validate'  => 'password_reset_validate',
                'POST password_reset_complete' => 'password_reset_complete',
            ],
        ]);

        $agent->addRoute('GET /user/register', 'panel/register_page');
        $agent->addRoute('GET /user/reset-password', 'panel/reset_password_page');

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
