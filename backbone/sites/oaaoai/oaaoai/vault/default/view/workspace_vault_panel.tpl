<section class="oaao-vault-root flex flex-1 min-h-0 min-w-0 flex-col w-full overflow-hidden bg-[var(--grid-paper)]"
    data-module="oaao-vault">
    <header class="shrink-0 px-md py-sm border-b-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]">
        <h1 class="text-[0.9375rem] fw-semibold fg-[var(--grid-ink)] m-0 tracking-tight" data-i18n="workspace.vault_panel_title">Vault</h1>
        <p class="text-[0.8125rem] fg-[var(--grid-caption)] m-0 mt-1 leading-snug max-w-[48rem]"
            data-i18n="workspace.vault_panel_subtitle_main">
            Overview shows each vault as a card (file counts, RAG on/off). Open a vault for the folder/file list and uploads.
        </p>
    </header>

    <div class="flex flex-1 min-h-0 flex-col overflow-hidden">
        <!-- Browse: tree + upload + file actions -->
        <div data-oaao-vault-panel-page="browse" class="flex flex-1 min-h-0 flex-col overflow-hidden">

            <div data-oaao-vault-new-folder-wrap
                class="hidden relative shrink-0 px-md py-xs border-b-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] flex flex-row flex-wrap items-stretch gap-2">
                <label class="sr-only" for="oaao-vault-new-folder-input"
                    data-i18n="workspace.vault_new_folder_label">New folder name</label>
                <input id="oaao-vault-new-folder-input" type="text" maxlength="120" autocomplete="off"
                    placeholder="Folder name…"
                    data-i18n-attr:placeholder="workspace.vault_new_folder_placeholder"
                    class="flex-1 min-w-0 max-w-full sm:max-w-[28rem] h-9 leading-none rounded-[8px] border-[1px] border-solid border-[var(--grid-line)] px-3 text-[0.8125rem] fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] font-inherit box-border shadow-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--grid-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--grid-panel)]" />
                <button type="button" id="oaao-vault-new-folder-btn"
                    class="shrink-0 rounded-[8px] h-9 px-3 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center self-stretch">
                    <span data-i18n="workspace.vault_new_folder_btn">New folder</span>
                </button>
                <input id="oaao-vault-toolbar-file-input" type="file" multiple class="sr-only"
                    tabindex="-1" aria-hidden="true" />
                <button type="button" id="oaao-vault-toolbar-upload-btn"
                    class="shrink-0 rounded-[8px] h-9 px-3 gap-1.5 text-[0.75rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-panel-bright)] border-[1px] border-solid border-[var(--grid-line)] cursor-pointer font-inherit hover:bg-[var(--grid-line)]/25 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center self-stretch"
                    disabled>
                    <svg xmlns="http://www.w3.org/2000/svg" class="rz-icon block shrink-0 w-4 h-4 pointer-events-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 19V5"/><path d="m5 12 7-7 7 7"/><path d="M5 19h14"/>
                    </svg>
                    <span data-i18n="workspace.vault_toolbar_upload_btn">Upload</span>
                </button>
                <span class="sr-only" data-oaao-vault-upload-aria-source data-i18n="workspace.vault_upload_file_label">File</span>
                <div data-oaao-vault-uploader-host class="oaao-vault-uploader-host-hidden" aria-hidden="true"></div>
                <p id="oaao-vault-new-folder-note"
                    class="hidden basis-full m-0 text-[0.6875rem] fg-[var(--grid-caption)] leading-snug"></p>
                <p data-oaao-vault-upload-note class="hidden basis-full m-0 text-[0.72rem] fg-[var(--grid-caption)] text-center leading-snug"></p>
            </div>

            <div class="flex flex-1 min-h-0 min-w-0 flex-col md:flex-row overflow-hidden">
                <div class="oaao-vault-explorer-column relative flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
                    <div data-oaao-vault="tree-main-host" role="region"
                        aria-label="Vault contents"
                        class="oaao-vault-tree-scroll flex-1 min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch] flex flex-col gap-0 text-[0.8125rem] fg-[var(--grid-ink)] bg-[var(--grid-paper)]"
                        aria-busy="false">
                    </div>
                </div>
                <aside data-oaao-vault-document-detail
                    class="shrink-0 md:w-[min(280px,42vw)] w-full md:max-w-none max-h-[38vh] md:max-h-none border-t-[1px] md:border-t-0 md:border-l-[1px] border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] flex flex-col min-h-0 overflow-hidden">
                    <div class="px-md py-sm border-b-[1px] border-solid border-[var(--grid-line)] text-[0.6875rem] uppercase tracking-wide fg-[var(--grid-caption)] fw-semibold shrink-0"
                        data-i18n="workspace.vault_file_actions_heading">File actions</div>
                    <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-md py-sm flex flex-col gap-2">
                        <p data-oaao-vault-detail-empty class="text-[0.8125rem] fg-[var(--grid-caption)] m-0 leading-snug"
                            data-i18n="workspace.vault_select_file_hint">Select a file in the tree. Click a vault or folder to set the upload target.</p>
                        <div data-oaao-vault-detail-body class="hidden flex flex-col gap-2 min-h-0">
                            <p data-oaao-vault-detail-name class="text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] truncate m-0"></p>
                            <p data-oaao-vault-detail-meta class="text-[0.72rem] fg-[var(--grid-caption)] m-0 leading-snug break-words"></p>
                            <p data-oaao-vault-detail-embed class="hidden text-[0.72rem] m-0 leading-snug break-words whitespace-pre-wrap border-l-[3px] border-solid border-[rgba(220,38,38,0.35)] pl-2 fg-[var(--grid-ink-muted)]"></p>
                            <div data-oaao-vault-detail-embed-chunks class="hidden"></div>
                            <p data-oaao-vault-detail-graph class="hidden text-[0.72rem] m-0 leading-snug break-words whitespace-pre-wrap border-l-[3px] border-solid border-[rgba(37,99,235,0.35)] pl-2 fg-[var(--grid-ink-muted)]"></p>
                            <div data-oaao-vault-detail-actions class="flex flex-col gap-1.5"></div>
                            <p data-oaao-vault-detail-job-note class="hidden text-[0.72rem] fg-[var(--grid-caption)] m-0 leading-snug"></p>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    </div>
</section>
