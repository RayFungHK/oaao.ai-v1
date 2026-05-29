/**
 * OAAO shell — JIT component presets (Input / Button hosts via setComponentPreset).
 * Utility-class presets live in {@link ../oaao-jit.js} (JITModule.setPreset).
 *
 * @module preset/shell
 */

const TRANSITION_COLORS = '[transition:background_.15s,color_.15s,border-color_.15s]';

/** @type {Record<string, Record<string, string>>} */
const shellComponentPresets = {
    /** Inline composer body when using {@code <rui-input>} / {@code <rui-textarea>} hosts. */
    'Input.composer': {
        root: 'flex flex-col w-full p-0 m-0 text-[inherit] leading-[inherit] [font-family:inherit]',
        wrapper: [
            'inline-flex items-stretch w-full min-w-0 [box-sizing:border-box]',
            'border-none bg-transparent shadow-none p-0 m-0',
        ].join(' '),
        field: [
            'flex-1 min-w-0 w-full bg-transparent border-none outline-none shadow-none',
            'text-[15px] leading-[24px] fg-[var(--grid-ink)] [font-family:inherit]',
            '[placeholder:var(--grid-caption)] [&::placeholder]:fg-[var(--grid-caption)]',
            'whitespace-pre-wrap break-words min-h-[72px] max-h-[200px]',
        ].join(' '),
    },

    /** Library / dialog secondary actions on {@code <rui-button preset="toolbar">}. */
    'Button.toolbar': {
        root: [
            'inline-flex items-center justify-center shrink-0 font-inherit cursor-pointer',
            '[--btn-h:2.25rem] [--btn-radius:8px] [--btn-px:0.75rem]',
            '[--btn-font-size:0.8125rem] [font-weight:500]',
            '[--btn-bg:var(--grid-paper)] [--btn-border:var(--grid-line)] [--btn-text:var(--grid-ink)]',
            '[--btn-bg-hover:color-mix(in_srgb,var(--grid-line),transparent_75%)]',
            '[--btn-border-hover:var(--grid-line)] [--btn-text-hover:var(--grid-ink)]',
            TRANSITION_COLORS,
        ].join(' '),
    },

    /** Primary sidebar CTA (New document). */
    'Button.library-sidebar-primary': {
        root: [
            'inline-flex items-center justify-center w-full font-inherit cursor-pointer',
            '[--btn-h:2.25rem] [--btn-radius:10px] [--btn-px:0.75rem]',
            '[--btn-font-size:0.8125rem] [font-weight:600]',
            '[--btn-bg:var(--grid-paper)] [--btn-border:var(--grid-line)] [--btn-text:var(--grid-ink)]',
            '[--btn-bg-hover:color-mix(in_srgb,var(--grid-line),transparent_75%)]',
            TRANSITION_COLORS,
        ].join(' '),
    },
};

/**
 * @param {*} razyui RazyUI default export
 */
export async function applyShellComponentPresets(razyui) {
    const JITModule = await razyui.load('JIT');
    JITModule.setComponentPreset(shellComponentPresets);
}

export default applyShellComponentPresets;
