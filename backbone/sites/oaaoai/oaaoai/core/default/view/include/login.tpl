    <div id="login-view" class="flex flex-col flex-1 min-h-0 overflow-y-auto box-border">
        <!-- Top chrome -->
        <div class="flex p-lg mb-xl">
            <a href="{$site_url}" class="flex h-[24px] gap-sm" target="_blank" rel="noopener noreferrer" title="oaao.ai">
                <img src="{$asset_path}images/logo.svg?v={$oaao_shell_esm_v}" class="h-full" />
                <span>oaao</span>
            </a>
        </div>

        <!-- Login panel: full width on small screens, capped at 560px, centered -->
        <!-- Cloak only <rui-input> hosts until JIT/boot — keep title + submit button visible so sign-in is never blocked. -->
        <div class="flex flex-col items-center justify-center w-full max-w-[480px] mx-auto px-lg pb-xl box-border">
            <div class="mb-xl">
                <img src="{$asset_path}images/logo.svg?v={$oaao_shell_esm_v}" class="h-[48px] place-item-center" />
            </div>
            <h1 class="text-lg fw-bold mb-md" data-i18n="auth.welcome">Sign in</h1>
            <p class="text-sm mb-md fg-[var(--grid-ink-muted)]" data-i18n="auth.subtitle">Use your administrator username or email</p>

            <form id="login-form" class="flex flex-col gap-2 w-full" autocomplete="on" novalidate>
                <span>Username / Email</span>
                <div class="w-full" razyui-cloak>
                    <rui-input id="login-email-host" preset="login" type="text" name="login_name" autocomplete="username" placeholder="Username or email" autocapitalize="off" autocorrect="off"></rui-input>
                </div>
                <span class="mt-lg">Password</span>
                <div class="w-full" razyui-cloak>
                    <rui-input id="login-password-host" preset="login" type="password" name="password" autocomplete="current-password" placeholder="Password"></rui-input>
                </div>
                <label class="flex items-center gap-2 mt-1 text-[0.8125rem] fg-[var(--grid-ink-muted)] cursor-pointer select-none">
                    <input id="login-remember" type="checkbox" name="remember" class="m-0" />
                    <span>Stay signed in for 30 days</span>
                </label>

                <!-- Error slot -->
                <p id="login-error" class="text-sm fg-red-6 hidden mt-1" role="alert"></p>
            </form>

            <!-- Associated submit lives outside <form> so it cannot be affected by rui-input / display:contents quirks in some engines. -->
            <div class="oaao-login-cta mt-2 w-full">
                <button id="login-submit" type="submit" form="login-form"
                    class="rounded-[10px] h-12 px-4 fw-semibold w-full fg-[#fff] bg-[#2d2d2d] border-none cursor-pointer [font-family:inherit] hover:opacity-[0.92] disabled:opacity-50 disabled:pointer-events-none">
                    Sign in
                </button>
            </div>
        </div>

        <!-- Footer -->
        <div class="oaao-login-footer">
            <span class="block mb-4 fg-[var(--grid-ink-muted)]" data-i18n="auth.footer">from oaao.ai</span>
            <span>
                <a href="#" class="fg-[var(--grid-caption)] no-underline hover:underline" data-i18n="auth.terms">Terms of Use</a>
                <span class="mx-[0.35rem] opacity-60">&middot;</span>
                <a href="#" class="fg-[var(--grid-caption)] no-underline hover:underline" data-i18n="auth.privacy">Privacy Policy</a>
            </span>
        </div>
    </div>
