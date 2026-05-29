/**
 * oaao.ai v1 — JIT presets (call JITModule.setPreset before razyui.boot()).
 *
 * Why JIT (post-modularization): per-module / lazy-loaded UI fragments share one document; large
 * hand-written global CSS collides across modules and razit. Scoped utility tokens + hydrate keep
 * ownership local. Prefer RazyUI Components (<rui-*> / Dialog / AjaxForm / …) for behaviour; use JIT
 * for layout tokens and host tweaks — see .cursor/rules/rayfung-razy-stack.mdc.
 *
 * Login inputs: <rui-input preset="login"> — preset in public/js/preset/login.js.
 * Shell presets: public/js/preset/shell.js (composer Input, toolbar Button).
 *
 * Other pages: class on <rui-input>
 *   - oaao-input-form — default-ish in-app form
 * Native <input> / search: oaao-input-inline
 * RazyUI Combobox host: oaao-combobox-form
 * Plain <rui-input> with no extra class uses theme defaults.
 */

/** @type {Record<string, string>} */
const oaaoPresets = {
    'oaao-surface': 'bg-[var(--grid-paper)] fg-[var(--grid-ink)]',
    'oaao-surface-bright': 'bg-[var(--grid-panel-bright)] fg-[var(--grid-ink)]',
    'oaao-surface-nav': 'bg-[var(--grid-nav)]',
    'oaao-ink': 'fg-[var(--grid-ink)]',
    'oaao-ink-muted': 'fg-[var(--grid-ink-muted)]',
    'oaao-caption': 'fg-[var(--grid-caption)]',

    'oaao-app': [
        '[--oaao-rail-width:52px]',
        '[margin:0] [font-family:Inter,DM_Sans,system-ui,sans-serif]',
        'text-[14px]',
    ].join(' '),

    'oaao-theme-grid': [
        '[--ta-bg:var(--grid-panel-bright)] [--ta-border:var(--grid-line)] [--ta-text:var(--grid-ink)]',
        '[&_.button]:[box-sizing:border-box]',
        '[&_.textarea]:[box-sizing:border-box] [&_.textarea]:max-w-full',
        '[&_svg.rz-icon]:inline-flex [&_svg.rz-icon]:items-center [&_svg.rz-icon]:justify-center [&_svg.rz-icon]:[vertical-align:middle]',
        "[&_i[class*='ri-']]:not-italic [&_i[class*='ri-']]:leading-none [&_i[class*='ri-']]:inline-block [&_i[class*='ri-']]:[vertical-align:middle]",
    ].join(' '),

    'oaao-login-cta': 'w-full',

    'oaao-login-footer': [
        '[margin-top:auto] pt-16 max-w-[28rem] w-full mx-auto text-center',
        'text-[0.75rem] fg-[var(--grid-caption)] leading-relaxed',
    ].join(' '),

    /**
     * In-app forms — distinct from login; tweak tokens or add more --inp-* as needed.
     */
    'oaao-input-form': [
        'w-full',
        '[--inp-h:2.25rem]',
        '[--inp-radius:var(--rui-radius-sm)]',
        '[--inp-bg:var(--rui-bg-inset)]',
        '[--inp-border:var(--grid-line)]',
    ].join(' '),

    /**
     * Native {@code <input>} / search fields — workspace folder trigger parity + focus ring.
     */
    'oaao-input-inline': [
        'flex-1 min-w-[12rem] outline-none w-full',
        'rounded-[8px] min-h-9 px-2.5 py-1.5 text-[0.8125rem] fw-medium',
        'fg-[var(--grid-ink)] bg-[var(--grid-paper)] font-inherit box-border',
        'border border-solid border-[var(--grid-line)]',
        'hover:bg-[var(--grid-line)]/25 transition-colors',
        'focus:border-[var(--grid-accent)]',
        'focus:[box-shadow:0_0_0_2px_color-mix(in_srgb,var(--grid-accent),transparent_88%)]',
    ].join(' '),

    /**
     * RazyUI Combobox host — grid tokens; apply {@code OAAO_COMBOBOX_CONTAINER_JIT} on {@code .combobox-container} after mount.
     */
    'oaao-combobox-form': [
        'font-inherit text-[0.8125rem] w-full min-w-0',
        '[--rui-bg:var(--grid-paper)]',
        '[--rui-border:var(--grid-line)]',
        '[--rui-radius-sm:8px]',
        '[--rui-text:var(--grid-ink)]',
        '[--rui-text-muted:var(--grid-caption)]',
        '[--rui-accent:var(--grid-accent)]',
        '[--rui-bg-hover:color-mix(in_srgb,var(--grid-line),transparent_70%)]',
        '[--rui-border-strong:color-mix(in_srgb,var(--grid-line),var(--grid-ink)_15%)]',
    ].join(' '),

    /** Primary black CTA — maps to RazyUI Button --btn-* on .button host */
    'oaao-btn-login': [
        'w-full',
        '[--btn-h:3rem]',
        '[--btn-radius:10px]',
        '[font-weight:600]',
        '[--btn-bg:#2d2d2d] [--btn-border:#2d2d2d] [--btn-text:#fff]',
        '[--btn-bg-hover:color-mix(in_srgb,#2d2d2d,transparent_8%)]',
        '[--btn-border-hover:#2d2d2d] [--btn-text-hover:#fff]',
        '[--btn-bg-active:color-mix(in_srgb,#2d2d2d,transparent_15%)]',
        '[&:hover]:opacity-[0.92]',
    ].join(' '),

    /** Settings dialog section typography inside panels — shell layout tokens live in {@link ./settings-dialog.js} as atomic JIT classes. */
    'oaao-sdlg-section-title': 'text-sm fw-semibold fg-[var(--grid-ink)] mb-2',
    'oaao-sdlg-section-desc': 'text-xs fg-[var(--grid-caption)] mb-4',

    /** Chat composer — contenteditable body ({@code data-oaao-chat="input"}). */
    'oaao-composer-editor': [
        'w-full min-h-[72px] max-h-[200px] border-none px-0 py-0',
        'text-[15px] leading-[24px] fg-[var(--grid-ink)] bg-transparent',
        '[font-family:inherit] [outline:none] [box-sizing:border-box]',
        'whitespace-pre-wrap break-words empty:fg-[var(--grid-caption)]',
    ].join(' '),

    /** Chat composer scroll shell. */
    'oaao-composer-input-shell': [
        'w-full min-w-0 min-h-[88px] max-h-[216px] overflow-y-auto',
        '[overscroll-behavior-y:contain] px-1 py-2 [box-sizing:border-box]',
    ].join(' '),

    /** Composer feature toggles (web search, planner steps). */
    'oaao-composer-toggle': [
        'inline-flex items-center justify-center w-8 h-8 p-0',
        '[border:1px_solid_var(--grid-line)] rounded-full bg-transparent',
        'fg-[var(--grid-ink-muted)] hover:bg-[var(--grid-line)]/35 hover:fg-[var(--grid-ink)]',
        'cursor-pointer font-inherit shrink-0 transition-colors',
    ].join(' '),

    /** Library editor toolbar + finalize dialog actions. */
    'oaao-library-toolbar-btn': [
        'rounded-[8px] h-9 px-3 text-[0.8125rem] fw-medium shrink-0',
        'border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)]',
        'cursor-pointer font-inherit fg-[var(--grid-ink)]',
        'hover:bg-[var(--grid-line)]/25 transition-colors',
    ].join(' '),

    'oaao-library-toolbar-btn-ghost': [
        'rounded-[8px] h-9 px-3 text-[0.8125rem] shrink-0',
        'border border-solid border-[var(--grid-line)] bg-transparent',
        'cursor-pointer font-inherit fg-[var(--grid-ink)]',
        'hover:bg-[var(--grid-line)]/20 transition-colors',
    ].join(' '),

    /** Library corpus picker + native selects. */
    'oaao-library-select': [
        'rounded-[6px] h-8 px-2 text-[0.8125rem] font-inherit max-w-[11rem]',
        'border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] fg-[var(--grid-ink)]',
    ].join(' '),

    /** Library sidebar — workspace-style group-hover doc rows. */
    'oaao-library-doc-row':
        'group flex items-stretch min-w-0 w-full rounded-[6px] overflow-hidden transition-colors hover:bg-[var(--grid-line)]/35 focus-within:bg-[var(--grid-line)]/35',

    'oaao-library-doc-pick':
        'flex flex-1 min-w-0 items-center gap-2 text-left px-2 py-1.5 text-[0.8125rem] fg-[var(--grid-ink)] bg-transparent border-none cursor-pointer font-inherit truncate min-w-0',

    'oaao-library-doc-icon':
        'inline-flex shrink-0 w-4 h-4 items-center justify-center fg-[var(--grid-caption)] transition-colors duration-150 group-hover:fg-[var(--grid-ink)] pointer-events-none',

    'oaao-library-doc-active': 'bg-[var(--grid-line)]/45 fw-semibold',

    /** Library sidebar header buttons ({@code workspace.tpl}). */
    'oaao-library-sidebar-btn-primary': [
        'w-full inline-flex items-center justify-center gap-2 rounded-[10px] h-9 px-3',
        'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] bg-[var(--grid-paper)]',
        'border border-solid border-[var(--grid-line)] cursor-pointer font-inherit',
        'hover:bg-[var(--grid-line)]/25 transition-colors',
    ].join(' '),

    'oaao-library-sidebar-btn-secondary': [
        'w-full inline-flex items-center justify-center gap-2 rounded-[10px] h-9 px-3',
        'text-[0.8125rem] fw-medium fg-[var(--grid-ink-muted)] bg-transparent',
        'border border-solid border-[var(--grid-line)] cursor-pointer font-inherit',
        'hover:bg-[var(--grid-line)]/20 transition-colors',
    ].join(' '),
};

export default oaaoPresets;
