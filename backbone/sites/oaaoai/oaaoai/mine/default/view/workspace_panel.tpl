<section class="oaao-mine-root flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--grid-paper)]" data-module="oaao-mine">
    <div class="flex flex-1 min-h-0 flex-col overflow-y-auto [overscroll-behavior-y:contain] [-webkit-overflow-scrolling:touch]">
        <div class="oaao-gallery-page-column w-full max-w-[48rem] mx-auto box-border px-8 pt-8 pb-10 flex flex-col flex-1 min-h-0 gap-4">
            <header class="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div class="flex items-center gap-2 min-w-0">
                    <button type="button" data-oaao-mine="back" class="hidden text-sm px-2 py-1 rounded border border-solid border-[var(--grid-line)] cursor-pointer shrink-0">← Back</button>
                    <div class="min-w-0">
                        <h1 class="m-0 text-[1.375rem] fw-semibold fg-[var(--grid-ink)] tracking-tight">Data Mining</h1>
                        <p class="text-xs fg-[var(--grid-ink-muted)] m-0 mt-2">Index/list or static sources → LLM + columns → SQLite upsert → DataTable</p>
                    </div>
                </div>
                <button type="button" data-oaao-mine="new" class="text-sm px-3 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] cursor-pointer shrink-0">New mine</button>
            </header>
            <div data-oaao-mine="list" class="grid gap-2 min-h-0 overflow-y-auto"></div>
            <div data-oaao-mine="detail" class="hidden flex flex-col flex-1 min-h-0 gap-2 w-full"></div>
            <p data-oaao-mine="msg" class="text-xs fg-[var(--grid-ink-muted)] m-0 min-h-[1rem] shrink-0"></p>
        </div>
    </div>
</section>
