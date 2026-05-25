/**
 * Composer footer dropup — hover chevron above icon, menu opens upward (planner mode, mic device, …).
 */

const CHEVRON_UP_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="block shrink-0 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';

const TICK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} iconBtn
 * @param {{
 *   signal?: AbortSignal,
 *   menuLabel: string,
 *   heading?: string,
 *   onOpen?: () => void,
 *   onClose?: () => void,
 * }} opts
 */
export function mountComposerDropupAbove(root, iconBtn, opts) {
    root.classList.add('oaao-chat-composer-dropup-root');

    const arrowBtn = document.createElement('button');
    arrowBtn.type = 'button';
    arrowBtn.className = 'oaao-chat-composer-dropup-arrow';
    arrowBtn.innerHTML = CHEVRON_UP_SVG;
    arrowBtn.setAttribute('aria-label', opts.menuLabel);
    arrowBtn.title = opts.menuLabel;

    const anchor = document.createElement('div');
    anchor.className = 'oaao-chat-composer-dropup-anchor hidden';
    anchor.hidden = true;

    const panel = document.createElement('div');
    panel.className = 'oaao-chat-composer-dropup-panel';
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', opts.menuLabel);

    if (opts.heading) {
        const heading = document.createElement('p');
        heading.className = 'oaao-chat-composer-dropup-heading';
        heading.textContent = opts.heading;
        panel.append(heading);
    }

    const list = document.createElement('div');
    list.className = 'oaao-chat-composer-dropup-list';
    panel.append(list);

    anchor.append(panel);
    root.insertBefore(arrowBtn, iconBtn);
    root.append(anchor);

    let open = false;

    const setOpen = (next) => {
        open = Boolean(next);
        root.classList.toggle('is-open', open);
        anchor.hidden = !open;
        anchor.classList.toggle('hidden', !open);
        arrowBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            opts.onOpen?.();
        } else {
            opts.onClose?.();
        }
    };

    arrowBtn.addEventListener(
        'click',
        (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setOpen(!open);
        },
        opts.signal ? { signal: opts.signal } : undefined,
    );

    const onDocClick = (ev) => {
        if (!open) return;
        const target = ev.target;
        if (!(target instanceof Node)) return;
        if (root.contains(target)) return;
        setOpen(false);
    };

    const onKey = (ev) => {
        if (ev.key === 'Escape') setOpen(false);
    };

    document.addEventListener('click', onDocClick, opts.signal ? { signal: opts.signal, capture: true } : { capture: true });
    document.addEventListener('keydown', onKey, opts.signal ? { signal: opts.signal } : undefined);

    return {
        panel,
        list,
        arrowBtn,
        open: () => setOpen(true),
        close: () => setOpen(false),
        setOpen,
        isOpen: () => open,
    };
}

/**
 * @param {HTMLElement} listHost
 * @param {Array<{ id: string, label: string }>} rows
 * @param {string} selectedId
 * @param {(id: string, label: string) => void} onPick
 * @param {{ disabled?: boolean }} [opts]
 */
export function renderComposerDropupOptions(listHost, rows, selectedId, onPick, opts = {}) {
    listHost.textContent = '';
    const rowClass =
        'oaao-chat-composer-dropup-option w-full flex items-center gap-1.5 min-w-0 px-2 py-1.5 rounded-[6px] border-none bg-transparent fg-[var(--grid-ink)] text-[0.8125rem] text-left cursor-pointer font-inherit hover:bg-[var(--grid-line)]/35';
    const selectedClass = ' oaao-chat-composer-dropup-option--selected';

    for (const row of rows) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.dataset.oaaoComposerDropupId = row.id;
        const selected = row.id === selectedId;
        btn.className = rowClass + (selected ? selectedClass : '');
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (opts.disabled) btn.disabled = true;

        const tick = document.createElement('span');
        tick.className = 'inline-flex shrink-0 w-3.5 h-3.5 items-center justify-center';
        tick.setAttribute('aria-hidden', 'true');
        if (selected) tick.innerHTML = TICK_SVG;

        const labelEl = document.createElement('span');
        labelEl.className = 'truncate min-w-0 flex-1';
        labelEl.textContent = row.label;

        btn.append(tick, labelEl);
        btn.addEventListener('click', () => {
            if (opts.disabled) return;
            onPick(row.id, row.label);
        });
        listHost.append(btn);
    }
}
