/**
 * Composer footer dropup — hover chevron above icon, menu opens upward (planner mode, mic device, …).
 */

const CHEVRON_UP_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="block shrink-0 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';

const TICK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const DROPUP_STYLE_ID = 'oaao-composer-dropup-inline';
const DROPUP_STYLE_REV = '20260525-composer-dropup-v20';

/** Inline CSS — must not rely on cached {@code oaao-chat-shell.css} or Tailwind JIT. */
function ensureComposerDropupStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(DROPUP_STYLE_ID);
    if (prev?.dataset.oaaoRev === DROPUP_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = DROPUP_STYLE_ID;
    style.dataset.oaaoRev = DROPUP_STYLE_REV;
    style.textContent = `
.oaao-chat-composer-dropup-root{position:relative;display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom}
.oaao-chat-composer-dropup-icon-slot{position:relative;display:inline-flex;align-items:center;justify-content:center}
.oaao-chat-composer-dropup-arrow{position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%);display:inline-flex;align-items:center;justify-content:center;width:1.125rem;height:1.125rem;padding:0;border:none;border-radius:999px;background:var(--grid-panel-bright,#fff);color:var(--grid-ink-muted,#666);box-shadow:0 1px 4px rgba(0,0,0,.14);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .14s ease,color .14s ease,background .14s ease;z-index:3}
.oaao-chat-composer-dropup-root:hover .oaao-chat-composer-dropup-arrow,.oaao-chat-composer-dropup-root:focus-within .oaao-chat-composer-dropup-arrow,.oaao-chat-composer-dropup-root.is-open .oaao-chat-composer-dropup-arrow{opacity:1;pointer-events:auto}
.oaao-chat-composer-dropup-arrow:hover{color:var(--grid-ink,#111);background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 35%,var(--grid-panel-bright,#fff))}
.oaao-chat-composer-dropup-anchor{position:absolute;left:50%;bottom:calc(100% + 1.35rem);transform:translateX(-50%);z-index:70;min-width:10.5rem;max-width:min(18rem,calc(100vw - 2rem))}
.oaao-chat-composer-dropup-anchor.hidden,.oaao-chat-composer-dropup-anchor[hidden]{display:none!important}
.oaao-chat-composer-dropup-panel{border-radius:10px;border:1px solid var(--grid-line,rgba(0,0,0,.12));background:var(--grid-panel-bright,#fff);box-shadow:0 8px 24px rgba(0,0,0,.14);overflow:hidden;color:var(--grid-ink,#111)}
.oaao-chat-composer-dropup-heading{margin:0;padding:.5rem .625rem .25rem;font-size:.6875rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--grid-caption,#888)}
.oaao-chat-composer-dropup-list{display:flex;flex-direction:column;gap:.125rem;max-height:min(40vh,240px);overflow-x:hidden;overflow-y:auto;padding:.25rem}
.oaao-chat-composer-dropup-option{width:100%;display:flex;align-items:center;gap:.375rem;min-width:0;padding:.375rem .5rem;border:none;border-radius:6px;background:transparent;color:var(--grid-ink,#111);font:inherit;font-size:.8125rem;line-height:1.35;text-align:left;cursor:pointer}
.oaao-chat-composer-dropup-option:hover:not(:disabled){background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 35%,transparent)}
.oaao-chat-composer-dropup-option--selected{background:color-mix(in srgb,var(--grid-line,rgba(0,0,0,.12)) 45%,transparent);font-weight:600}
.oaao-chat-composer-dropup-option:disabled{opacity:.5;cursor:not-allowed}
.oaao-chat-composer-dropup-option-tick{display:inline-flex;flex-shrink:0;width:.875rem;height:.875rem;align-items:center;justify-content:center}
.oaao-chat-composer-dropup-option-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.oaao-chat-composer-dropup-empty{margin:0;padding:.375rem .5rem;font-size:.8125rem;color:var(--grid-ink-muted,#666)}
.oaao-chat-composer-dropup-root.is-open{z-index:30}
[data-oaao-chat='composer-feature-toggles']:has(.oaao-chat-composer-dropup-root.is-open),[data-oaao-chat='composer-registry-slots-actions']:has(.oaao-chat-composer-dropup-root.is-open){overflow:visible;position:relative;z-index:25}
@media (hover:none){.oaao-chat-composer-dropup-arrow{opacity:.78;pointer-events:auto}}
`;
    document.head.append(style);
}

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
    ensureComposerDropupStyles();
    root.classList.add('oaao-chat-composer-dropup-root');

    const iconSlot = document.createElement('div');
    iconSlot.className = 'oaao-chat-composer-dropup-icon-slot';

    const arrowBtn = document.createElement('button');
    arrowBtn.type = 'button';
    arrowBtn.className = 'oaao-chat-composer-dropup-arrow';
    arrowBtn.innerHTML = CHEVRON_UP_SVG;
    arrowBtn.setAttribute('aria-label', opts.menuLabel);
    arrowBtn.title = opts.menuLabel;
    arrowBtn.setAttribute('aria-expanded', 'false');

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
    iconSlot.append(arrowBtn, iconBtn);
    root.replaceChildren(iconSlot, anchor);

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

    for (const row of rows) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'option');
        btn.dataset.oaaoComposerDropupId = row.id;
        const selected = row.id === selectedId;
        btn.className = 'oaao-chat-composer-dropup-option' + (selected ? ' oaao-chat-composer-dropup-option--selected' : '');
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        if (opts.disabled) btn.disabled = true;

        const tick = document.createElement('span');
        tick.className = 'oaao-chat-composer-dropup-option-tick';
        tick.setAttribute('aria-hidden', 'true');
        if (selected) tick.innerHTML = TICK_SVG;

        const labelEl = document.createElement('span');
        labelEl.className = 'oaao-chat-composer-dropup-option-label';
        labelEl.textContent = row.label;

        btn.append(tick, labelEl);
        btn.addEventListener('click', () => {
            if (opts.disabled) return;
            onPick(row.id, row.label);
        });
        listHost.append(btn);
    }
}

/** @param {HTMLElement} listHost @param {string} text */
export function renderComposerDropupEmpty(listHost, text) {
    listHost.textContent = '';
    const empty = document.createElement('p');
    empty.className = 'oaao-chat-composer-dropup-empty';
    empty.textContent = text;
    listHost.append(empty);
}
