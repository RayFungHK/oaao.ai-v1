<section class="oaao-live-meeting-root flex flex-1 min-h-0 min-w-0 flex-col w-full bg-[var(--grid-paper)]" data-module="oaao-live-meeting">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--grid-line)] px-4 py-3">
        <div>
            <h1 class="text-base font-semibold fg-[var(--grid-ink)] m-0" data-i18n="live_meeting.title">Live meeting</h1>
            <p class="text-sm fg-[var(--grid-ink-muted)] m-0 mt-1" data-i18n="live_meeting.subtitle">Streaming transcript from your microphone</p>
        </div>
        <div class="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            <span data-oaao-live-meeting="status" class="text-xs fg-[var(--grid-ink-muted)]" data-i18n="live_meeting.status.idle">Idle</span>
            <div class="flex items-center gap-2">
                <label data-oaao-live-meeting="keep-audio-wrap" class="hidden items-center gap-2 text-xs fg-[var(--grid-ink-muted)] cursor-pointer select-none">
                    <input type="checkbox" data-oaao-live-meeting="keep-audio" class="m-0" />
                    <span data-i18n="live_meeting.keep_audio">Keep recorded audio on server</span>
                </label>
                <button type="button" data-oaao-live-meeting="mic"
                    class="inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium bg-[#2d2d2d] text-white border-none cursor-pointer">
                    <span data-i18n="live_meeting.start_mic">Start microphone</span>
                </button>
            </div>
        </div>
    </header>
    <div class="flex flex-1 min-h-0 flex-col gap-2 p-4 overflow-hidden">
        <div data-oaao-live-meeting="connections" class="text-xs font-mono fg-[var(--grid-ink-muted)] min-h-[1.25rem]" aria-live="polite"></div>
        <div data-oaao-live-meeting="transcript"
            class="oaao-live-transcript flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-4 text-sm leading-relaxed whitespace-pre-wrap fg-[var(--grid-ink)]"
            aria-live="polite">
            <p class="oaao-live-transcript-empty m-0 text-sm fg-[var(--grid-ink-muted)]" data-i18n="live_meeting.transcript.empty">Transcript will appear here while you speak.</p>
        </div>
    </div>
</section>
