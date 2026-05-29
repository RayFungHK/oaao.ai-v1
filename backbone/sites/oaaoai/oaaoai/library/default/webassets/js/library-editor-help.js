/**
 * Library BlockEditor — detailed tips dialog (per block type + gestures).
 */

/** @typedef {{ icon: string, title: string, summary: string, tips: string[] }} LibraryEditorHelpBlock */

/** @type {ReadonlyArray<LibraryEditorHelpBlock>} */
export const LIBRARY_EDITOR_BLOCK_HELP = [
    {
        icon: '¶',
        title: 'Text',
        summary: 'Plain paragraph — default block for body copy.',
        tips: [
            'Type / to open the slash menu and pick another block type.',
            'Select text to show the floating format bar (bold, link, etc.).',
        ],
    },
    {
        icon: 'H1',
        title: 'Heading 1',
        summary: 'Largest section title — use once per major section.',
        tips: ['Type # then Space at the start of a line to convert from text.', 'Good for document title sections below the page title.'],
    },
    {
        icon: 'H2',
        title: 'Heading 2',
        summary: 'Medium section header.',
        tips: ['Type ## then Space at line start.', 'Use the ⠇ menu → Turn into… to change level without retyping.'],
    },
    {
        icon: 'H3',
        title: 'Heading 3',
        summary: 'Small section header.',
        tips: ['Type ### then Space at line start.', 'Keeps outline hierarchy under H1/H2.'],
    },
    {
        icon: '•',
        title: 'Bullet list',
        summary: 'Unordered list item.',
        tips: [
            'Type - or * then Space at line start.',
            'Press Enter for another bullet; Backspace on empty line exits the list.',
        ],
    },
    {
        icon: '1.',
        title: 'Numbered list',
        summary: 'Ordered list — numbers auto-increment.',
        tips: ['Type 1. then Space at line start.', 'Each new line in the same list gets the next number.'],
    },
    {
        icon: '☑',
        title: 'To-do',
        summary: 'Checkbox item — click the box to mark done.',
        tips: ['Type [ ] then Space at line start.', 'Checked items show struck-through text.'],
    },
    {
        icon: '</>',
        title: 'Code',
        summary: 'Monospace code block with optional language label.',
        tips: [
            'Use for snippets, JSON, or shell commands.',
            'Set the language field above the block for future highlighting export.',
        ],
    },
    {
        icon: '❝',
        title: 'Quote',
        summary: 'Indented blockquote for citations or callouts.',
        tips: ['Type > then Space at line start.', 'Works well for pull quotes and attributed text.'],
    },
    {
        icon: '—',
        title: 'Divider',
        summary: 'Horizontal rule between sections.',
        tips: ['Type --- then Space on an empty line.', 'The block has no editable text — only the line.'],
    },
    {
        icon: '💡',
        title: 'Callout',
        summary: 'Highlighted box with emoji icon.',
        tips: ['Click the emoji on the left to change it.', 'Use for warnings, tips, or key takeaways.'],
    },
    {
        icon: '▶',
        title: 'Toggle',
        summary: 'Collapsible section — click the arrow to expand/collapse.',
        tips: ['Put summary text in the toggle title row.', 'Nested blocks can live inside when expanded.'],
    },
    {
        icon: '🖼',
        title: 'Image',
        summary: 'Embed an image from URL.',
        tips: ['Use the block menu or slash menu to insert.', 'You will be prompted for URL and alt text.'],
    },
    {
        icon: '⊞',
        title: 'Table',
        summary: 'Grid of cells — edit inline like a spreadsheet.',
        tips: [
            'Insert via / → Table.',
            'Hover the table for row/column controls in the table bar.',
        ],
    },
];

/** @type {ReadonlyArray<readonly [string, string]>} */
export const LIBRARY_EDITOR_GESTURE_HELP = [
    [
        '⠇ Block handle (left gutter)',
        'Click once to open Actions. Drag the same handle to reorder — one blue insertion line (BlockEditor) plus a highlighted target row.',
    ],
    [
        '+ Add block',
        'Inserts a new paragraph below the current block.',
    ],
    [
        'Slash menu (/)',
        'In any text block, type / to filter block types, tables, and AI skills.',
    ],
    [
        'Markdown shortcuts',
        'At line start, type # / ## / ### / - / 1. / [ ] / > / --- then Space to convert the block.',
    ],
    [
        'Keyboard',
        'Mod+/ (⌘/ or Ctrl+/) opens the block menu for the focused block.',
    ],
    [
        'Page title',
        'The large title at the top is separate from heading blocks — it is saved as the document name.',
    ],
];

/**
 * @param {(root: HTMLElement) => void} hydrateJitRoot
 */
