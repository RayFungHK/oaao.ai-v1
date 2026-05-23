<section class="oaao-live-meeting-root flex flex-1 min-h-0 min-w-0 flex-col w-full bg-[var(--grid-paper)]" data-module="oaao-live-meeting">

    <header class="grid shrink-0 grid-cols-1 sm:grid-cols-3 items-center gap-2 sm:gap-4 border-b border-solid border-[var(--grid-line)] px-4 py-3 overflow-visible">

        <div class="min-w-0 justify-self-start">

            <h1 class="text-base fw-semibold fg-[var(--grid-ink)] m-0" data-i18n="live_meeting.title">Live meeting</h1>

            <p class="text-sm fg-[var(--grid-ink-muted)] m-0 mt-1" data-i18n="live_meeting.subtitle">Select a workspace, then start the microphone.</p>

        </div>

        <div class="relative z-30 min-w-0 w-full max-w-xs justify-self-center" data-oaao-live-meeting="workspace-scope">

            <p class="m-0 mb-0.5 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold" data-i18n="workspace.team_workspaces_heading">Workspaces</p>

            <div class="relative min-w-0">

                <button type="button" data-oaao-live-meeting="workspace-trigger"

                    class="w-full inline-flex items-center justify-between gap-1.5 rounded-[8px] min-h-9 px-2.5 py-1.5 text-[0.8125rem] fw-medium fg-[var(--grid-ink)] bg-[var(--grid-paper)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 transition-colors text-left"

                    aria-haspopup="listbox" aria-expanded="false">

                    <span data-oaao-live-meeting="workspace-trigger-label" class="truncate min-w-0">Personal</span>

                    <svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 opacity-70 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>

                </button>

                <div data-oaao-live-meeting="workspace-anchor" class="hidden absolute left-0 right-0 top-[calc(100%+2px)] z-40 rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_8px_24px_rgba(0,0,0,0.10)] max-h-[min(52vh,320px)] overflow-hidden flex flex-col min-w-0">

                    <div data-oaao-live-meeting="workspace-panel" role="listbox" class="flex flex-col min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain py-0.5 px-1"></div>

                </div>

            </div>

        </div>

        <div class="flex flex-wrap items-center justify-end gap-2 sm:gap-3 min-w-0 justify-self-end">

            <span data-oaao-live-meeting="status" class="text-xs fg-[var(--grid-ink-muted)] text-right" data-i18n="live_meeting.status.idle">Idle</span>

            <div class="flex flex-wrap items-center justify-end gap-2">

                <label data-oaao-live-meeting="keep-audio-wrap" class="hidden items-center gap-2 text-xs fg-[var(--grid-ink-muted)] cursor-pointer select-none">

                    <input type="checkbox" data-oaao-live-meeting="keep-audio" class="m-0 cursor-pointer accent-[var(--grid-ink)]" />

                    <span data-i18n="live_meeting.keep_audio">Keep recorded audio on server</span>

                </label>

                <div class="relative z-40" data-oaao-live-meeting="mic-group">

                    <div class="oaao-live-meeting-mic-split inline-flex items-stretch">

                        <button type="button" data-oaao-live-meeting="mic"

                            class="oaao-live-meeting-mic-btn inline-flex items-center justify-center px-4 py-2 text-sm fw-medium border-none cursor-pointer">

                            <span data-i18n="live_meeting.start_mic">Start microphone</span>

                        </button>

                        <button type="button" data-oaao-live-meeting="audio-input-trigger"

                            class="oaao-live-meeting-mic-menu-btn inline-flex items-center justify-center px-2.5 py-2 border-none cursor-pointer"

                            aria-haspopup="listbox" aria-expanded="false" aria-label="Select audio input"

                            title="Select audio input">

                            <svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>

                        </button>

                    </div>

                    <div data-oaao-live-meeting="audio-input-anchor" hidden class="oaao-live-meeting-audio-input-anchor hidden absolute right-0 top-[calc(100%+4px)] z-50 min-w-[14rem] max-w-[min(90vw,20rem)] rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[0_8px_24px_rgba(0,0,0,0.10)] overflow-hidden min-w-0 flex flex-col">

                        <p class="m-0 px-2.5 pt-2 pb-1 text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold" data-i18n="live_meeting.audio_input.label">Audio input</p>

                        <div data-oaao-live-meeting="audio-input-panel" role="listbox" class="flex flex-col min-h-0 max-h-[min(40vh,240px)] overflow-x-hidden overflow-y-auto overscroll-contain py-0.5 px-1 pb-1"></div>

                    </div>

                </div>

            </div>

        </div>

    </header>

    <div class="flex flex-1 min-h-0 flex-col gap-2 p-4 overflow-hidden">

        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-[1.25rem]">

            <div data-oaao-live-meeting="connections" class="text-xs font-mono fg-[var(--grid-ink-muted)]" aria-live="polite"></div>

            <div data-oaao-live-meeting="audio-meter-wrap" class="hidden min-w-0 flex-1 items-center gap-2 max-w-xs" role="group" aria-live="polite">

                <span data-oaao-live-meeting="audio-dot" class="oaao-live-audio-dot shrink-0" aria-hidden="true"></span>

                <div class="min-w-[4rem] flex-1 h-1.5 overflow-hidden rounded-full bg-[var(--grid-line)]" role="meter" aria-valuemin="0" aria-valuemax="100" aria-label="Input level">

                    <div data-oaao-live-meeting="audio-level-fill" class="oaao-live-audio-level-fill h-full w-0 bg-emerald-500 transition-[width] duration-75 ease-out"></div>

                </div>

                <span data-oaao-live-meeting="audio-level-text" class="w-8 shrink-0 text-right text-xs tabular-nums fg-[var(--grid-ink-muted)]">0</span>

            </div>

            <p data-oaao-live-meeting="audio-active-label" class="hidden m-0 min-w-0 truncate text-xs fg-[var(--grid-ink-muted)] max-w-[14rem]" title=""></p>

        </div>

        <div data-oaao-live-meeting="stats-wrap" class="hidden flex flex-col shrink-0 gap-0.5" aria-live="polite">

            <span class="text-xs fw-medium fg-[var(--grid-ink-muted)]" data-i18n="live_meeting.stats.label">Retrieval</span>

            <div data-oaao-live-meeting="stats" class="text-xs fg-[var(--grid-ink-muted)] min-h-[1rem]"></div>

        </div>

        <div data-oaao-live-meeting="bubbles-wrap" class="hidden flex flex-col shrink-0 gap-1" aria-live="polite">

            <span class="text-xs fw-medium fg-[var(--grid-ink-muted)]" data-i18n="live_meeting.bubbles.label">Suggestions</span>

            <div data-oaao-live-meeting="bubbles" class="flex flex-wrap gap-2 min-h-[2rem]"></div>

        </div>

        <div data-oaao-live-meeting="materials-wrap" class="hidden flex flex-col shrink-0 gap-1 max-h-[28%] min-h-0 overflow-hidden" aria-live="polite">

            <span class="text-xs fw-medium fg-[var(--grid-ink-muted)]" data-i18n="live_meeting.materials.label">Sources</span>

            <div data-oaao-live-meeting="materials" class="flex flex-col gap-2 min-h-0 overflow-y-auto overscroll-contain rounded-lg border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-2 text-xs"></div>

        </div>

        <div data-oaao-live-meeting="transcript"

            class="oaao-live-transcript flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] p-4 text-sm leading-relaxed whitespace-pre-wrap fg-[var(--grid-ink)]"

            aria-live="polite">

            <p class="oaao-live-transcript-empty m-0 text-sm fg-[var(--grid-ink-muted)]" data-i18n="live_meeting.transcript.empty">Transcript will appear here while you speak.</p>

        </div>

    </div>

</section>

