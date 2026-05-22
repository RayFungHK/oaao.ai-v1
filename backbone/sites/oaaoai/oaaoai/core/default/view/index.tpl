<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="description" content="{$meta_description}">
    <meta name="theme-color" content="#f8f8f7" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#1f1f1e" media="(prefers-color-scheme: dark)">
    <meta name="color-scheme" content="light dark">
    <meta name="format-detection" content="telephone=no">
    <!-- PWA / iOS "Add to Home Screen" — paths follow {@code $asset_path} so subdirectory installs work -->
    <link rel="manifest" href="{$asset_path}manifest.webmanifest">
    <link rel="icon" type="image/svg+xml" href="{$asset_path}oaao-icon.svg">
    <link rel="apple-touch-icon" href="{$asset_path}apple-touch-icon.svg">
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
    </style>
    <link rel="stylesheet" crossorigin href="{$asset_path}css/oaao.css">
    <link rel="stylesheet" crossorigin href="{$asset_path}razyui/razyui.css">
    <link rel="stylesheet" crossorigin href="{$asset_path}css/razyui-icons.css">
    <!-- Same font as razyui-icons.css but URLs from PHP {@code $asset_path} — guarantees resolution vs ../fonts when base path differs -->
    <style>
        @font-face {
            font-family: 'razyui-icons';
            src: url('{$asset_path}fonts/razyui-icons.woff2') format('woff2'),
                 url('{$asset_path}fonts/razyui-icons.woff') format('woff'),
                 url('{$asset_path}fonts/razyui-icons.ttf') format('truetype');
            font-weight: normal;
            font-style: normal;
            font-display: swap;
        }
    </style>
    <link rel="preload" href="{$asset_path}fonts/razyui-icons.woff2" as="font" type="font/woff2" crossorigin>
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
    <script type="module" crossorigin src="{$asset_path}js/main.js"></script>
</head>
<body class="oaao-app oaao-theme-grid min-h-[100dvh] flex flex-col bg-[var(--grid-paper)]{$oaao_session_active_class}" data-auth-installed="{$auth_installed}" data-auth-base="{$auth_base}" data-auth-pg-env="{$auth_pg_env}" data-auth-docker="{$auth_pg_docker}" data-auth-pg-simple-docker="{$auth_pg_simple_docker}" data-oaao-mount-prefix="{$oaao_mount_prefix}" data-oaao-core-webassets-root="{$oaao_core_webassets_root}" data-oaao-shell-esm-v="{$oaao_shell_esm_v}" data-oaao-admin-settings="{$oaao_admin_settings}" data-oaao-platform-host="{$oaao_platform_host}">
    <!-- INCLUDE BLOCK: include/install.tpl -->
    <!-- INCLUDE BLOCK: include/login.tpl -->
    <!-- INCLUDE BLOCK: include/platform.tpl -->
    <!-- INCLUDE BLOCK: include/workspace.tpl -->
</body>
</html>