export function openLibraryEditorHelpDialog(hydrateJitRoot) {
    const overlay = document.createElement('div');
    overlay.className =
        'fixed inset-0 z-[1200] flex items-center justify-center bg-black/35 p-4 box-border';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Library editor tips');

    const card = document.createElement('div');
    card.className =
        'w-full max-w-2xl max-h-[min(90vh,720px)] rounded-[12px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] shadow-lg flex flex-col min-h-0';

    const head = document.createElement('div');
    head.className = 'shrink-0 px-4 pt-4 pb-2 border-b border-solid border-[var(--grid-line)]';
    const title = document.createElement('h2');
    title.className = 'm-0 text-[1rem] fw-semibold fg-[var(--grid-ink)]';
    title.textContent = 'Editor tips';
    const sub = document.createElement('p');
    sub.className = 'm-0 mt-1 text-[0.8125rem] leading-snug fg-[var(--grid-caption)]';
    sub.textContent = 'Notion-style blocks, shortcuts, and gutter controls for Library documents.';
    head.append(title, sub);

    const scroll = document.createElement('div');
    scroll.className = 'flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 flex flex-col gap-4';

    const gesturesSec = document.createElement('section');
    gesturesSec.className = 'flex flex-col gap-2 min-w-0';
    const gesturesH = document.createElement('h3');
    gesturesH.className = 'm-0 text-[0.75rem] fw-semibold uppercase tracking-wide fg-[var(--grid-caption)]';
    gesturesH.textContent = 'Gestures & controls';
    gesturesSec.append(gesturesH);
    const gestureList = document.createElement('ul');
    gestureList.className = 'm-0 p-0 list-none flex flex-col gap-2';
    for (const [heading, detail] of LIBRARY_EDITOR_GESTURE_HELP) {
        gestureList.append(buildHelpItem(heading, detail));
    }
    gesturesSec.append(gestureList);
    scroll.append(gesturesSec);

    const blocksSec = document.createElement('section');
    blocksSec.className = 'flex flex-col gap-2 min-w-0';
    const blocksH = document.createElement('h3');
    blocksH.className = 'm-0 text-[0.75rem] fw-semibold uppercase tracking-wide fg-[var(--grid-caption)]';
    blocksH.textContent = 'Block types';
    blocksSec.append(blocksH);
    const blockGrid = document.createElement('div');
    blockGrid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-2';
    for (const block of LIBRARY_EDITOR_BLOCK_HELP) {
        blockGrid.append(buildBlockHelpCard(block));
    }
    blocksSec.append(blockGrid);
    scroll.append(blocksSec);

    const foot = document.createElement('div');
    foot.className =
        'shrink-0 px-4 py-3 border-t border-solid border-[var(--grid-line)] flex justify-end';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className =
        'rounded-[8px] h-9 px-4 text-[0.8125rem] fw-medium border-none bg-[var(--grid-accent)] fg-white cursor-pointer font-inherit';
    closeBtn.textContent = 'Got it';

    function closeDialog() {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    }

    /** @param {KeyboardEvent} ev */
    function onKey(ev) {
        if (ev.key === 'Escape') closeDialog();
    }

    closeBtn.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) closeDialog();
    });
    document.addEventListener('keydown', onKey);

    foot.append(closeBtn);
    card.append(head, scroll, foot);
    overlay.append(card);
    document.body.append(overlay);
    hydrateJitRoot(overlay);
    closeBtn.focus();
}

/**
 * @param {string} heading
 * @param {string} detail
 */
function buildHelpItem(heading, detail) {
    const item = document.createElement('li');
    item.className = 'flex flex-col gap-0.5';
    const h = document.createElement('span');
    h.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)]';
    h.textContent = heading;
    const p = document.createElement('p');
    p.className = 'm-0 text-[0.8125rem] leading-snug fg-[var(--grid-caption)]';
    p.textContent = detail;
    item.append(h, p);
    return item;
}

/** @param {LibraryEditorHelpBlock} block */
function buildBlockHelpCard(block) {
    const card = document.createElement('article');
    card.className =
        'rounded-[10px] border border-solid border-[var(--grid-line)] px-3 py-2 flex flex-col gap-1 bg-[var(--grid-paper)]';

    const row = document.createElement('div');
    row.className = 'flex items-center gap-2 min-w-0';
    const icon = document.createElement('span');
    icon.className =
        'shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-[6px] border border-solid border-[var(--grid-line)] text-[0.75rem] fg-[var(--grid-ink-muted)] bg-[var(--grid-panel-bright)]';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = block.icon;
    const title = document.createElement('span');
    title.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] truncate';
    title.textContent = block.title;
    row.append(icon, title);

    const summary = document.createElement('p');
    summary.className = 'm-0 text-[0.75rem] leading-snug fg-[var(--grid-ink-muted)]';
    summary.textContent = block.summary;

    const tips = document.createElement('ul');
    tips.className = 'm-0 pl-4 text-[0.6875rem] leading-snug fg-[var(--grid-caption)] flex flex-col gap-0.5';
    for (const tip of block.tips) {
        const li = document.createElement('li');
        li.textContent = tip;
        tips.append(li);
    }

    card.append(row, summary, tips);
    return card;
}
