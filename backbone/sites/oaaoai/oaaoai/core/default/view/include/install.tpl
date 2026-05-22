    <div id="install-view" hidden>
        <div class="flex p-lg mb-xl">
            <a href="{$site_url}" class="flex h-[24px] gap-sm" target="_blank" rel="noopener noreferrer" title="oaao.ai">
                <img src="{$asset_path}images/logo.svg" class="h-full" alt="" />
                <span>oaao</span>
            </a>
        </div>

        <div class="flex flex-col items-center justify-center w-full max-w-[480px] mx-auto px-lg pb-xl box-border">
            <div class="mb-xl">
                <img src="{$asset_path}images/logo.svg" class="h-[48px] place-item-center" alt="" />
            </div>
            <h1 class="text-lg fw-bold mb-md">Welcome — set up administrator</h1>
            <p class="text-sm mb-md fg-[var(--grid-ink-muted)] text-center max-w-[32rem]">
                Provisions <strong>PostgreSQL</strong> for all app data (users, conversations/messages, endpoints, vaults, …) and a small <strong>SQLite</strong> file under the auth module for token usage, expanded history, and training snapshots. Shown once before sign-in.
            </p>

            <form id="setup-form" class="flex flex-col gap-3 w-full oaao-input-form" autocomplete="off" novalidate>
                <div id="setup-pg-simple" class="flex flex-col gap-2 {$auth_pg_simple_wrap_class}">
                    <p class="text-sm fg-[var(--grid-ink-muted)] m-0">
                        <strong>PostgreSQL</strong> for this container is already wired: host, database user, and password come from Docker / <span class="font-mono text-[11px]">OAAO_PG_URL</span> — nothing to paste here unless you switch databases.
                    </p>
                    <p class="text-[0.8125rem] fg-[var(--grid-caption)] m-0 font-mono [overflow-wrap:anywhere]">{$auth_pg_redacted}</p>
                    <button type="button" id="setup-pg-advanced-toggle"
                        class="self-start mt-1 text-[0.8125rem] underline cursor-pointer bg-transparent border-none p-0 fg-[var(--grid-ink)] hover:opacity-80 font-inherit">
                        Advanced: edit PostgreSQL URL
                    </button>
                    <script type="application/json" id="setup-pg-env-url">{$auth_pg_prefill_json}</script>
                </div>

                <label id="setup-pg-wrap" class="flex flex-col gap-1 {$auth_pg_url_wrap_class}">
                    <span>PostgreSQL URL <span class="fg-[var(--grid-caption)] font-normal text-[0.8125rem]">(<code class="font-mono text-[11px]">postgresql://…</code>)</span></span>
                    <input id="setup-pg-url" type="text" maxlength="2048" name="pg_url" autocomplete="off" spellcheck="false"
                        value="{$auth_pg_prefill}"
                        placeholder="postgresql://user:password@host:5432/dbname"
                        class="rounded-[var(--oaao-surface-radius)] border-[1px] border-solid border-[var(--grid-line)] px-[0.875rem] py-2 min-h-[2.75rem] w-full bg-[#fff] text-[inherit] fg-[var(--grid-ink)] font-mono text-[13px] [box-sizing:border-box] [outline:none]" />
                    <span id="setup-pg-env-hint" class="text-[0.8125rem] fg-[var(--grid-caption)] {$auth_pg_env_hint_class}">Leave blank on submit to use the server <span class="font-mono text-[11px]">OAAO_PG_URL</span>.</span>
                </label>
                <label class="flex flex-col gap-1">
                    <span>Username</span>
                    <input id="setup-login-name" type="text" required minlength="3" maxlength="191" autocomplete="username" autocapitalize="off" autocorrect="off"
                        placeholder="Administrator username"
                        class="rounded-[var(--oaao-surface-radius)] border-[1px] border-solid border-[var(--grid-line)] px-[0.875rem] h-[2.75rem] w-full bg-[#fff] text-[inherit] fg-[var(--grid-ink)] [box-sizing:border-box] [outline:none]" />
                </label>
                <label class="flex flex-col gap-1">
                    <span>Display name</span>
                    <input id="setup-display-name" type="text" maxlength="191" autocomplete="off" placeholder="Displayed name"
                        class="rounded-[var(--oaao-surface-radius)] border-[1px] border-solid border-[var(--grid-line)] px-[0.875rem] h-[2.75rem] w-full bg-[#fff] text-[inherit] fg-[var(--grid-ink)] [box-sizing:border-box] [outline:none]" />
                </label>
                <label class="flex flex-col gap-1">
                    <span>Email <span class="fg-[var(--grid-caption)] font-normal text-[0.8125rem]">(optional)</span></span>
                    <input id="setup-email" type="email" maxlength="254" autocomplete="email" placeholder="you@company.com"
                        class="rounded-[var(--oaao-surface-radius)] border-[1px] border-solid border-[var(--grid-line)] px-[0.875rem] h-[2.75rem] w-full bg-[#fff] text-[inherit] fg-[var(--grid-ink)] [box-sizing:border-box] [outline:none]" />
                </label>
                <label class="flex flex-col gap-1">
                    <span>Password <span class="fg-[var(--grid-caption)] font-normal text-[0.8125rem]">(min 8)</span></span>
                    <input id="setup-password" type="password" required minlength="8" maxlength="256" autocomplete="new-password" placeholder="Password"
                        class="rounded-[var(--oaao-surface-radius)] border-[1px] border-solid border-[var(--grid-line)] px-[0.875rem] h-[2.75rem] w-full bg-[#fff] text-[inherit] fg-[var(--grid-ink)] [box-sizing:border-box] [outline:none]" />
                </label>

                <p id="setup-error" class="text-sm fg-red-6 hidden" role="alert"></p>

                <button id="setup-submit" type="submit"
                    class="mt-2 rounded-[10px] h-12 px-4 fw-semibold w-full fg-[#fff] bg-[#2d2d2d] border-none cursor-pointer [font-family:inherit] hover:opacity-[0.92] disabled:opacity-50 disabled:pointer-events-none">
                    Create administrator
                </button>
            </form>
        </div>
    </div>
