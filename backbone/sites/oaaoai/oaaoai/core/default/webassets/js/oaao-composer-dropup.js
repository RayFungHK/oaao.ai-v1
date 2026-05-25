/**
 * Composer footer dropup — chevron in composer row; menu portals to document.body.
 */

const CHEVRON_UP_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="block shrink-0 pointer-events-none" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';

const TICK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const DROPUP_STYLE_ID = 'oaao-composer-dropup-inline';
const DROPUP_STYLE_REV = '20260525-composer-dropup-v29';

/** @type {number} */
let composerDropupFallbackZ = 9000;

/** @param {HTMLElement} el */
function composerDropupZAcquire(el) {
    const registry = globalThis.razyui?.zIndex;
    if (registry && typeof registry.acquire === 'function') {
        try {
            return registry.acquire(el);
        } catch {
            /* fall through */
        }
    }
    composerDropupFallbackZ += 1;
    el.style.zIndex = String(composerDropupFallbackZ);
    return composerDropupFallbackZ;
}

/** @param {HTMLElement} el */
function composerDropupZRelease(el) {
    const registry = globalThis.razyui?.zIndex;
    if (registry && typeof registry.release === 'function') {
        try {
            registry.release(el);
            return;
        } catch {
            /* fall through */
        }
    }
    el.style.zIndex = '';
}

/** @param {HTMLElement} anchor */
function applyComposerDropupPortalStyles(anchor) {
    anchor.style.position = 'fixed';
    anchor.style.margin = '0';
    anchor.style.padding = '0';
    anchor.style.transform = 'none';
    anchor.style.pointerEvents = 'auto';
    anchor.style.boxSizing = 'border-box';
}

/** Inline CSS — must not rely on cached shell CSS or Tailwind JIT. */
function ensureComposerDropupStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(DROPUP_STYLE_ID);
    if (prev?.dataset.oaaoRev === DROPUP_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = DROPUP_STYLE_ID;
    style.dataset.oaaoRev = DROPUP_STYLE_REV;
    style.textContent = `
.oaao-chat-composer-dropup-root{position:relative;display:inline-flex;flex-direction:column;align-items:center;justify-content:flex-end;align-self:flex-end;vertical-align:bottom}
.oaao-chat-composer-dropup-icon-slot{display:inline-flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:0;flex-shrink:0}
.oaao-chat-composer-dropup-arrow{display:inline-flex;align-items:center;justify-content:center;width:1rem;height:.75rem;padding:0;margin:0;border:none;border-radius:0;background:transparent;box-shadow:none;color:var(--grid-caption,#888);cursor:pointer;opacity:.82;line-height:1;flex-shrink:0}
.oaao-chat-composer-dropup-arrow:hover,.oaao-chat-composer-dropup-arrow:focus-visible,.oaao-chat-composer-dropup-root.is-open .oaao-chat-composer-dropup-arrow{color:var(--grid-ink-muted,#666);opacity:1}
.oaao-chat-composer-dropup-arrow:disabled{opacity:.4;cursor:not-allowed}
.oaao-chat-composer-dropup-anchor{min-width:10.5rem;max-width:min(18rem,calc(100vw - 2rem));box-sizing:border-box}
.oaao-chat-composer-dropup-anchor--portal{position:fixed!important;margin:0!important;padding:0!important;transform:none!important;pointer-events:auto!important}
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
`;
    document.head.append(style);
}

/**
 * @param {HTMLElement} triggerEl
 * @param {HTMLElement} anchor
 */
function positionComposerDropupPortal(triggerEl, anchor) {
    const rect = triggerEl.getBoundingClientRect();
    const pr = anchor.getBoundingClientRect();
    const gap = 6;
    const margin = 8;
    let top = rect.top - pr.height - gap;
    let left = rect.left + rect.width / 2 - pr.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - pr.width - margin));
    if (top < margin) {
        top = rect.bottom + gap;
    }
    anchor.style.top = `${Math.round(top)}px`;
    anchor.style.left = `${Math.round(left)}px`;
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

    if (iconBtn !== root && !root.contains(iconBtn)) {
        root.append(iconBtn);
    }

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
    anchor.className = 'oaao-chat-composer-dropup-anchor oaao-chat-composer-dropup-anchor--portal hidden';
    anchor.hidden = true;
    anchor.setAttribute('data-oaao-composer-dropup-portal', '1');

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
    root.replaceChildren(iconSlot);

    let open = false;
    let portalMounted = false;

    const positionPortal = () => {
        if (!portalMounted || !open) return;
        positionComposerDropupPortal(arrowBtn, anchor);
    };

    const onReposition = () => {
        positionPortal();
    };

    const mountPortal = () => {
        if (portalMounted) return;
        anchor.hidden = false;
        anchor.classList.remove('hidden');
        anchor.classList.add('oaao-chat-composer-dropup-anchor--portal');
        applyComposerDropupPortalStyles(anchor);
        document.body.append(anchor);
        composerDropupZAcquire(anchor);
        portalMounted = true;
        positionPortal();
        document.addEventListener('scroll', onReposition, true);
        window.addEventListener('resize', onReposition);
    };

    const unmountPortal = () => {
        if (!portalMounted) return;
        document.removeEventListener('scroll', onReposition, true);
        window.removeEventListener('resize', onReposition);
        composerDropupZRelease(anchor);
        anchor.remove();
        anchor.hidden = true;
        anchor.classList.add('hidden');
        anchor.style.top = '';
        anchor.style.left = '';
        portalMounted = false;
    };

    const setOpen = (next) => {
        const wantOpen = Boolean(next);
        if (wantOpen === open) return;
        open = wantOpen;
        root.classList.toggle('is-open', open);
        arrowBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            mountPortal();
            requestAnimationFrame(() => {
                if (open) positionPortal();
            });
            opts.onOpen?.();
        } else {
            unmountPortal();
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
        if (root.contains(target) || anchor.contains(target)) return;
        setOpen(false);
    };

    const onKey = (ev) => {
        if (ev.key === 'Escape') setOpen(false);
    };

    document.addEventListener('click', onDocClick, opts.signal ? { signal: opts.signal, capture: true } : { capture: true });
    document.addEventListener('keydown', onKey, opts.signal ? { signal: opts.signal } : undefined);

    if (opts.signal) {
        opts.signal.addEventListener(
            'abort',
            () => {
                setOpen(false);
            },
            { once: true },
        );
    }

    return {
        panel,
        list,
        arrowBtn,
        anchor,
        open: () => setOpen(true),
        close: () => setOpen(false),
        setOpen,
        isOpen: () => open,
        reposition: positionPortal,
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
