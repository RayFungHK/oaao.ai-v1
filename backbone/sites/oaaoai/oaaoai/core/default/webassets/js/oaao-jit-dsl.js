/**
 * RazyUI-oriented DOM helpers: **JIT utility tokens** on nodes + mounting structured markup **without**
 * assigning {@code element.innerHTML} on panel hosts (use {@link mountParsedHtml} / {@link replaceChildrenParsed}
 * for trusted fragments — e.g. composed UI + i18n inline tags).
 *
 * **Modularity:** Prefer {@link ruiBuild} trees (and small extracted builders) for reusable chunks. Reserve
 * trusted HTML strings for i18n-rich blobs only; mount them with {@link mountParsedHtml}. Prefer native
 * {@code <rui-*>} custom elements from {@code webassets/razyui/component/*} when you need full component
 * behaviour (Combobox, Dialog, …); use this DSL for lightweight admin/settings shells that must stay cheap.
 */

/** Outline primary control — same atomic JIT tokens as legacy inline classes (hydrate-safe). */
export const SETTINGS_BTN_PRIMARY_JIT = [
    'inline-flex items-center justify-center shrink-0',
    'box-border rounded-full',
    'px-3 py-1.5 min-h-[2.25rem]',
    'cursor-pointer font-inherit text-[0.8125rem] fw-medium leading-snug',
    'fg-[var(--grid-accent)] shadow-none',
    '[appearance:none]',
    'bg-transparent',
    '[border:1px_solid_var(--grid-accent)]',
    'hover:[background-color:color-mix(in_srgb,var(--grid-accent),transparent_90%)]',
    'active:[background-color:color-mix(in_srgb,var(--grid-accent),transparent_82%)]',
].join(' ');

/**
 * @param {Element | null | undefined} el
 * @param {string} jitSpaceSeparated
 */
export function jitApply(el, jitSpaceSeparated) {
    if (!el || !jitSpaceSeparated) return;
    for (const token of jitSpaceSeparated.split(/\s+/).filter(Boolean)) {
        el.classList.add(token);
    }
}

/**
 * Trusted HTML → nodes under {@code container} (no {@code container.innerHTML = …}).
 *
 * @param {ParentNode} container
 * @param {string} html
 */
export function mountParsedHtml(container, html) {
    const trimmed = String(html ?? '').trim();
    if (!trimmed) return;
    const doc = new DOMParser().parseFromString(trimmed, 'text/html');
    const frag = document.createDocumentFragment();
    for (const n of Array.from(doc.body.childNodes)) {
        frag.appendChild(n);
    }
    container.appendChild(frag);
}

/**
 * Replace all children by parsing trusted HTML.
 *
 * @param {Element} container
 * @param {string} html
 */
export function replaceChildrenParsed(container, html) {
    container.replaceChildren();
    mountParsedHtml(container, html);
}

/**
 * Replace children with a mix of parsed trusted HTML fragments and concrete nodes (order preserved).
 *
 * @param {Element} container
 * @param {ReadonlyArray<string | Node | null | undefined>} parts
 */
export function replaceChildrenMixed(container, parts) {
    container.replaceChildren();
    for (const p of parts) {
        if (p == null) continue;
        if (typeof p === 'string') mountParsedHtml(container, p);
        else container.appendChild(p);
    }
}

/**
 * Replace {@code select} options from an {@code <option>…} markup string without {@code select.innerHTML}.
 *
 * @param {HTMLSelectElement} sel
 * @param {string} optionsMarkup
 */
export function replaceSelectOptionsParsed(sel, optionsMarkup) {
    sel.replaceChildren();
    const wrapped = `<select>${String(optionsMarkup ?? '')}</select>`;
    const doc = new DOMParser().parseFromString(wrapped, 'text/html');
    const tmp = doc.body.firstElementChild;
    if (!(tmp instanceof HTMLSelectElement)) return;
    for (const opt of Array.from(tmp.options)) {
        sel.appendChild(opt.cloneNode(true));
    }
}

/**
 * Minimal declarative tree: tag + JIT class string + optional attrs + children (nodes or nested specs).
 *
 * @typedef {string | Node | null | undefined | RuiDslSpec} RuiDslChild
 * @typedef {{ t: string, j?: string, a?: Record<string, string>, ds?: Record<string, string>, txt?: string, c?: RuiDslChild[] }} RuiDslSpec
 */

/** @param {RuiDslSpec} spec */
export function ruiBuild(spec) {
    const el = document.createElement(spec.t);
    if (spec.j) jitApply(el, spec.j);
    if (spec.a) {
        for (const [k, v] of Object.entries(spec.a)) {
            el.setAttribute(k, v);
        }
    }
    if (spec.ds) {
        for (const [k, v] of Object.entries(spec.ds)) {
            el.dataset[k] = v;
        }
    }
    if (typeof spec.txt === 'string' && spec.txt !== '') {
        el.textContent = spec.txt;
    }
    if (Array.isArray(spec.c)) {
        for (const ch of spec.c) {
            if (ch == null) continue;
            if (typeof ch === 'string') {
                el.appendChild(document.createTextNode(ch));
            } else if (ch instanceof Node) {
                el.appendChild(ch);
            } else if (typeof ch === 'object' && ch !== null && 't' in ch) {
                el.appendChild(ruiBuild(/** @type {RuiDslSpec} */ (ch)));
            }
        }
    }
    return el;
}
