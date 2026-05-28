<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Complete registration — OAAO</title>
    <link rel="stylesheet" href="%%OAao_ASSET_PREFIX%%/webassets/core/default/css/oaao.css" />
    <link rel="stylesheet" href="%%OAao_ASSET_PREFIX%%/webassets/core/default/razyui/razyui.css" />
</head>
<body data-oaao-invite-token="" data-oaao-mount-prefix="%%OAao_MOUNT_PREFIX%%" class="min-h-screen flex flex-col box-border m-0 p-8 bg-[var(--grid-paper)] fg-[var(--grid-ink)] [font-family:var(--inp-font-stack,system-ui,sans-serif)]">
    <div class="flex flex-col flex-1 items-center justify-center w-full max-w-[28rem] mx-auto gap-4">
        <img src="%%OAao_ASSET_PREFIX%%/webassets/core/default/images/logo.svg" alt="oaao" class="h-12 w-auto" />
        <div class="w-full p-6 box-border bg-[var(--grid-panel-bright)] border border-solid border-[var(--grid-line)] rounded-lg shadow-sm">
            <h1 class="text-lg fw-bold m-0 mb-md">Complete registration</h1>
            <p class="text-sm fg-[var(--grid-ink-muted)] m-0 mb-md min-h-[1.25rem]" id="oaao-reg-status" role="status">Checking invitation…</p>
            <form id="oaao-reg-form" class="flex flex-col gap-3 hidden" hidden>
                <p class="text-sm fg-[var(--grid-ink-muted)] m-0" id="oaao-reg-email"></p>
                <label class="flex flex-col gap-1 text-xs fg-[var(--grid-ink)]">
                    <span>Display name</span>
                    <input name="display_name" required autocomplete="name"
                        class="w-full box-border px-3 py-2 text-sm rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]" />
                </label>
                <label class="flex flex-col gap-1 text-xs fg-[var(--grid-ink)]">
                    <span>Password</span>
                    <input name="password" type="password" required minlength="6" autocomplete="new-password"
                        class="w-full box-border px-3 py-2 text-sm rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]" />
                </label>
                <button type="submit"
                    class="rounded-[10px] h-11 px-4 fw-semibold w-full fg-[#fff] bg-[#2d2d2d] border-none cursor-pointer [font-family:inherit] hover:opacity-[0.92]">
                    Create account
                </button>
            </form>
        </div>
    </div>
    <script type="module" src="%%OAao_ASSET_PREFIX%%/webassets/user/default/js/register-page.js"></script>
</body>
</html>
