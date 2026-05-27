    <!-- Platform admin console — sidemenu shell (no chat / vault / AI). -->
    <div id="platform-view"
        class="platform-view-shell flex flex-col flex-1 w-full box-border min-h-[100dvh] h-[100dvh] max-h-[100dvh] overflow-hidden bg-[var(--grid-paper)]"
        hidden>
        <header
            class="flex items-center justify-between gap-md shrink-0 px-lg py-md border-b-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]">
            <div class="flex items-center gap-sm min-w-0">
                <img src="{$asset_path}images/logo.svg?v={$oaao_shell_esm_v}" alt="" class="h-[22px] w-[22px] shrink-0" />
                <div class="min-w-0">
                    <div class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] truncate">oaao Platform</div>
                    <div class="text-[0.6875rem] fg-[var(--grid-caption)] truncate">Tenant control plane</div>
                </div>
            </div>
            <div class="flex items-center gap-md shrink-0">
                <span class="oaao-build-info-line text-[0.6875rem] font-mono fg-[var(--grid-caption)] shrink-0 max-w-[14rem] truncate"
                    role="status" aria-live="polite"></span>
                <span id="platform-user-label" class="text-[0.8125rem] fg-[var(--grid-ink-muted)] truncate max-w-[16rem]"></span>
                <button type="button" id="platform-logout"
                    class="rounded-[8px] h-9 px-3 text-[0.8125rem] fw-medium fg-[var(--grid-ink)] bg-transparent border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[rgba(55,53,47,0.04)]">
                    Sign out
                </button>
            </div>
        </header>
        <div id="platform-shell-root"
            class="flex flex-row items-stretch flex-1 min-h-0 min-w-0 w-full overflow-hidden bg-[var(--grid-panel-bright)]">
        </div>
    </div>
