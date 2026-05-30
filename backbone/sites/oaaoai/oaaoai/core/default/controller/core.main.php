<?php
/**
 * SPA shell — serves the Vite-built oaao.ai application.
 *
 * Reads the Vite manifest to resolve hashed JS/CSS filenames,
 * then renders the index template using Razy's template system
 * (blocks, includes, variable assignment).
 */
return function (): void {
    $config = $this->getModuleConfig();

    $isPlatformShell = false;
    try {
        require_once __DIR__ . '/../library/TenantContext.php';
        $authBootstrap = $this->api('auth');
        $bootstrapDb = $authBootstrap ? $authBootstrap->getDB() : null;
        $bootstrapPdo = $bootstrapDb?->getDBAdapter();
        if ($bootstrapPdo instanceof \PDO) {
            \Oaaoai\Core\TenantContext::bootstrap($bootstrapPdo);
            $isPlatformShell = \Oaaoai\Core\TenantContext::isPlatform();
        }
    } catch (\Throwable) {
        $isPlatformShell = false;
    }

    /** Always read static registry — avoids relying on {@code $this} binding for shell JSON ({@see SpaRegister}). */
    $spaPages = $isPlatformShell ? [] : \Oaaoai\Core\SpaRegister::allSorted();
    try {
        $spa_pages_json = json_encode(
            $spaPages,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        );
    } catch (\JsonException) {
        $spa_pages_json = '[]';
    }

    $settingsSections = $isPlatformShell ? [] : (method_exists($this, 'getSettingsSections') ? $this->getSettingsSections() : []);

    if (! $isPlatformShell) {
        try {
            if (\Oaaoai\Core\TenantContext::id() > 0 && ! \Oaaoai\Core\TenantContext::isPlatform()) {
                $settingsSections = array_values(array_filter(
                    $settingsSections,
                    static function (array $row): bool {
                        $id = (string) ($row['section_id'] ?? '');

                        return ! str_starts_with($id, 'settings-platform-');
                    },
                ));
            }
        } catch (\Throwable) {
        }
    } else {
        $platformNavSections = [
            [
                'section_id'      => 'platform-tenants',
                'label'           => 'Tenants',
                'title'           => 'Tenant registry',
                'sub'             => 'Host bindings, signup policy, and Qdrant migration.',
                'icon'            => 'building-2',
                'sort'            => 10,
                'panel_js_module' => '/webassets/platform/default/js/platform-tenants-panel.js',
            ],
            [
                'section_id'      => 'platform-release-notes',
                'label'           => 'Release notes',
                'title'           => "What's New & changelog",
                'sub'             => 'Publish release posts for all tenants (workspace notification + What\'s New dialog).',
                'icon'            => 'newspaper',
                'sort'            => 15,
                'panel_js_module' => '/webassets/platform/default/js/platform-release-notes-panel.js',
                'label_key'       => 'settings.nav.platform_release_notes.label',
                'title_key'       => 'settings.nav.platform_release_notes.title',
                'sub_key'         => 'settings.nav.platform_release_notes.sub',
            ],
            [
                'section_id'      => 'platform-usage',
                'label'           => 'Usage',
                'title'           => 'Cross-tenant usage',
                'sub'             => 'Users, vaults, and usage events per tenant.',
                'icon'            => 'bar-chart-3',
                'sort'            => 20,
                'panel_js_module' => '/webassets/platform/default/js/platform-usage-panel.js',
            ],
            [
                'section_id'      => 'platform-knowledge',
                'label'           => 'Knowledge',
                'title'           => 'Platform evolution',
                'sub'             => 'Auto web search, topic scoring, and oaao-level RAG (not tenant-facing).',
                'icon'            => 'globe',
                'sort'            => 30,
                'panel_js_module' => '/webassets/core/default/js/oaao-knowledge-settings-panel.js',
                'label_key'       => 'settings.nav.platform_knowledge.label',
                'title_key'       => 'settings.nav.platform_knowledge.title',
                'sub_key'         => 'settings.nav.platform_knowledge.sub',
            ],
        ];
        $settingsSections = $platformNavSections;
    }

    /** Global Settings dialog is administrator-only in the shell ({@code data-oaao-admin-settings}); APIs enforce admin separately.
     *
     * Always embed the full registry JSON here: SPA login does not reload this HTML — if we stripped sections for
     * anonymous first paint, administrators would keep an empty frozen {@code OAAO_SETTINGS_REGISTRY} after Ajax login.
     */
    $oaaoAdminSettings = '0';
    $oaaoSessionActiveClass = '';
    $oaaoUiLang = 'en';
    try {
        $authApi = $this->api('auth');
        // Emitter proxies commands via {@code __call}; {@see method_exists()} is not reliable on {@code $authApi}.
        if ($authApi) {
            $sessionUser = $authApi->getUser();
            if ($sessionUser) {
                $oaaoSessionActiveClass = ' oaao-session-active';
                if (isset($sessionUser->role)) {
                    $role = strtolower(trim((string) $sessionUser->role));
                    if ($isPlatformShell) {
                        $oaaoAdminSettings = $role === 'platform_admin' ? '1' : '0';
                    } elseif ($role === 'admin') {
                        $oaaoAdminSettings = '1';
                    }
                }
                try {
                    require_once dirname(__DIR__, 3) . '/user/default/library/UserDisplayPreferences.php';
                    $canonPdo = $authApi->getDB()?->getDBAdapter();
                    $uid = (int) ($sessionUser->user_id ?? 0);
                    if ($canonPdo instanceof \PDO && $uid > 0) {
                        $loc = \oaaoai\user\UserDisplayPreferences::localeForUser($canonPdo, $uid);
                        $oaaoUiLang = \in_array($loc, ['en', 'zh-Hant'], true) ? $loc : 'en';
                    }
                } catch (\Throwable) {
                    $oaaoUiLang = 'en';
                }
            }
        }
    } catch (\Throwable) {
        $oaaoAdminSettings = '0';
        $oaaoSessionActiveClass = '';
        $oaaoUiLang = 'en';
    }

    try {
        $settings_sections_json = json_encode(
            $settingsSections,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $settings_sections_json = '[]';
    }

    $featureScopes = $isPlatformShell ? [] : (method_exists($this, 'getFeatureScopes') ? $this->getFeatureScopes() : []);
    try {
        $feature_scopes_json = json_encode(
            $featureScopes,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $feature_scopes_json = '[]';
    }

    $preferencesSections = $isPlatformShell ? [] : (method_exists($this, 'getPreferencesSections') ? $this->getPreferencesSections() : []);
    try {
        $preferences_sections_json = json_encode(
            $preferencesSections,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $preferences_sections_json = '[]';
    }

    $purposeAllocationSlots = [];
    if (! $isPlatformShell) {
        try {
            $epApi = $this->api('endpoints');
            // Emitter proxies API commands via {@code __call} — {@see method_exists()} is unreliable here.
            if ($epApi) {
                $purposeAllocationSlots = $epApi->getPurposeAllocationSlots();
            }
        } catch (\Throwable) {
            $purposeAllocationSlots = [];
        }
    }
    try {
        $purpose_allocation_slots_json = json_encode(
            $purposeAllocationSlots,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $purpose_allocation_slots_json = '[]';
    }

    $chatPipelineRegistry = [];
    if (! $isPlatformShell) {
        try {
            $chatApi = $this->api('chat');
            if ($chatApi) {
                $chatPipelineRegistry = $chatApi->getChatPipelineRegistry();
            }
        } catch (\Throwable) {
            $chatPipelineRegistry = [];
        }
    }
    try {
        $chat_pipeline_registry_json = json_encode(
            $chatPipelineRegistry,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $chat_pipeline_registry_json = '[]';
    }

    $plannerAgentRegistry = [];
    if (! $isPlatformShell) {
        try {
            $chatApi = $this->api('chat');
            if ($chatApi) {
                $plannerAgentRegistry = $chatApi->getPlannerAgentRegistry();
            }
        } catch (\Throwable) {
            $plannerAgentRegistry = [];
        }
    }
    try {
        $planner_agent_registry_json = json_encode(
            $plannerAgentRegistry,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $planner_agent_registry_json = '[]';
    }

    $vaultDocumentHookRegistry = [];
    if (! $isPlatformShell) {
        try {
            $vaultApi = $this->api('vault');
            if ($vaultApi) {
                $vaultDocumentHookRegistry = $vaultApi->getVaultDocumentHookRegistry();
            }
        } catch (\Throwable) {
            $vaultDocumentHookRegistry = [];
        }
    }
    try {
        $vault_document_hook_registry_json = json_encode(
            $vaultDocumentHookRegistry,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $vault_document_hook_registry_json = '[]';
    }

    $asrUserPreferenceRegistry = [];
    if (! $isPlatformShell) {
        try {
            $epApi = $this->api('endpoints');
            if ($epApi && method_exists($epApi, 'getAsrUserPreferenceRegistry')) {
                $asrUserPreferenceRegistry = $epApi->getAsrUserPreferenceRegistry();
            }
        } catch (\Throwable) {
            $asrUserPreferenceRegistry = [];
        }
    }
    try {
        $asr_user_preference_registry_json = json_encode(
            $asrUserPreferenceRegistry,
            JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR | JSON_HEX_TAG
        );
    } catch (\JsonException) {
        $asr_user_preference_registry_json = '[]';
    }

    $source = $this->loadTemplate('index');

    $envHub = getenv('OAAO_SIDECAR_PORT');
    $sidecar_port = ($envHub !== false && $envHub !== '') ? $envHub : ($config['sidecar_port'] ?? null);

    $hubPort = (int) $sidecar_port;
    if ($sidecar_port === null || $sidecar_port === '') {
        $hubPort = 8103;
    } else {
        $hubPort = max(1, min($hubPort, 65535));
    }

    $root = $source->getRoot();

    $siteUrl = rtrim((string) $this->getSiteURL(), '/');
    $oaaoMountPrefix = '';
    if (\defined('RELATIVE_ROOT') && \is_string(RELATIVE_ROOT) && RELATIVE_ROOT !== '') {
        $seg = trim(str_replace('\\', '/', RELATIVE_ROOT), '/');
        if ($seg !== '') {
            $oaaoMountPrefix = '/' . $seg;
        }
    }

    /** @see backbone/sites/oaaoai/oaaoai/core/default/webassets/js/shell-registry-url.js {@code applyOaaoMountPrefix} */
    $oaaoPrefixedWebPath = static function (string $pathFromSiteRoot, string $mountPrefix): string {
        $pathOnly = '/' . ltrim($pathFromSiteRoot, '/');
        $prefix = $mountPrefix === '/' ? '' : rtrim(preg_replace('#/{2,}#', '/', $mountPrefix), '/');
        if ($prefix === '' || ! str_starts_with($pathOnly, '/')) {
            return $pathOnly;
        }
        if ($pathOnly === $prefix || str_starts_with($pathOnly, $prefix . '/')) {
            return $pathOnly;
        }

        return $prefix . $pathOnly;
    };

    /** Bump when shell ESM / dynamic import graph changes. Dev override: {@code OAAO_SHELL_ESM_V} env.
     *  Keep in sync with {@code OAAO_CHAT_SHELL_ASSET_REV} in chat/default/webassets/js/chat-panel.js.
     *  Prod: if {@code OAAO_SHELL_ESM_V} is pinned in Docker, it overrides this — update or remove that env on deploy. */
    $oaaoShellEsmRev = '20260530-bubble-persist-v234';
    $envShellEsmV = getenv('OAAO_SHELL_ESM_V');
    $oaao_shell_esm_v = ($envShellEsmV !== false && trim((string) $envShellEsmV) !== '')
        ? trim((string) $envShellEsmV)
        : $oaaoShellEsmRev;

    /** Canonical pathname = {@code dir(@oaao/core-js/)} ({@see shell-registry-url.js} — must stay in lockstep). */
    $coreJsPublicPrefix = \rtrim($oaaoPrefixedWebPath('/webassets/core/default/js/', $oaaoMountPrefix), '/');
    $coreJsDiskRoot = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'webassets' . DIRECTORY_SEPARATOR . 'js';
    $chatJsPublicPrefix = \rtrim($oaaoPrefixedWebPath('/webassets/chat/default/js/', $oaaoMountPrefix), '/');
    $chatJsDiskRoot = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'chat' . DIRECTORY_SEPARATOR . 'default'
        . DIRECTORY_SEPARATOR . 'webassets' . DIRECTORY_SEPARATOR . 'js';

    /**
     * Import-map scope: relative {@code ./} / {@code ../} sibling imports from {@code main.js} must carry {@code ?v=}
     * ({@code main.js?v=} alone does not bust {@code workspace.js} without a scope entry).
     *
     * @return array<string, string>
     */
    $oaaoBuildCoreJsImportScope = static function (string $diskRoot, string $publicPrefix, string $esmRev): array {
        /** @var array<string, string> $scope */
        $scope = [];
        $base = \rtrim($publicPrefix, '/') . '/';
        $qv = '?v=' . \rawurlencode($esmRev);

        if (! \is_dir($diskRoot)) {
            return $scope;
        }

        $diskRootNorm = \str_replace('\\', '/', $diskRoot);
        $diskRootReal = \rtrim(\realpath($diskRootNorm) ?: $diskRootNorm, '/') . '/';

        $resolveRelImport = static function (string $fromRelDir, string $spec) use ($diskRootReal): ?string {
            $fromRelDir = \str_replace('\\', '/', $fromRelDir);
            if ($fromRelDir === '.') {
                $fromRelDir = '';
            }
            $combined = $fromRelDir === '' ? $spec : $fromRelDir . '/' . $spec;
            /** @var list<string> $parts */
            $parts = [];
            foreach (\explode('/', \str_replace('\\', '/', $combined)) as $seg) {
                if ($seg === '' || $seg === '.') {
                    continue;
                }
                if ($seg === '..') {
                    \array_pop($parts);

                    continue;
                }
                $parts[] = $seg;
            }
            $resolved = \implode('/', $parts);
            if ($resolved === '' || ! \is_file($diskRootReal . $resolved)) {
                return null;
            }

            return $resolved;
        };

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($diskRoot, \FilesystemIterator::SKIP_DOTS)
        );
        /** @var \SplFileInfo $file */
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'js') {
                continue;
            }
            $abs = \str_replace('\\', '/', $file->getPathname());
            if (! \str_starts_with($abs, $diskRootReal)) {
                continue;
            }
            $rel = \substr($abs, \strlen($diskRootReal));
            $scope['./' . $rel] = $base . $rel . $qv;

            $content = @\file_get_contents($file->getPathname());
            if (! \is_string($content) || $content === '') {
                continue;
            }
            if (\preg_match_all('/\bfrom\s+[\'"]((\.\.)?\/[^\'"]+)[\'"]/', $content, $matches)) {
                $fromDir = \dirname($rel);
                foreach ($matches[1] as $spec) {
                    if (isset($scope[$spec])) {
                        continue;
                    }
                    $resolved = $resolveRelImport($fromDir, $spec);
                    if ($resolved !== null) {
                        $scope[$spec] = $base . $resolved . $qv;
                    }
                }
            }
        }

        return $scope;
    };

    /**
     * Per-file {@code @oaao/core-js/*} import-map entries with {@code ?v=} — the bare prefix fallback is unversioned
     * and browsers/CDN may keep stale modules after shell ESM rev bumps.
     *
     * @return array<string, string>
     */
    $oaaoBuildCoreJsVersionedImports = static function (string $diskRoot, string $publicPrefix, string $esmRev): array {
        /** @var array<string, string> $imports */
        $imports = [];
        $base = \rtrim($publicPrefix, '/') . '/';
        $qv = '?v=' . \rawurlencode($esmRev);

        if (! \is_dir($diskRoot)) {
            return $imports;
        }

        $diskRootNorm = \str_replace('\\', '/', $diskRoot);
        $diskRootReal = \rtrim(\realpath($diskRootNorm) ?: $diskRootNorm, '/') . '/';

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($diskRoot, \FilesystemIterator::SKIP_DOTS)
        );
        /** @var \SplFileInfo $file */
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'js') {
                continue;
            }
            $abs = \str_replace('\\', '/', $file->getPathname());
            if (! \str_starts_with($abs, $diskRootReal)) {
                continue;
            }
            $rel = \substr($abs, \strlen($diskRootReal));
            $imports['@oaao/core-js/' . $rel] = $base . $rel . $qv;
        }

        return $imports;
    };

    try {
        $coreJsScopePrefix = $coreJsPublicPrefix . '/';
        $coreJsScope = $oaaoBuildCoreJsImportScope($coreJsDiskRoot, $coreJsPublicPrefix, $oaao_shell_esm_v);
        $coreJsVersionedImports = $oaaoBuildCoreJsVersionedImports($coreJsDiskRoot, $coreJsPublicPrefix, $oaao_shell_esm_v);
        $chatJsScopePrefix = $chatJsPublicPrefix . '/';
        $chatJsScope = $oaaoBuildCoreJsImportScope($chatJsDiskRoot, $chatJsPublicPrefix, $oaao_shell_esm_v);
        $chatJsVersionedImports = $oaaoBuildCoreJsVersionedImports($chatJsDiskRoot, $chatJsPublicPrefix, $oaao_shell_esm_v);
        $chatBubbleJsQv = '?v=' . \rawurlencode($oaao_shell_esm_v);
        $chatJsVersionedImports['@oaao/chat-js/bubble-chat.js'] =
            \rtrim($chatJsPublicPrefix, '/') . '/bubble-chat.js' . $chatBubbleJsQv;
        $razyuiPublicPrefix = \rtrim($oaaoPrefixedWebPath('/webassets/core/default/razyui', $oaaoMountPrefix), '/');
        $razyuiDiskRoot = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'webassets' . DIRECTORY_SEPARATOR . 'razyui';
        $razyuiScopePrefix = $razyuiPublicPrefix . '/';
        $razyuiScope = $oaaoBuildCoreJsImportScope($razyuiDiskRoot, $razyuiPublicPrefix, $oaao_shell_esm_v);
        $razyuiUrl = $oaaoPrefixedWebPath('/webassets/core/default/razyui/razyui.js', $oaaoMountPrefix)
            . '?v=' . \rawurlencode($oaao_shell_esm_v);
        $oaao_import_map = [
            'imports' => \array_merge(
                $coreJsVersionedImports,
                $chatJsVersionedImports,
                [
                    '@oaao/core-js/'      => $coreJsScopePrefix,
                    '@oaao/chat-js/'      => $chatJsScopePrefix,
                    '@oaao/endpoints-js/' => $oaaoPrefixedWebPath('/webassets/core/default/js/endpoints-settings/', $oaaoMountPrefix),
                    'razyui'              => $razyuiUrl,
                ],
            ),
            'scopes' => [
                $coreJsScopePrefix  => $coreJsScope,
                $chatJsScopePrefix  => $chatJsScope,
                $razyuiScopePrefix  => $razyuiScope,
            ],
        ];
        $oaao_importmap_json = json_encode(
            $oaao_import_map,
            JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES
        );
    } catch (\JsonException) {
        $oaao_importmap_json = '{"imports":{}}';
    }
    // Resolve …/config/oaaoai/auth.php from this file path (stable); getModuleInfo()->getPath()
    // depth varies (e.g. …/core vs …/core/default) and broke dirname(…, 4).
    $authInstalled = false;
    try {
        $backboneRoot = dirname(__DIR__, 6);
        $authPhpPath  = $backboneRoot . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'oaaoai' . DIRECTORY_SEPARATOR . 'auth.php';
        if (is_file($authPhpPath)) {
            /** @var mixed $authSnap */
            $authSnap = require $authPhpPath;
            if (is_array($authSnap)) {
                $authInstalled = (bool) ($authSnap['installed'] ?? false);
            }
        }
    } catch (\Throwable) {
        $authInstalled = false;
    }

    $envPg = getenv('OAAO_PG_URL');
    $pgEnvSet = ($envPg !== false && trim((string) $envPg) !== '');
    $inDocker = \is_file('/.dockerenv')
        || strtolower((string) getenv('OAAO_DOCKER')) === '1'
        || strtolower((string) getenv('RUNNING_IN_CONTAINER')) === '1';
    $simplePgUi = $inDocker && $pgEnvSet;
    $authPgPrefill = '';
    $authPgPrefillJson = 'null';
    $authPgRedacted = '';
    if ($simplePgUi) {
        $trimmed = trim((string) $envPg);
        try {
            $authPgPrefillJson = json_encode($trimmed, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
        } catch (\JsonException) {
            $authPgPrefillJson = 'null';
        }
        $parts = parse_url($trimmed);
        $scheme = strtolower((string) (($parts && \is_array($parts)) ? ($parts['scheme'] ?? '') : ''));
        if (\is_array($parts) && ($scheme === 'postgresql' || $scheme === 'postgres')) {
            $user = (string) ($parts['user'] ?? '');
            $host = (string) ($parts['host'] ?? '');
            $port = isset($parts['port']) ? ':' . $parts['port'] : '';
            $db = rawurldecode(ltrim((string) ($parts['path'] ?? ''), '/'));
            $authPgRedacted = htmlspecialchars(
                $scheme . '://' . rawurlencode($user) . ':***@' . $host . $port . '/' . $db,
                ENT_QUOTES | ENT_HTML5,
                'UTF-8'
            );
        } else {
            $authPgRedacted = htmlspecialchars(
                'Connection string is set — use Advanced to inspect or override.',
                ENT_QUOTES | ENT_HTML5,
                'UTF-8'
            );
        }
    }

    // Tenant-facing shell label — bound from request host until explicit tenant branding metadata ships.
    $hostRaw = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    $hostRaw = (string) preg_replace('/:\\d+$/', '', $hostRaw);
    $oaaoTenantDisplay = $hostRaw !== '' ? $hostRaw : 'oaao.ai';
    if (strlen($oaaoTenantDisplay) > 120) {
        $oaaoTenantDisplay = substr($oaaoTenantDisplay, 0, 117) . '…';
    }

    $oaaoCoreDerivedRoot = \preg_replace('#/js$#', '', $coreJsPublicPrefix);
    $oaaoCoreWebassetsPath =
        (\is_string($oaaoCoreDerivedRoot) && $oaaoCoreDerivedRoot !== '')
            ? $oaaoCoreDerivedRoot
            : '/webassets/core/default';
    $oaao_core_webassets_root = htmlspecialchars(
        $oaaoCoreWebassetsPath,
        ENT_QUOTES | ENT_HTML5,
        'UTF-8'
    );

    require_once dirname(__DIR__, 3) . '/chat/default/library/OrchestratorPublicBase.php';
    $oaao_orchestrator_stream_proxy = htmlspecialchars(
        $oaaoPrefixedWebPath(\oaaoai\chat\OrchestratorPublicBase::sidecarPath(), $oaaoMountPrefix),
        ENT_QUOTES | ENT_HTML5,
        'UTF-8'
    );

    /** SPA session/bootstrap — pathname only; never bake {@see getSiteURL()} host ({@code http://web} vs browser {@code localhost} breaks credentials). */
    $auth_web_path = \rtrim($oaaoPrefixedWebPath('/auth', $oaaoMountPrefix), '/') . '/';

    require_once dirname(__DIR__) . '/library/OaaoBuildInfo.php';
    $oaaoBuild = \Oaaoai\Core\OaaoBuildInfo::load();
    $oaaoVersion = htmlspecialchars((string) ($oaaoBuild['version'] ?? '0.0.0'), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $oaaoBuildId = htmlspecialchars((string) ($oaaoBuild['build_id'] ?? 'unknown'), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $oaaoGitSha = htmlspecialchars((string) ($oaaoBuild['git_sha'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');

    // Assign layout-level variables
    $root->assign([
        'oaao_tenant_display' => htmlspecialchars($oaaoTenantDisplay, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'page_title'       => $isPlatformShell ? 'oaao Platform — tenant control plane' : 'oaao.ai — AI workspace (preview)',
        'meta_description' => $isPlatformShell ? 'oaao Platform — manage tenants, hosts, and usage' : 'oaao.ai — AI chat workspace (preview)',
        'site_url'         => $siteUrl . '/',
        'stream_base'      => $siteUrl . '/',
        'hub_port'         => $hubPort,
        'asset_path'       => $this->getAssetPath(),
        'spa_pages_json'   => $spa_pages_json,
        'settings_sections_json' => $settings_sections_json,
        'preferences_sections_json' => $preferences_sections_json,
        'purpose_allocation_slots_json' => $purpose_allocation_slots_json,
        'chat_pipeline_registry_json'   => $chat_pipeline_registry_json,
        'planner_agent_registry_json'   => $planner_agent_registry_json,
        'vault_document_hook_registry_json' => $vault_document_hook_registry_json,
        'asr_user_preference_registry_json' => $asr_user_preference_registry_json,
        'feature_scopes_json'    => $feature_scopes_json,
        'oaao_admin_settings'    => $oaaoAdminSettings,
        'oaao_platform_host'     => $isPlatformShell ? '1' : '0',
        'oaao_session_active_class' => $oaaoSessionActiveClass,
        'oaao_ui_lang'                => htmlspecialchars($oaaoUiLang, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'oaao_mount_prefix'       => htmlspecialchars($oaaoMountPrefix, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'oaao_core_webassets_root' => $oaao_core_webassets_root,
        'oaao_orchestrator_stream_proxy' => $oaao_orchestrator_stream_proxy,
        'oaao_shell_esm_v'        => htmlspecialchars($oaao_shell_esm_v, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'oaao_version'            => $oaaoVersion,
        'oaao_build_id'           => $oaaoBuildId,
        'oaao_git_sha'            => $oaaoGitSha,
        'oaao_importmap_json'    => $oaao_importmap_json,
        'auth_installed'   => $authInstalled ? '1' : '0',
        'auth_base'        => htmlspecialchars($auth_web_path, ENT_QUOTES | ENT_HTML5, 'UTF-8'),
        'auth_pg_env'              => $pgEnvSet ? '1' : '0',
        'auth_pg_prefill'          => $authPgPrefill,
        'auth_pg_prefill_json'     => $authPgPrefillJson,
        'auth_pg_redacted'         => $authPgRedacted,
        'auth_pg_docker'           => $inDocker ? '1' : '0',
        'auth_pg_simple_docker'    => $simplePgUi ? '1' : '0',
        'auth_pg_simple_wrap_class' => $simplePgUi ? '' : 'hidden',
        'auth_pg_url_wrap_class'    => $simplePgUi ? 'hidden' : '',
        'auth_pg_env_hint_class'    => $pgEnvSet ? '' : 'hidden',
    ]);

    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');

    echo $source->output();
};