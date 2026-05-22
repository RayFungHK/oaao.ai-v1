/**
 * Login page — JIT presets for `<rui-input preset="login">`.
 * Host + wrapper + field tokens for `Input.login` preset (`JITModule.setComponentPreset`).
 */
/** Same as `TRANSITION_COLORS` in RazyUI `styleFragments.js`. */
const TRANSITION_COLORS = '[transition:background_.15s,color_.15s]';

/** Host → `PART.ROOT` (`.input-container`). Visual chrome lives on {@code wrapper}. */
const LOGIN_ROOT_JIT =
    'flex flex-col w-full p-0 m-0 text-[inherit] leading-[inherit] [font-family:var(--inp-font-stack)]';

/**
 * Wrapper — bordered “pill” field: radius + border + horizontal padding (via --inp-px).
 * Matches oaao {@code #login-view .input-container} token bridge in {@code oaao.css}.
 */
const LOGIN_WRAPPER_JIT =
    'mt-[var(--inp-label-gap)] first:mt-0 inline-flex items-stretch w-full [box-sizing:border-box] ' +
    'rounded-[var(--inp-radius)] border border-solid [border-color:var(--inp-border)] ' +
    'bg-[var(--inp-bg)] [box-shadow:var(--oaao-surface-shadow)] ' +
    'h-[var(--inp-h)] px-[var(--inp-px)] gap-[var(--inp-gap)] ' +
    TRANSITION_COLORS +
    ' [--inp-h:2.75rem] [--inp-px:0.875rem] [--inp-gap:0.5rem]' +
    ' {is-focused}:border-[var(--inp-focus-border)] {is-focused}:[box-shadow:var(--oaao-surface-focus)]' +
    ' {is-invalid}:border-[var(--inp-error-border)] {is-invalid}:[box-shadow:var(--oaao-surface-error)]' +
    ' {is-disabled}:opacity-50 {is-disabled}:cursor-not-allowed {is-readonly}:bg-[var(--inp-bg-readonly)]';

/** Inner `.input-field` — no second border; wrapper supplies inset via {@code px-[var(--inp-px)]}. */
const LOGIN_FIELD_JIT =
    'flex-1 min-w-0 min-h-0 w-full bg-transparent [border:none] [outline:none] [box-shadow:none] ' +
    'fg-[var(--inp-text)] text-[var(--inp-font-size)] [font-family:inherit] [placeholder:var(--inp-placeholder)] [&::placeholder]:fg-[var(--inp-placeholder)]';

/** @type {Record<string, Record<string, string>>} */
const loginInputPreset = {
    'Input.login': {
        root: LOGIN_ROOT_JIT,
        wrapper: LOGIN_WRAPPER_JIT,
        field: LOGIN_FIELD_JIT,
    },
};

/** @param {*} razyui RazyUI default export (`import razyui from '…/razyui/razyui.js'`) */
export async function applyLoginPreset(razyui) {
    const JITModule = await razyui.load('JIT');
    JITModule.setComponentPreset(loginInputPreset);
}
