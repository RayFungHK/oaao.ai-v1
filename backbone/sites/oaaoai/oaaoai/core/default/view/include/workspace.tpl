    <!-- Authenticated shell: icon rail + sidebar + main (all layout via JIT utilities — {@see oaao-jit.js} tokens only). -->
    <div id="workspace-view"
        class="workspace-view-shell flex flex-col flex-1 w-full box-border min-h-[100dvh] h-[100dvh] max-h-[100dvh] overflow-hidden bg-[var(--grid-paper)]"
        hidden razyui-cloak>
        <div class="workspace-shell-inner flex flex-1 min-h-0 min-w-0 w-full h-full max-h-full overflow-hidden items-stretch">
            <!-- Left: narrow rail + sidebar (on narrow viewports becomes slide-over drawer; see oaao.css + workspace.js) -->
            <aside id="workspace-shell-aside"
                class="oaao-shell-aside flex shrink-0 min-w-0 items-stretch overflow-hidden bg-[var(--grid-panel-bright)] border-solid border-[var(--grid-line)] fixed z-50 left-[env(safe-area-inset-left,0px)] top-[env(safe-area-inset-top,0px)] bottom-[env(safe-area-inset-bottom,0px)] h-auto max-h-none min-h-[100dvh] w-max max-w-[calc(100vw-env(safe-area-inset-left,0px)-env(safe-area-inset-right,0px))] -translate-x-[104%] border-r-0 shadow-none transition-transform duration-[220ms] ease-out md:relative md:left-auto md:top-auto md:bottom-auto md:h-full md:max-h-full md:min-h-full md:w-auto md:max-w-none md:translate-x-0 md:transition-none md:self-stretch md:border-r-[1px] md:shadow-none"
                aria-label="Workspace navigation">
                <!-- Icon rail — legacy {@code oaao-rail}: scroll spine + footer pins Settings ({@code #settings-rail-btn}) -->
                <div id="workspace-icon-rail"
                    class="workspace-icon-rail flex flex-col w-[var(--oaao-rail-width,52px)] shrink-0 items-stretch min-h-0 h-full max-h-full min-w-[var(--oaao-rail-width,52px)] border-r-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-nav)] pt-md">
                    <div class="oaao-rail-pin-stack flex flex-col items-center gap-1 shrink-0">
                        <button type="button" id="workspace-rail-logo"
                            class="flex items-center justify-center w-10 h-10 rounded-[10px] hover:bg-[var(--grid-line)]/45 border-none bg-transparent cursor-pointer font-inherit select-none p-0 mb-xs"
                            title="Chat"
                            aria-label="Chat">
                            <img src="{$asset_path}images/logo.svg?v={$oaao_shell_esm_v}" alt="" class="w-[22px] h-[22px]" width="22" height="22" />
                        </button>
                        <button type="button" id="workspace-rail-chat"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none"
                            title="Chat"
                            aria-label="Chat">
                            <!-- Lucide MessageSquare — label from {@see workspace.js applyWorkspaceShellLabels} ({@code title} + {@code aria-label}). -->
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </button>
                        <button type="button" id="workspace-rail-vault"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none hidden"
                            title="Vault"
                            aria-label="Vault">
                            <!-- Lucide Archive -->
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                        </button>
                        <button type="button" id="workspace-rail-agents"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none hidden"
                            title="Agents"
                            aria-label="Agents">
                            <!-- Lucide Bot -->
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                        </button>
                        <button type="button" id="workspace-rail-templates"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none hidden"
                            title="Slide templates"
                            aria-label="Slide templates">
                            <span data-oaao-rui-icon="square-dashed-kanban" data-oaao-rui-icon-size="18" data-oaao-rui-icon-class="oaao-rail-svg w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" class="inline-flex items-center justify-center shrink-0" aria-hidden="true"></span>
                        </button>
                        <button type="button" id="workspace-rail-live-meeting"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none hidden"
                            title="Live meeting"
                            aria-label="Live meeting">
                            <!-- Lucide Mic -->
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                        </button>
                        <button type="button" id="workspace-rail-research"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none hidden"
                            title="Article Research"
                            aria-label="Article Research">
                            <!-- Lucide Microscope -->
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/></svg>
                        </button>
                        <button type="button" id="workspace-rail-mines"
                            class="oaao-rail-pin-btn shrink-0 flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none hidden"
                            title="Data Mining"
                            aria-label="Data Mining">
                            <!-- Lucide Database -->
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
                        </button>
                    </div>
                    <div class="workspace-rail-scroll flex-1 min-h-0 min-w-0" aria-hidden="true"></div>
                    <div class="workspace-rail-footer shrink-0 flex flex-col items-center pb-md pt-xs gap-1 w-full">
                        <button type="button" id="workspace-rail-settings"
                            class="w-9 h-9 rounded-[10px] flex items-center justify-center fg-[var(--grid-caption)] opacity-90 hover:bg-[var(--grid-line)]/35 hover:opacity-100 bg-transparent border-none cursor-pointer font-inherit select-none"
                            title="Admin settings" data-i18n-attr:title="workspace.rail_admin_settings_title">
                            <svg xmlns="http://www.w3.org/2000/svg" class="oaao-rail-svg rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>
                        </button>
                    </div>
                </div>
                <div id="workspace-sidebar-column" class="flex flex-col flex-none md:flex-1 min-w-0 min-h-0 h-full max-h-full overflow-hidden w-[min(288px,calc(100vw-var(--oaao-rail-width,52px)-env(safe-area-inset-left,0px)))] md:w-[min(272px,42vw)]">
                    <!-- Shell head — tenant label ({@see core.main.php oaao_tenant_display}; metadata-backed branding later). -->
                    <header id="workspace-shell-head" class="workspace-shell-chrome-row flex items-center gap-sm shrink-0">
                        <span id="workspace-shell-tenant-label" class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] tracking-tight truncate min-w-0" data-i18n="workspace.shell_tenant_label">{$oaao_tenant_display}</span>
                    </header>
                    <!-- Workspace scope — folder picker (shell chrome; not chat-only). -->
                    <section id="workspace-scope-section" class="px-md pt-sm pb-2 shrink-0 flex flex-col gap-0.5 min-w-0 border-b-[1px] border-solid border-[var(--grid-line)]">
                        <div id="workspace-folder-picker-root" class="flex flex-col gap-0.5 min-w-0">
                            <p class="workspace-chat-sidebar-label mb-0 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold"
                                data-i18n="workspace.team_workspaces_heading">Workspaces</p>
                            <div class="relative min-w-0">
                                <button type="button" id="workspace-folder-trigger"
                                    class="w-full inline-flex items-center justify-between gap-1.5 rounded-[8px] min-h-9 px-2.5 py-1.5 text-[0.8125rem] fw-medium fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 transition-colors text-left">
                                    <span id="workspace-folder-trigger-label" class="truncate min-w-0">Personal</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[0.875rem] h-[0.875rem] shrink-0 block pointer-events-none opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                                </button>
                                <div id="workspace-folder-anchor" class="hidden absolute left-0 right-0 top-[calc(100%+2px)] z-[95] rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_8px_24px_rgba(0,0,0,0.10)] max-h-[min(52vh,320px)] overflow-hidden flex flex-col min-w-0">
                                    <div id="workspace-folder-panel" role="listbox" aria-labelledby="workspace-folder-trigger"
                                        class="flex flex-col gap-0 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain py-0.5 px-1">
                                    </div>
                                    <div id="workspace-folder-create-row" class="shrink-0 border-t-[1px] border-solid border-[var(--grid-line)] p-1.5 flex flex-col gap-1.5 bg-[var(--grid-panel)]">
                                        <label class="sr-only" for="workspace-folder-create-input" data-i18n="workspace.new_workspace_name_label">New workspace name</label>
                                        <input id="workspace-folder-create-input" type="text" maxlength="120" autocomplete="off"
                                            placeholder="New workspace…"
                                            data-i18n-attr:placeholder="workspace.new_workspace_placeholder"
                                            class="w-full rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-2 py-1 text-[0.8125rem] fg-[var(--grid-ink)] bg-[var(--grid-paper)] font-inherit box-border min-w-0" />
                                        <button type="button" id="workspace-folder-create-btn"
                                            class="w-full rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25">
                                            <span data-i18n="workspace.new_workspace_btn">Create workspace</span>
                                        </button>
                                        <p id="workspace-folder-picker-note" class="hidden text-[0.6875rem] fg-[var(--grid-caption)] leading-snug m-0 px-0.5"></p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <!-- Module-specific sidebar chrome (conversation list vs vault nav, etc.). -->
                    <div id="workspace-module-sidebar" class="flex flex-col flex-1 min-h-0 overflow-hidden">
                        <div id="workspace-chat-sidebar-section" class="workspace-chat-sidebar flex flex-col flex-1 min-h-0 overflow-hidden hidden">
                            <div class="px-md pt-md pb-sm shrink-0">
                                <button type="button" id="workspace-sidebar-new-chat"
                                    class="w-full inline-flex items-center justify-center gap-2 rounded-[10px] h-10 px-3 text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 transition-colors">
                                    <!-- Lucide {@code SquarePen} — rounded note + diagonal pen (parity with rail SVG stroke icons). -->
                                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[1rem] h-[1rem] shrink-0 block pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
                                    <span data-i18n="workspace.new_chat">New chat</span>
                                </button>
                            </div>
                            <p class="workspace-chat-sidebar-label shrink-0 px-md pb-1 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold"
                                data-i18n="workspace.chats_heading">Chats</p>
                            <!-- Hidden until a Library/archived entrypoint exists; list API still supports archived rows via JS flags if needed. -->
                            <div id="workspace-chat-list-toolbar"
                                class="hidden px-md pb-2 shrink-0 flex flex-wrap items-center gap-2"
                                aria-hidden="true">
                                <label class="inline-flex items-center gap-1.5 text-[0.6875rem] fg-[var(--grid-caption)] cursor-pointer select-none font-inherit">
                                    <input type="checkbox" id="workspace-chat-show-archived" class="cursor-pointer accent-[var(--grid-ink)]" />
                                    <span>Show archived</span>
                                </label>
                            </div>
                            <div id="workspace-conversation-list" role="list"
                                class="flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] px-sm pb-md flex flex-col gap-0.5 items-stretch justify-start [&>*]:flex-none [&>*]:min-h-0 [&>*]:max-h-none [&>*]:shrink-0 [&>*]:self-stretch">
                            </div>
                        </div>
                        <section id="workspace-vault-sidebar-section" class="flex flex-col flex-1 min-h-0 overflow-hidden hidden" aria-label="Vault">
                            <p class="workspace-chat-sidebar-label shrink-0 px-md pt-md pb-1 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold"
                                data-i18n="workspace.vault_menu_heading">Vault</p>
                            <div id="workspace-vault-create-row" class="shrink-0 px-md pb-2 flex flex-col gap-1.5 border-b-[1px] border-solid border-[var(--grid-line)]">
                                <label class="sr-only" for="workspace-vault-create-input" data-i18n="workspace.new_vault_name_label">New vault name</label>
                                <input id="workspace-vault-create-input" type="text" maxlength="120" autocomplete="off"
                                    placeholder="New vault…"
                                    data-i18n-attr:placeholder="workspace.new_vault_placeholder"
                                    class="w-full rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-2 py-1 text-[0.8125rem] fg-[var(--grid-ink)] bg-[var(--grid-paper)] font-inherit box-border min-w-0" />
                                <button type="button" id="workspace-vault-create-btn"
                                    class="w-full rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25">
                                    <span data-i18n="workspace.new_vault_btn">Create vault</span>
                                </button>
                                <p id="workspace-vault-create-note" class="hidden text-[0.6875rem] fg-[var(--grid-caption)] leading-snug m-0 px-0.5"></p>
                            </div>
                            <div id="workspace-vault-list-wrap"
                                class="hidden shrink-0 px-md pt-md pb-md flex flex-col gap-1 min-h-0 max-h-[36vh] overflow-y-auto overflow-x-hidden border-b-[1px] border-solid border-[var(--grid-line)]">
                                <p class="workspace-chat-sidebar-label shrink-0 m-0 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold"
                                    data-i18n="workspace.vault_sidebar_vaults_heading">Your vaults</p>
                                <div id="workspace-vault-list" class="flex flex-col gap-0.5 min-w-0" role="list"></div>
                            </div>
                        </section>
                    </div>
                    <!-- SPA apps not pinned on the icon rail ({@see workspace.js renderNav}); hidden when empty. -->
                    <nav id="workspace-nav"
                        class="hidden shrink-0 overflow-y-auto px-sm py-sm flex flex-col gap-0.5 border-t-[1px] border-solid border-[var(--grid-line)] max-h-[40vh]"
                        aria-label="Apps">
                    </nav>
                    <!-- Shell tail — reserved (billing upsell, etc.); hidden until product wires it. -->
                    <footer id="workspace-shell-tail" class="hidden shrink-0 px-md py-md border-t-[1px] border-solid border-[var(--grid-line)] flex flex-col gap-sm bg-[var(--grid-panel-bright)]">
                        <button type="button" disabled
                            class="rounded-[10px] h-9 px-3 text-[0.75rem] fw-medium fg-[var(--grid-caption)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] opacity-60 cursor-not-allowed font-inherit">
                            <span data-i18n="workspace.upgrade_pro">Upgrade to Pro</span>
                        </button>
                    </footer>
                </div>
            </aside>
            <div id="workspace-shell-drawer-backdrop" class="workspace-shell-drawer-backdrop md:hidden fixed inset-0 z-40 bg-[rgba(0,0,0,0.38)] opacity-0 invisible pointer-events-none transition-opacity duration-[220ms] ease-out backdrop-blur-[2px] [-webkit-backdrop-filter:blur(2px)] touch-none" aria-hidden="true"></div>
            <!-- Main -->
            <div id="workspace-main" class="flex flex-1 min-h-0 min-w-0 h-full max-h-full flex-col overflow-hidden bg-[var(--grid-paper)] w-full max-w-[100vw] md:max-w-none">
                <header
                    class="workspace-main-header workspace-shell-chrome-row relative z-[80] flex flex-nowrap items-center w-full gap-sm shrink-0 bg-[var(--grid-panel-bright)]">
                    <button type="button" id="workspace-drawer-open-btn"
                        class="workspace-drawer-open-btn flex md:hidden shrink-0 items-center justify-center rounded-[10px] border-none bg-transparent cursor-pointer font-inherit fg-[var(--grid-ink)] hover:bg-[var(--grid-line)]/35 select-none w-11 h-11 [margin-inline-start:calc(-1*env(safe-area-inset-left,0px))]"
                        aria-expanded="false"
                        aria-controls="workspace-shell-aside"
                        data-i18n-attr:aria-label="workspace.drawer_open_label"
                        aria-label="Open navigation menu">
                        <!-- Lucide PanelLeft — menu / sidebar -->
                        <svg xmlns="http://www.w3.org/2000/svg" class="oaao-drawer-toggle-svg rz-icon w-[1.375rem] h-[1.375rem] block pointer-events-none" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
                    </button>
                    <div id="workspace-header-lead" class="flex flex-1 min-w-0 items-center justify-start gap-sm">
                        <!-- Gallery layout ({@see workspace.js syncWorkspaceShellLayout}): tenant beside header controls; hidden in Split (Chat/Vault). -->
                        <span id="workspace-header-tenant-label"
                            class="hidden shrink-0 max-w-[min(12rem,28vw)] text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] tracking-tight truncate"
                            data-i18n="workspace.shell_tenant_label">{$oaao_tenant_display}</span>
                        <!-- Hidden sources for MeTranslator + UTF-8 fallbacks ({@see workspace.js workspaceChatProfileLabelFromDomOrFallback}). -->
                        <span id="oaao-i18n-workspace-chat-profile-loading" class="hidden" data-i18n="workspace.chat_profile_loading">Loading endpoints…</span>
                        <span id="oaao-i18n-workspace-chat-profile-fallback" class="hidden" data-i18n="workspace.chat_profile_fallback">Default chat</span>
                        <!-- Stable Personal label source ({@see workspace.js formatWorkspaceScopeLabel}); sidebar picker label updated at runtime. -->
                        <span id="oaao-i18n-workspace-scope-personal" class="hidden" data-i18n="workspace.scope_personal">Personal</span>
                        <div id="workspace-purpose-selector-root" class="oaao-purpose-selector-root">
                            <button type="button" id="workspace-purpose-selector-trigger"
                                class="inline-flex w-full min-w-0 md:w-auto md:max-w-full items-center justify-between gap-1 text-left text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-2.5 py-1 bg-[var(--grid-paper)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 transition-colors select-none max-w-full"
                                aria-haspopup="listbox"
                                aria-expanded="false"
                                aria-controls="workspace-purpose-selector-panel"
                                data-i18n-attr:aria-label="workspace.chat_profile_aria"
                                aria-label="Choose chat completion profile"
                                data-routing-chat-endpoint-id="0">
                                <span id="workspace-purpose-selector-label" class="truncate min-w-0">…</span>
                                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[0.875rem] h-[0.875rem] shrink-0 block pointer-events-none opacity-70" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                            </button>
                            <div id="workspace-purpose-selector-anchor" class="oaao-purpose-selector-anchor hidden">
                                <div id="workspace-purpose-selector-panel" role="listbox" aria-labelledby="workspace-purpose-selector-trigger"
                                    class="oaao-purpose-selector-panel">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-md shrink-0">
                        <span class="hidden sm:inline-flex items-center gap-1.5 text-[0.8125rem] fg-[var(--grid-ink-muted)]">
                            <svg class="w-2 h-2 shrink-0" viewBox="0 0 8 8" aria-hidden="true">
                                <circle cx="4" cy="4" r="4" fill="#34d399" />
                            </svg>
                            <span data-i18n="workspace.service_ok">All systems operational</span>
                        </span>
                        <div class="oaao-notifications-menu relative inline-flex items-center">
                            <button type="button" id="workspace-notifications-trigger"
                                class="relative inline-flex items-center justify-center w-9 h-9 rounded-full border-none bg-transparent cursor-pointer font-inherit fg-[var(--grid-caption)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)]"
                                aria-expanded="false"
                                aria-haspopup="true"
                                aria-controls="workspace-notifications-panel"
                                aria-label="Notifications"
                                title="Notifications">
                                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon w-[1.125rem] h-[1.125rem] shrink-0 block pointer-events-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                                <span id="workspace-notifications-badge"
                                    class="hidden absolute -top-0.5 -right-0.5 min-w-[1rem] h-4 px-1 rounded-full bg-[var(--grid-accent)] fg-white text-[0.625rem] fw-semibold leading-4 text-center pointer-events-none"></span>
                            </button>
                            <div id="workspace-notifications-anchor" class="oaao-notifications-anchor hidden" hidden>
                                <div id="workspace-notifications-panel" role="menu" class="oaao-notifications-panel"></div>
                            </div>
                        </div>
                        <!-- Account menu: hand-rolled panel + JIT today; prefer {@code rui-dropdown} / {@see Dropdown.js} + {@code registerElement} when init wiring lands — practice RazyUI, avoid parallel menu semantics. Keep {@code #workspace-user-label} for preferences greeting ({@see preferences-dialog.js}). -->
                        <div class="oaao-user-menu relative inline-flex items-center">
                            <button type="button" id="workspace-user-menu-trigger"
                                class="inline-flex items-center justify-center p-0 rounded-full border-none bg-transparent cursor-pointer font-inherit select-none hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--grid-accent)]"
                                aria-expanded="false"
                                aria-haspopup="true"
                                aria-controls="workspace-user-menu-panel"
                                data-i18n-attr:aria-label="workspace.user_menu_label"
                                aria-label="Account menu">
                                <span id="workspace-user-avatar"
                                    class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#3b5bdb] fg-[#fff] text-[0.8125rem] fw-semibold shrink-0 pointer-events-none"
                                    aria-hidden="true">?</span>
                            </button>
                            <div id="workspace-user-menu-panel" role="menu" aria-labelledby="workspace-user-menu-trigger"
                                class="oaao-user-menu-panel absolute right-0 top-[calc(100%+6px)] min-w-[12rem] z-[90] rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_8px_24px_rgba(0,0,0,0.1)] py-1 overflow-hidden before:content-[''] before:absolute before:bottom-full before:left-0 before:right-0 before:h-2 before:pointer-events-auto">
                                <p id="workspace-user-label"
                                    class="px-3 py-2 text-[0.8125rem] fw-medium fg-[var(--grid-ink)] truncate border-b-[1px] border-solid border-[var(--grid-line)] mb-0 mt-0"
                                    role="presentation"></p>
                                <button type="button" role="menuitem" id="workspace-menu-preferences"
                                    class="w-full text-left px-3 py-2 text-[0.8125rem] fg-[var(--grid-ink)] bg-transparent border-none cursor-pointer font-inherit hover:bg-[var(--grid-line)]/35">
                                    <span data-i18n="workspace.menu_preferences">Preferences</span>
                                </button>
                                <button type="button" role="menuitem" id="workspace-logout"
                                    class="w-full text-left px-3 py-2 text-[0.8125rem] fg-[var(--grid-accent)] bg-transparent border-none cursor-pointer font-inherit hover:bg-[var(--grid-line)]/35">
                                    <span data-i18n="workspace.sign_out">Sign out</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </header>
                <div id="workspace-content" class="flex-1 min-h-0 flex flex-col overflow-hidden bg-[var(--grid-paper)]">
                    <div id="workspace-module-mount"
                        class="hidden flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
                    </div>
                    <section id="page-unknown" class="flex-1 min-h-0 overflow-y-auto p-lg">
                        <p class="text-sm fg-[var(--grid-ink-muted)]">Choose a page from the sidebar.</p>
                    </section>
                </div>
            </div>
        </div>
    </div>
