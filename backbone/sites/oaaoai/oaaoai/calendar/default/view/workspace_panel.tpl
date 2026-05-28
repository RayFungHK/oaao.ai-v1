<section class="oaao-calendar-root flex flex-1 min-h-0 min-w-0 flex-col w-full bg-[var(--grid-paper)]" data-module="oaao-calendar">

    <header class="flex flex-wrap items-center gap-2 shrink-0 border-b border-solid border-[var(--grid-line)] px-4 py-3 bg-[var(--grid-panel-bright)]">
        <h1 class="text-base fw-semibold fg-[var(--grid-ink)] m-0 flex-1 min-w-[8rem]" data-i18n="calendar.title">Calendar</h1>
        <div class="inline-flex rounded-[8px] border border-solid border-[var(--grid-line)] overflow-hidden shrink-0" role="tablist">
            <button type="button" data-oaao-calendar-view="list"
                class="oaao-calendar-view-btn px-3 py-1.5 text-[0.8125rem] border-none bg-[var(--grid-paper)] cursor-pointer font-inherit fw-medium fg-[var(--grid-ink)]">
                List
            </button>
            <button type="button" data-oaao-calendar-view="month"
                class="oaao-calendar-view-btn px-3 py-1.5 text-[0.8125rem] border-none bg-[var(--grid-line)]/35 cursor-pointer font-inherit fw-semibold fg-[var(--grid-ink)]">
                Month
            </button>
        </div>
        <button type="button" data-oaao-calendar="new-event"
            class="rounded-[8px] h-9 px-3 text-[0.8125rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 shrink-0">
            New event
        </button>
    </header>

    <div class="flex flex-1 min-h-0 flex-col p-4 gap-3 overflow-hidden">
        <div data-oaao-calendar="list-view" class="hidden flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-2"></div>
        <div data-oaao-calendar="month-view" class="flex-1 min-h-0 overflow-hidden"></div>
    </div>

</section>
