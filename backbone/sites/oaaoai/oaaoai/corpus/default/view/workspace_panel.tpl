<section class="oaao-corpus-root flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--grid-paper)]" data-module="oaao-corpus">
    <div data-oaao-corpus-uploader-host class="oaao-corpus-uploader-host-hidden" aria-hidden="true"></div>
    <div class="flex flex-1 min-h-0 flex-col overflow-y-auto [overscroll-behavior-y:contain] [-webkit-overflow-scrolling:touch]">
        <div class="oaao-gallery-page-column w-full max-w-[48rem] mx-auto box-border px-8 pt-8 pb-10 flex flex-col flex-1 min-h-0 gap-4 min-w-0">
            <header class="flex flex-wrap items-center justify-between gap-2 shrink-0">
                <div>
                    <h1 class="m-0 text-[1.375rem] fw-semibold fg-[var(--grid-ink)] tracking-tight" data-oaao-corpus="title">Corpus</h1>
                    <p class="text-xs fg-[var(--grid-ink-muted)] m-0 mt-2" data-oaao-corpus="subtitle"></p>
                </div>
                <button type="button" data-oaao-corpus="new"
                    class="text-sm px-3 py-1.5 rounded border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shrink-0">New corpus</button>
            </header>
            <p data-oaao-corpus="page-alert" class="hidden text-sm m-0 shrink-0 rounded-lg border border-solid border-red-300 bg-red-50 px-3 py-2 text-red-700" role="alert"></p>
            <div class="oaao-gallery-card-grid-container min-w-0 flex-1 min-h-0">
                <div data-oaao-corpus="list" class="oaao-corpus-profile-grid min-h-0 min-w-0"></div>
            </div>
        </div>
    </div>
</section>
