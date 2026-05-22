/**
 * oaao.ai v1 — JIT presets (call JITModule.setPreset before razyui.boot()).
 *
 * Why JIT (post-modularization): per-module / lazy-loaded UI fragments share one document; large
 * hand-written global CSS collides across modules and razit. Scoped utility tokens + hydrate keep
 * ownership local. Prefer RazyUI Components (<rui-*> / Dialog / AjaxForm / …) for behaviour; use JIT
 * for layout tokens and host tweaks — see .cursor/rules/rayfung-razy-stack.mdc.
 *
 * Login inputs: <rui-input preset="login"> — preset in public/js/preset/login.js.
 *
 * Other pages: class on <rui-input>
 *   - oaao-input-form — default-ish in-app form
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
};

export default oaaoPresets;
