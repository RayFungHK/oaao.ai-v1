<?php

namespace Module\oaao\user;

use Razy\Agent;
use Razy\Controller;

/**
 * User module: Preferences dialog panels ({@code api('core')->registerPreferencesSection}) + personal-scope capability ({@code registerFeatureScope}).
 * Global Settings panels remain admin-only ({@see core.main.php}).
 */
return new class extends Controller {
    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi) {
            $coreApi->registerPreferencesSection(
                'pref-overview',
                'Overview',
                'Your preferences',
                'Scopes show where each section applies (tenant, workspace, or personal).',
                'circle-user-round',
                [
                    'sort'       => 0,
                    'levels'     => ['personal'],
                    'panel_html' => '<p data-oaao-pref-greeting class="text-lg fw-semibold mb-sm fg-[var(--grid-ink)]"></p>'
                        . '<p class="text-sm fg-[var(--grid-ink-muted)] max-w-[36rem] leading-relaxed mb-lg">'
                        . '<strong class="fg-[var(--grid-ink)]">Tenant</strong> affects org-wide defaults; '
                        . '<strong class="fg-[var(--grid-ink)]">Workspace</strong> isolates team/env settings; '
                        . '<strong class="fg-[var(--grid-ink)]">Personal</strong> follows your account when no workspace context applies.'
                        . '</p>'
                        . '<p class="text-sm fg-[var(--grid-ink-muted)] max-w-[36rem] leading-relaxed">'
                        . 'Modules append sections via <code class="font-mono text-xs">registerPreferencesSection</code> with '
                        . '<code class="font-mono text-xs">extras.levels</code>.</p>',
                ],
            );

            $coreApi->registerPreferencesSection(
                'pref-profile',
                'Profile',
                'Profile',
                'Identity and display — personal scope.',
                'user-circle',
                [
                    'sort'       => 10,
                    'levels'     => ['personal'],
                    'panel_html' => '<div class="oaao-sdlg-section-title mb-sm">Profile</div>'
                        . '<p class="oaao-sdlg-section-desc mb-lg">Signed-in identity and display name will bind here.</p>',
                ],
            );

            $coreApi->registerPreferencesSection(
                'pref-appearance',
                'Appearance',
                'Appearance',
                'Theme and density — personal scope.',
                'sun-1',
                [
                    'sort'       => 20,
                    'levels'     => ['personal'],
                    'panel_html' => '<div class="oaao-sdlg-section-title mb-sm">Appearance</div>'
                        . '<p class="oaao-sdlg-section-desc mb-md">Theme follows the grid shell preset.</p>'
                        . '<select disabled class="w-full max-w-[20rem] rounded-[10px] h-10 px-3 text-[0.875rem] fg-[var(--grid-caption)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-not-allowed font-inherit opacity-70 mb-lg">'
                        . '<option>System</option></select>',
                ],
            );

            $coreApi->registerPreferencesSection(
                'pref-language',
                'Language',
                'Language & region',
                'Locale — personal scope.',
                'globe-1',
                [
                    'sort'       => 30,
                    'levels'     => ['personal'],
                    'panel_html' => '<div class="oaao-sdlg-section-title mb-sm">Display language</div>'
                        . '<p class="oaao-sdlg-section-desc mb-md">Locale mirrors the legacy i18n pipeline.</p>'
                        . '<select disabled class="w-full max-w-[20rem] rounded-[10px] h-10 px-3 text-[0.875rem] fg-[var(--grid-caption)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-not-allowed font-inherit opacity-70 mb-lg">'
                        . '<option>English</option></select>',
                ],
            );

            $coreApi->registerPreferencesSection(
                'pref-data',
                'Data',
                'Data & privacy',
                'Retention — personal scope.',
                'database-2',
                [
                    'sort'       => 50,
                    'levels'     => ['personal'],
                    'panel_html' => '<div class="oaao-sdlg-section-title mb-sm">Vault &amp; retention</div>'
                        . '<p class="oaao-sdlg-section-desc">Export and retention align with orchestrator-backed vault APIs when enabled.</p>',
                ],
            );

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
                'GET profile'     => 'profile',
                'GET users_list'  => 'users_list',
                'POST users_save' => 'users_save',
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
