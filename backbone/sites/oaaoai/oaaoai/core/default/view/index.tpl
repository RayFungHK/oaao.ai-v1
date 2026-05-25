<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
    <meta name="description" content="{$meta_description}">
    <meta name="theme-color" content="#f8f8f7" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1f1f1e" media="(prefers-color-scheme: dark)">
    <meta name="color-scheme" content="light dark">
    <meta name="format-detection" content="telephone=no">
    <!-- PWA / iOS "Add to Home Screen" — paths follow {@code $asset_path} so subdirectory installs work -->
    <link rel="manifest" href="{$asset_path}manifest.webmanifest?v={$oaao_shell_esm_v}">
    <link rel="icon" type="image/svg+xml" href="{$asset_path}oaao-icon.svg?v={$oaao_shell_esm_v}">
    <link rel="apple-touch-icon" href="{$asset_path}apple-touch-icon.svg?v={$oaao_shell_esm_v}">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="apple-mobile-web-app-title" content="oaao.ai">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="application-name" content="oaao.ai">
    <title>{$page_title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        [razyui-cloak]:not([razyui-cloak="ready"]) { opacity: 0; visibility: hidden; pointer-events: none; }
        /* Critical: JIT {@code .flex} can override {@code [hidden]} before {@code oaao.css} — keep shells off-screen until JS unhides. */
        #workspace-view[hidden], #platform-view[hidden], #login-view[hidden], #install-view[hidden] { display: none !important; }
        /* Session boot cloak — animated brand mark while JIT hydrates workspace shell (no JIT dependency). */
        .oaao-app-boot { display: none; position: fixed; inset: 0; z-index: 500; align-items: center; justify-content: center; background: #f8f8f7; pointer-events: none; }
        .oaao-app.oaao-session-active:not(.oaao-shell-ready) .oaao-app-boot { display: flex; }
        .oaao-app-boot__logo { width: 48px; height: 48px; display: block; object-fit: contain; flex: none; }
        @media (prefers-color-scheme: dark) { .oaao-app-boot { background: #1f1f1e; } }
        /* Inline AJAX/JSON loaders — animated logo ({@see oaao-loading-logo.js}). */
        .oaao-loading-logo { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem; box-sizing: border-box; }
        .oaao-loading-logo--block { width: 100%; min-height: 1.75rem; padding: 0.375rem 0.5rem; }
        .oaao-loading-logo--fill { width: 100%; flex: 1; min-height: 2.5rem; padding: 0.5rem; }
        .oaao-loading-logo--inline { display: inline-flex; vertical-align: middle; padding: 0.125rem 0; }
        .oaao-loading-logo__img { width: var(--oaao-loading-logo-size, 16px); height: var(--oaao-loading-logo-size, 16px); display: block; object-fit: contain; flex: none; }
        /* Chat composer + evolution queue — critical layout (no JIT / no stale oaao.css dependency). */
        .oaao-app [data-oaao-chat='composer-region']:not(.oaao-chat-composer-region--thread-float) { align-items: center; }
        .oaao-app [data-oaao-chat='composer-dock'] { width: 100%; max-width: 48rem; margin-inline: auto; align-self: center; flex-shrink: 0; box-sizing: border-box; }
        .oaao-app [data-oaao-chat='composer-region']:not(.oaao-chat-composer-region--thread-float) > [data-oaao-chat='composer-dock'] { padding-left: max(1.125rem, env(safe-area-inset-left, 0px)); padding-right: max(1.125rem, env(safe-area-inset-right, 0px)); }
        @media (min-width: 640px) { .oaao-app [data-oaao-chat='composer-region']:not(.oaao-chat-composer-region--thread-float) > [data-oaao-chat='composer-dock'] { padding-left: max(2rem, env(safe-area-inset-left, 0px)); padding-right: max(2rem, env(safe-area-inset-right, 0px)); } }
        .oaao-app [data-oaao-chat='composer-card-wrap'] { border-radius: 22px; overflow: hidden; box-sizing: border-box; background: #fff; border: 1px solid rgba(0, 0, 0, 0.12); box-shadow: 0 12px 32px rgba(0, 0, 0, 0.06); }
        .oaao-app [data-oaao-chat='prompt-grid'] { width: 100%; max-width: 48rem; margin-inline: auto; align-self: center; flex-shrink: 0; box-sizing: border-box; padding-left: max(1.125rem, env(safe-area-inset-left, 0px)); padding-right: max(1.125rem, env(safe-area-inset-right, 0px)); }
        @media (min-width: 640px) { .oaao-app [data-oaao-chat='prompt-grid'] { padding-left: max(2rem, env(safe-area-inset-left, 0px)); padding-right: max(2rem, env(safe-area-inset-right, 0px)); } }
        .oaao-evolution-queue-panel { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; max-width: 42rem; width: 100%; }
        .oaao-evolution-queue-panel__intro { font-size: 0.8125rem; color: var(--grid-ink-muted, #666); line-height: 1.45; margin: 0; }
        .oaao-evolution-queue-panel__warn { font-size: 0.8125rem; color: var(--grid-caution, #b45309); margin: 0 0 0.25rem; }
        .oaao-evolution-queue-panel__section-title { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--grid-caption, #888); font-weight: 600; margin: 0 0 0.5rem; }
        .oaao-evolution-queue-panel__updated { font-size: 0.6875rem; color: var(--grid-caption, #888); margin: 0; padding-top: 0.25rem; border-top: 1px solid var(--grid-line, rgba(0,0,0,.08)); }
        .oaao-evolution-queue-status-card { border-radius: 10px; border: 1px solid var(--grid-line, rgba(0,0,0,.08)); background: var(--grid-paper, #fafafa); overflow: hidden; width: 100%; box-sizing: border-box; }
        .oaao-evolution-queue-status-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; min-height: 2.75rem; padding: 0.875rem 1.25rem; box-sizing: border-box; }
        .oaao-evolution-queue-status-row + .oaao-evolution-queue-status-row { border-top: 1px solid var(--grid-line, rgba(0,0,0,.08)); }
        .oaao-evolution-queue-status-row__label { font-size: 0.8125rem; font-weight: 500; color: var(--grid-ink, #111); line-height: 1.4; min-width: 0; }
        .oaao-evolution-queue-status-row__value { font-size: 0.8125rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--grid-ink, #111); flex-shrink: 0; text-align: right; line-height: 1.4; }
        .oaao-evolution-queue-table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid var(--grid-line, rgba(0,0,0,.08)); background: var(--grid-paper, #fafafa); }
        .oaao-evolution-queue-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.8125rem; }
        .oaao-evolution-queue-table thead tr { border-bottom: 1px solid var(--grid-line, rgba(0,0,0,.08)); background: color-mix(in srgb, var(--grid-ink, #111) 4%, transparent); }
        .oaao-evolution-queue-table th { padding: 0.5rem 0.75rem; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--grid-caption, #888); }
        .oaao-evolution-queue-table td { padding: 0.5rem 0.75rem; vertical-align: top; }
        .oaao-evolution-queue-table tbody tr + tr { border-top: 1px solid var(--grid-line, rgba(0,0,0,.08)); }
        .oaao-evolution-queue-table__mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.75rem; }
        .oaao-evolution-queue-table__muted { color: var(--grid-ink-muted, #666); font-size: 0.75rem; }
    </style>
    <link rel="stylesheet" crossorigin href="{$asset_path}css/oaao.css?v={$oaao_shell_esm_v}">
    <link rel="stylesheet" crossorigin href="{$asset_path}razyui/razyui.css?v={$oaao_shell_esm_v}">
    <link rel="stylesheet" crossorigin href="{$asset_path}css/razyui-icons.css?v={$oaao_shell_esm_v}">
    <!-- Same font as razyui-icons.css but URLs from PHP {@code $asset_path} — guarantees resolution vs ../fonts when base path differs -->
    <style>
        @font-face {
            font-family: 'razyui-icons';
            src: url('{$asset_path}fonts/razyui-icons.woff2?v={$oaao_shell_esm_v}') format('woff2'),
                 url('{$asset_path}fonts/razyui-icons.woff?v={$oaao_shell_esm_v}') format('woff'),
                 url('{$asset_path}fonts/razyui-icons.ttf?v={$oaao_shell_esm_v}') format('truetype');
            font-weight: normal;
            font-style: normal;
            font-display: swap;
        }
    </style>
    <link rel="preload" href="{$asset_path}fonts/razyui-icons.woff2?v={$oaao_shell_esm_v}" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="{$asset_path}images/logo_animated.svg?v={$oaao_shell_esm_v}" as="image" type="image/svg+xml">
    <!-- Registries: SPA + admin Settings + user Preferences + feature scopes -->
    <script type="application/json" id="oaao-spa-registry">{$spa_pages_json}</script>
    <script type="application/json" id="oaao-settings-registry">{$settings_sections_json}</script>
    <script type="application/json" id="oaao-preferences-registry">{$preferences_sections_json}</script>
    <!-- Capability scopes: tenant / workspace / personal (@see FeatureScopeRegister) -->
    <script type="application/json" id="oaao-feature-scope-registry">{$feature_scopes_json}</script>
    <script type="application/json" id="oaao-purpose-allocation-registry">{$purpose_allocation_slots_json}</script>
    <script type="application/json" id="oaao-chat-pipeline-registry">{$chat_pipeline_registry_json}</script>
    <script type="application/json" id="oaao-planner-agent-registry">{$planner_agent_registry_json}</script>
    <script type="application/json" id="oaao-vault-document-hook-registry">{$vault_document_hook_registry_json}</script>
    <!-- ES module specifiers {@code @oaao/*}, {@code razyui} — paths prefixed like {@see shell-registry-url.js} -->
    <script type="importmap">
{$oaao_importmap_json}
</script>
    <script type="module" crossorigin src="{$asset_path}js/main.js?v={$oaao_shell_esm_v}"></script>
</head>
<body class="oaao-app oaao-theme-grid min-h-[100dvh] flex flex-col bg-[var(--grid-paper)]{$oaao_session_active_class}" data-auth-installed="{$auth_installed}" data-auth-base="{$auth_base}" data-auth-pg-env="{$auth_pg_env}" data-auth-docker="{$auth_pg_docker}" data-auth-pg-simple-docker="{$auth_pg_simple_docker}" data-oaao-mount-prefix="{$oaao_mount_prefix}" data-oaao-core-webassets-root="{$oaao_core_webassets_root}" data-oaao-shell-esm-v="{$oaao_shell_esm_v}" data-oaao-orchestrator-stream-proxy="{$oaao_orchestrator_stream_proxy}" data-oaao-admin-settings="{$oaao_admin_settings}" data-oaao-platform-host="{$oaao_platform_host}">
    <div id="oaao-app-boot" class="oaao-app-boot" aria-hidden="true" role="status" aria-live="polite">
        <img src="{$asset_path}images/logo_animated.svg?v={$oaao_shell_esm_v}" alt="" width="48" height="48" decoding="async" class="oaao-app-boot__logo" />
    </div>
    <!-- INCLUDE BLOCK: include/install.tpl -->
    <!-- INCLUDE BLOCK: include/login.tpl -->
    <!-- INCLUDE BLOCK: include/platform.tpl -->
    <!-- INCLUDE BLOCK: include/workspace.tpl -->
    <script>
        (function () {
            var BOOT_FAIL_MS = 12000;
            function dismissOaaoBoot() {
                var b = document.body;
                if (!b.classList.contains('oaao-session-active') || b.classList.contains('oaao-shell-ready')) return;
                b.classList.add('oaao-shell-ready');
                var w = document.getElementById('workspace-view');
                if (w) {
                    w.hidden = false;
                    w.setAttribute('razyui-cloak', 'ready');
                }
            }
            window.addEventListener('oaao:shell-ready', dismissOaaoBoot);
            if (document.body.classList.contains('oaao-session-active')) {
                setTimeout(dismissOaaoBoot, BOOT_FAIL_MS);
            }
        })();
    </script>
</body>
</html>