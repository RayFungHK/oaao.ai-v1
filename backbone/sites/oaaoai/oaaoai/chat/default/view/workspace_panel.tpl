<section class="oaao-chat-root relative flex flex-1 min-h-0 min-w-0 flex-row w-full overflow-hidden bg-[var(--grid-paper)]" data-module="oaao-chat" data-oaao-chat-fixture-pipeline="0">
    <div data-oaao-chat="main-column" class="oaao-chat-main-column relative flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
    <!-- Thread: full-width scroll layer ({@code thread-wrap}); centered column via {@code thread-content-grid} ({@see oaao-chat-shell.css}). -->
    <div data-oaao-chat="thread-wrap"
        class="hidden w-full flex-1 min-h-0 min-w-0 box-border pt-0 pb-0 overflow-y-auto [overscroll-behavior-y:contain] [-webkit-overflow-scrolling:touch] [scroll-behavior:smooth] [scroll-padding-top:1.5rem]">
        <div data-oaao-chat="thread-content-grid"
            class="oaao-chat-thread-content-grid w-full min-w-0">
            <div data-oaao-chat="thread-toolbar"
                class="hidden oaao-chat-thread-toolbar-row"
                title="Hover here for share, archive, and delete"
                data-i18n-attr:title="workspace.thread_toolbar_hover_hint">
                <button type="button" data-oaao-chat="share-thread"
                class="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border border-transparent bg-transparent fg-[var(--grid-ink-muted)] cursor-pointer font-inherit"
                aria-label="Share chat" title="Share chat">
                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></svg>
                </button>
                <button type="button" data-oaao-chat="archive-thread"
                class="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border border-transparent bg-transparent fg-[var(--grid-ink-muted)] cursor-pointer font-inherit"
                aria-label="Archive chat" title="Archive chat">
                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
                </button>
                <button type="button" data-oaao-chat="delete-thread"
                class="inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-full border border-transparent bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit"
                aria-label="Delete chat" title="Delete chat">
                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
                <span class="oaao-chat-thread-toolbar-hint" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                    </svg>
                </span>
            </div>
            <div data-oaao-chat="activity"
                class="hidden shrink-0 mb-2 rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] px-sm py-sm text-[0.72rem] fg-[var(--grid-caption)] font-mono whitespace-pre-wrap max-h-[28vh] overflow-y-auto leading-snug"
                aria-live="polite"></div>
            <div data-oaao-chat="thread-messages-wrap"
                class="oaao-chat-thread-messages-grid grid grid-cols-1 min-w-0 min-h-0 justify-items-stretch">
                <div data-oaao-chat="messages" role="log" aria-live="polite"
                    class="oaao-chat-messages flex flex-col gap-6 min-w-0 overflow-x-hidden py-6">
                </div>
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

        <div data-oaao-chat="composer-dock" class="flex flex-col items-stretch w-full shrink-0">
        <div data-oaao-chat="composer-shell"
            class="flex justify-center px-8 pb-2 w-full min-w-0 self-stretch box-border shrink-0">
            <div class="oaao-chat-composer-inner-width w-full max-w-[48rem] min-w-0 flex flex-col items-stretch box-border">
                <!-- Template / deck refs sit outside the rounded composer card (attachment-style). -->
                <div data-oaao-chat="composer-refs" class="oaao-chat-composer-refs hidden flex flex-wrap items-center justify-end gap-1.5 w-full min-w-0 px-1 pb-2">
                    <div data-oaao-chat="composer-desk-mode-bar" class="oaao-chat-composer-desk-mode-bar hidden">
                        <div data-oaao-chat="desk-mode-badge"
                            class="oaao-chat-desk-mode-badge inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.6875rem] fw-semibold border border-[var(--grid-accent,#2563eb)]/35 bg-[color-mix(in_srgb,var(--grid-accent,#2563eb)_10%,transparent)] fg-[var(--grid-accent,#2563eb)] shrink-0"
                            aria-live="polite">
                            <span data-oaao-rui-icon="gallery-thumbnails" data-oaao-rui-icon-size="14" class="inline-flex shrink-0 items-center justify-center" aria-hidden="true"></span>
                            <span data-i18n="chat.desk_mode.badge">Desk Mode</span>
                        </div>
                        <div data-oaao-chat="composer-desk-materials-host" class="oaao-chat-composer-desk-materials-host shrink-0"></div>
                    </div>
                    <div data-oaao-chat="active-template-chip" class="hidden flex flex-wrap gap-1.5"></div>
                    <div data-oaao-chat="active-material-chip" class="hidden flex flex-wrap gap-1.5"></div>
                </div>
                <!-- Shared chrome: main composer + optional pipeline toolbar ({@code composer_extra_toolbar}). -->
                <div data-oaao-chat="composer-card-wrap"
                    class="flex flex-col w-full min-w-0 rounded-[22px] overflow-hidden p-px bg-[var(--grid-panel)] [box-sizing:border-box] [box-shadow:0_12px_32px_rgba(0,0,0,0.02),0_0_0_1px_rgba(0,0,0,0.12)]">
                    <div data-oaao-chat="composer-inner"
                        class="flex flex-col min-w-0 w-full bg-[var(--grid-panel-bright)] [box-sizing:border-box]">
                    <form data-oaao-chat="composer"
                        class="flex flex-col gap-2 w-full py-2 bg-transparent rounded-none border-0 shadow-none [box-sizing:border-box]">
                        <div class="flex w-full min-w-0 items-stretch gap-2 px-4">
                            <div class="flex flex-col flex-1 min-w-0 gap-2 w-full min-h-0 items-stretch">
                                <div data-oaao-chat="composer-input-shell"
                                    class="oaao-chat-composer-input-shell w-full min-w-0 min-h-[88px] max-h-[216px] overflow-y-auto [overscroll-behavior-y:contain] px-1 py-2 [box-sizing:border-box]">
                                    <div data-oaao-chat="input" contenteditable="true" role="textbox" aria-multiline="true"
                                        spellcheck="true"
                                        data-placeholder="Assign a task or ask any question"
                                        aria-label="Message"
                                        class="oaao-chat-composer-editor w-full min-h-[72px] max-h-[200px] border-none px-0 py-0 text-[15px] leading-[24px] fg-[var(--grid-ink)] bg-transparent [font-family:inherit] [outline:none] [box-sizing:border-box] whitespace-pre-wrap break-words empty:fg-[var(--grid-caption)]"></div>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center justify-between gap-2 px-3 pb-1 flex-wrap">
                            <div class="flex flex-wrap items-center gap-2 min-w-0">
                                <!-- {@code composer_zone: composer_left} — {@see chat-panel.js mountChatComposerRegistrySlots}. -->
                                <div data-oaao-chat="composer-feature-toggles" class="inline-flex flex-wrap items-center gap-1.5 shrink-0"></div>
                                <div data-oaao-chat="composer-registry-slots-left" class="flex flex-wrap items-center gap-2 min-w-0"></div>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 shrink-0 ml-auto justify-end">
                                <!-- {@code composer_zone: composer_actions} -->
                                <div data-oaao-chat="composer-registry-slots-actions" class="flex flex-wrap items-center gap-2 shrink-0"></div>
                                <button type="submit" data-oaao-chat="send"
                                    class="inline-flex items-center justify-center w-8 h-8 p-0 border-0 rounded-full bg-[#2d2d2d] fg-[#fff] cursor-pointer hover:opacity-[0.88] disabled:opacity-50 disabled:pointer-events-none shrink-0"
                                    aria-label="Send" data-i18n-aria="chat.send_message">
                                    <svg data-oaao-chat-icon="send" xmlns="http://www.w3.org/2000/svg" class="rz-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                                    <svg data-oaao-chat-icon="stop" xmlns="http://www.w3.org/2000/svg" class="rz-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
                                </button>
                            </div>
                        </div>
                    </form>
                    </div>
                    <!-- Shown when any {@code composer_zone: composer_extra_toolbar} slot mounts ({@see chat-panel.js}). -->
                    <div data-oaao-chat="composer-extra-toolbar-wrap"
                        class="hidden w-full box-border px-4 py-2 gap-1.5 text-[0.625rem] leading-tight fg-[var(--grid-ink-muted)] bg-[var(--grid-panel)] [border-top:1px_solid_var(--grid-line)] flex flex-wrap items-center min-h-0 shrink-0">
                        <div data-oaao-chat="composer-registry-extra-toolbar" class="flex flex-wrap items-center gap-1.5 min-w-0 w-full"></div>
                    </div>
                </div>
            </div>
        </div>
        <p data-oaao-chat="composer-disclaimer"
            class="oaao-chat-composer-disclaimer w-full max-w-[48rem] mx-auto box-border px-8 sm:px-[1.125rem] pt-1 pb-1 text-center text-[0.68rem] leading-snug fg-[var(--grid-caption)] select-none shrink-0"
            role="note">
            <span data-i18n="workspace.chat_disclaimer">OAAO.ai can make mistakes. Verify important information. Chats may be processed according to your workspace policy.</span>
        </p>
        </div>

        <div data-oaao-chat="prompt-grid"
            class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[720px] mx-auto px-8 pt-4 pb-10">
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
    </div>

    <!-- Task steps render inline on assistant rows; legacy strip kept for session restore only. -->
    <div id="oaao-task-list-strip" data-oaao-chat="task-list-strip" class="hidden" hidden aria-hidden="true"></div>
</section>
