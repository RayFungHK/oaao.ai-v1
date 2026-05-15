<section class="oaao-chat-root relative flex flex-1 min-h-0 min-w-0 flex-col w-full overflow-hidden bg-[var(--grid-paper)]" data-module="oaao-chat">
    <!-- Thread actions — positioned vs {@code .oaao-chat-root} full width (not the centered {@code max-w-[810px]} column). -->
    <div data-oaao-chat="thread-toolbar"
        class="hidden absolute top-0 left-0 right-0 z-30 w-full pointer-events-none box-border">
        <div class="oaao-chat-thread-toolbar-scrim pointer-events-auto">
            <button type="button" data-oaao-chat="share-thread"
                class="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-[var(--grid-panel-bright)] fg-[var(--grid-ink-muted)] cursor-pointer hover:bg-[var(--grid-panel)] hover:fg-[var(--grid-ink)] transition-colors font-inherit"
                aria-label="Share chat" title="Share chat">
                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>
            </button>
            <button type="button" data-oaao-chat="archive-thread"
                class="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-[var(--grid-panel-bright)] fg-[var(--grid-ink-muted)] cursor-pointer hover:bg-[var(--grid-panel)] hover:fg-[var(--grid-ink)] transition-colors font-inherit"
                aria-label="Archive chat" title="Archive chat">
                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
            </button>
            <button type="button" data-oaao-chat="delete-thread"
                class="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border-none bg-[var(--grid-panel-bright)] fg-[var(--grid-caption)] cursor-pointer hover:bg-[var(--grid-line)]/35 hover:text-red-600 transition-colors font-inherit"
                aria-label="Delete chat" title="Delete chat">
                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
        </div>
    </div>

    <!-- Thread column — activity rail + messages; reconnect SSE resumes from stored seq -->
    <!-- overflow-hidden: clamp column height so only ``messages`` scrolls (avoid flex intrinsic height → parent clip). -->
    <div data-oaao-chat="thread-wrap"
        class="hidden mx-auto w-full max-w-full flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden box-border px-[21px] sm:max-w-[810px] sm:min-w-[360px] pt-0 pb-0">
        <div data-oaao-chat="activity"
            class="hidden shrink-0 mb-2 rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-sm py-sm text-[0.72rem] fg-[var(--grid-caption)] font-mono whitespace-pre-wrap max-h-[28vh] overflow-y-auto leading-snug"
            aria-live="polite"></div>
        <div data-oaao-chat="thread-messages-wrap"
            class="relative flex flex-col flex-1 min-h-0 min-w-0">
            <div data-oaao-chat="messages" role="log" aria-live="polite"
                class="flex flex-col flex-1 gap-[12px] min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] pb-0 [scroll-padding-bottom:1.5rem] [scroll-behavior:smooth]">
            </div>
        </div>
    </div>

    <!-- Landing hero + suggestion chips hide in-thread; composer stays visible ({@see chat-panel.js updateChatLayout}). -->
    <div data-oaao-chat="composer-region"
        class="flex flex-col flex-1 min-h-0 w-full overflow-y-auto [overscroll-behavior-y:contain] [-webkit-overflow-scrolling:touch]">
        <div data-oaao-chat="when-empty"
            class="flex flex-col items-center justify-center flex-1 min-h-0 w-full px-8 pt-16 pb-6 text-center box-border">
            <div class="text-[clamp(1.25rem,2.5vw,1.5rem)] fw-semibold fg-[var(--grid-ink)] mb-4"
                data-i18n="workspace.hero_title">
                How can I help?
            </div>
            <p class="text-sm fg-[var(--grid-ink-muted)] mb-0">
                <span data-i18n="workspace.hero_sub">Ask anything or try the suggestions below.</span>
            </p>
        </div>

        <div class="flex justify-center px-8 pb-2 w-full min-w-0 self-stretch box-border shrink-0">
            <div class="w-full max-w-[810px] min-w-0 flex flex-col items-stretch box-border">
                <form data-oaao-chat="composer"
                    class="flex flex-col gap-2 w-full py-2 bg-[var(--grid-panel-bright)] rounded-[22px] [border:1px_solid_rgba(0,0,0,0.12)] shadow-[0_12px_32px_rgba(0,0,0,0.02)] [box-sizing:border-box]">
                    <div class="flex w-full min-w-0 items-stretch gap-2 px-4">
                        <div class="flex flex-col flex-1 min-w-0 gap-2 w-full min-h-0 items-stretch">
                            <textarea data-oaao-chat="input" rows="3" maxlength="32000"
                                placeholder="Assign a task or ask any question"
                                aria-label="Message"
                                class="w-full min-h-[50px] max-h-[216px] rounded-[22px] border-none px-1 py-2 text-[15px] leading-[24px] fg-[var(--grid-ink)] bg-transparent [font-family:inherit] [outline:none] [box-sizing:border-box] [resize:none] [&::placeholder]:text-[var(--grid-caption)]"></textarea>
                        </div>
                    </div>
                    <div class="flex items-center justify-between gap-2 px-3 pb-1 flex-wrap">
                        <div class="flex flex-wrap items-center gap-2 min-w-0">
                            <button type="button" disabled
                                class="inline-flex items-center gap-2 px-4 py-2 [border:1px_solid_var(--grid-line)] rounded-full bg-[var(--grid-panel-bright)] text-xs fg-[var(--grid-ink-muted)] cursor-not-allowed opacity-65 font-inherit"
                                title="Sidecar — coming soon"
                                data-oaao-chat="stub-source">
                                <span data-i18n="workspace.select_source">Select source</span>
                                <span class="inline-flex opacity-70 pointer-events-none" aria-hidden="true">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                </span>
                            </button>
                            <button type="button" disabled
                                class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs fw-semibold fg-[#9333ea] bg-[color-mix(in_srgb,#9333ea_14%,transparent)] cursor-default font-inherit opacity-90 border-none"
                                data-oaao-chat="stub-web"
                                title="Gateway — coming soon">
                                <span data-i18n="workspace.web_search">Web</span>
                            </button>
                            <button type="button" disabled
                                class="inline-flex items-center gap-2 px-4 py-2 [border:1px_solid_var(--grid-line)] rounded-full bg-[var(--grid-panel-bright)] text-xs fg-[var(--grid-ink-muted)] cursor-not-allowed opacity-65 font-inherit"
                                data-oaao-chat="stub-reason"
                                title="Gateway — coming soon">
                                <span data-i18n="workspace.deep_think">Deep think</span>
                            </button>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 [margin-left:auto]">
                            <button type="button" disabled
                                class="inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] cursor-not-allowed opacity-45 font-inherit"
                                aria-label="Attach file"
                                title="Attachments — coming soon">
                                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                            <button type="button" disabled
                                class="inline-flex items-center justify-center w-8 h-8 p-0 [border:1px_solid_var(--grid-line)] rounded-full bg-transparent fg-[var(--grid-ink-muted)] cursor-not-allowed opacity-45 font-inherit"
                                aria-label="Voice input"
                                title="Voice — coming soon">
                                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </button>
                            <button type="submit" data-oaao-chat="send"
                                class="inline-flex items-center justify-center w-8 h-8 p-0 border-0 rounded-full bg-[#2d2d2d] fg-[#fff] cursor-pointer hover:opacity-[0.88] disabled:opacity-50 disabled:pointer-events-none shrink-0"
                                aria-label="Send">
                                <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-5 h-5 pointer-events-none" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>

        <div data-oaao-chat="prompt-grid"
            class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[720px] mx-auto px-8 pb-10">
            <div class="oaao-chat-suggestion-card w-full min-w-0 overflow-hidden rounded-lg [border:1px_solid_var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[var(--oaao-surface-shadow)]">
                <button type="button" data-oaao-chat="suggestion"
                    class="w-full min-w-0 text-left px-4 py-4 text-[0.8125rem] fg-[var(--grid-ink)] cursor-pointer leading-normal transition-colors hover:bg-[var(--grid-panel)] font-inherit border-0 bg-transparent box-border">
                    Draft a marketing email
                </button>
            </div>
            <div class="oaao-chat-suggestion-card w-full min-w-0 overflow-hidden rounded-lg [border:1px_solid_var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[var(--oaao-surface-shadow)]">
                <button type="button" data-oaao-chat="suggestion"
                    class="w-full min-w-0 text-left px-4 py-4 text-[0.8125rem] fg-[var(--grid-ink)] cursor-pointer leading-normal transition-colors hover:bg-[var(--grid-panel)] font-inherit border-0 bg-transparent box-border">
                    Plan a weekend trip itinerary
                </button>
            </div>
            <div class="oaao-chat-suggestion-card w-full min-w-0 overflow-hidden rounded-lg [border:1px_solid_var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[var(--oaao-surface-shadow)]">
                <button type="button" data-oaao-chat="suggestion"
                    class="w-full min-w-0 text-left px-4 py-4 text-[0.8125rem] fg-[var(--grid-ink)] cursor-pointer leading-normal transition-colors hover:bg-[var(--grid-panel)] font-inherit border-0 bg-transparent box-border">
                    Explain how RAG works
                </button>
            </div>
            <div class="oaao-chat-suggestion-card w-full min-w-0 overflow-hidden rounded-lg [border:1px_solid_var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-[var(--oaao-surface-shadow)]">
                <button type="button" data-oaao-chat="suggestion"
                    class="w-full min-w-0 text-left px-4 py-4 text-[0.8125rem] fg-[var(--grid-ink)] cursor-pointer leading-normal transition-colors hover:bg-[var(--grid-panel)] font-inherit border-0 bg-transparent box-border">
                    Compare two programming approaches
                </button>
            </div>
        </div>
    </div>
</section>
