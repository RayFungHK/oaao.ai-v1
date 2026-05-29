import razyui from 'razyui';
import { applyLoginPreset } from './preset/login.js';
import { applyShellComponentPresets } from './preset/shell.js';
import oaaoPresets from './oaao-jit.js';
import { initPlatformShell } from './platform-shell.js';
import { initOaaoVersionBadge } from './oaao-version-badge.js';

const isPlatformHostShell = () => document.body?.dataset?.oaaoPlatformHost === '1';

/**
 * Versioned same-origin URL for shell ESM siblings ({@code import.meta.url} query does not bust {@code ./workspace.js}).
 *
 * @param {string} relativePath e.g. {@code ./workspace.js} or {@code ../razyui/component/Input.js}
 */
function shellModuleUrl(relativePath) {
    const meta = new URL(import.meta.url);
    meta.search = '';
    const u = new URL(relativePath, meta);
    const v = (typeof document !== 'undefined' && document.body?.dataset?.oaaoShellEsmV)?.trim() ?? '';
    if (v) u.searchParams.set('v', v);

    return u.href;
}

function dismissOaaoBootOverlay() {
    document.body.classList.add('oaao-shell-ready');
    const root = document.getElementById('workspace-view');
    if (root instanceof HTMLElement) {
        root.hidden = false;
        root.setAttribute('razyui-cloak', 'ready');
        root.querySelectorAll('[razyui-cloak]:not([razyui-cloak="ready"])').forEach((el) => {
            el.setAttribute('razyui-cloak', 'ready');
        });
    }
    document.dispatchEvent(new CustomEvent('oaao:shell-ready'));
}

/** @type {Promise<typeof import('./workspace.js')> | null} */
let workspaceShellModulePromise = null;

function loadWorkspaceShellModule() {
    if (!workspaceShellModulePromise) {
        workspaceShellModulePromise = import(/* webpackIgnore: true */ shellModuleUrl('./workspace.js')).catch((err) => {
            console.error('[oaao] workspace.js load failed — unblocking boot overlay', err);
            workspaceShellModulePromise = null;
            dismissOaaoBootOverlay();

            return {
                initWorkspaceShell: () => {},
                revealAuthenticatedWorkspaceShell: async () => {
                    dismissOaaoBootOverlay();
                },
            };
        });
    }

    return workspaceShellModulePromise;
}

/**
 * Pages registered by backend modules (@see SpaRegister PHP). Empty until modules run __onInit.
 *
 * @type {ReadonlyArray<{ page_id: string, title: string, sub: string, icon: string }>}
 */
function readSpaRegistry() {
    const el = document.getElementById('oaao-spa-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.innerHTML = raw;
            const decoded = ta.value.trim();
            const parsed = JSON.parse(decoded);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
}

globalThis.OAAO_SPA_REGISTRY = Object.freeze(readSpaRegistry());

/**
 * Settings dialog sections (@see SettingsRegister PHP). Consumed by {@code settings-dialog.js}.
 *
 * @type {ReadonlyArray<Record<string, unknown>>}
 */
function readSettingsRegistry() {
    const el = document.getElementById('oaao-settings-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

globalThis.OAAO_SETTINGS_REGISTRY = Object.freeze(readSettingsRegistry());

/**
 * Preferences dialog sections (@see PreferencesRegister PHP). Consumed by {@code preferences-dialog.js}.
 *
 * @type {ReadonlyArray<Record<string, unknown>>}
 */
function readPreferencesRegistry() {
    const el = document.getElementById('oaao-preferences-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

globalThis.OAAO_PREFERENCES_REGISTRY = Object.freeze(readPreferencesRegistry());

/**
 * Feature scope registry (@see FeatureScopeRegister PHP). Declares which isolation levels each feature supports.
 *
 * @type {ReadonlyArray<{ feature_id: string, label: string, description: string, levels: ReadonlyArray<'tenant'|'workspace'|'personal'>, sort: number }>}
 */
function readFeatureScopeRegistry() {
    const el = document.getElementById('oaao-feature-scope-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

globalThis.OAAO_FEATURE_SCOPE_REGISTRY = Object.freeze(readFeatureScopeRegistry());

/**
 * Purpose allocation slots ({@code PurposeAllocationRegister}): registered pipeline groups — seeded from {@code oaaoai/endpoints}, {@code oaaoai/rag}, {@code oaaoai/chat}, …;
 * {@code oaao_purpose} assigns root default LLMs; optional {@code allocation_mode} tags consumers (e.g. Chat owns {@code chat_multi} UX).
 *
 * @type {ReadonlyArray<Record<string, unknown>>}
 */
function readPurposeAllocationRegistry() {
    const el = document.getElementById('oaao-purpose-allocation-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

globalThis.OAAO_PURPOSE_ALLOCATION_REGISTRY = Object.freeze(readPurposeAllocationRegistry());

/**
 * Chat pipeline registry ({@code ChatPipelineRegister}): composer slots, message blocks, step rails — seeded from {@code oaaoai/chat}, {@code oaaoai/rag}, {@code oaaoai/vault}, ….
 *
 * @type {ReadonlyArray<Record<string, unknown>>}
 */
function readChatPipelineRegistry() {
    const el = document.getElementById('oaao-chat-pipeline-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

globalThis.OAAO_CHAT_PIPELINE_REGISTRY = Object.freeze(readChatPipelineRegistry());

/**
 * Planner agent registry ({@code PlannerAgentRegister}): labels + LLM planner hints — seeded from {@code oaaoai/chat}, {@code oaaoai/slide-designer}, ….
 *
 * @type {ReadonlyArray<Record<string, unknown>>}
 */
function readPlannerAgentRegistry() {
    const el = document.getElementById('oaao-planner-agent-registry');
    const raw = el?.textContent?.trim();
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

globalThis.OAAO_PLANNER_AGENT_REGISTRY = Object.freeze(readPlannerAgentRegistry());

(function stripInstallReloadParam() {
    try {
        const u = new URL(window.location.href);
        if (!u.searchParams.has('_oaao_rs')) {
            return;
        }
        u.searchParams.delete('_oaao_rs');
        window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch {
        /* ignore */
    }
})();

/**
 * Path for POST install/save, same-origin as the current page.
 * Server often emits an absolute auth base (e.g. http://localhost/...) while the user may open
 * http://127.0.0.1/… — a full-URL fetch would cross origins and fail silently or as “network error”.
 */
function resolveAuthInstallSaveUrl(authBaseRaw) {
    const base = authBaseRaw.trim().replace(/\/?$/, '/');
    try {
        const resolved = new URL(base, window.location.href);
        const pathname = resolved.pathname.endsWith('/') ? resolved.pathname : `${resolved.pathname}/`;
        return `${pathname}install/save`;
    } catch {
        return '/auth/install/save';
    }
}

/** Same-origin path under auth module base (e.g. `me`, `login`, `logout`). */
function resolveAuthApiPath(authBaseRaw, segment) {
    const seg = String(segment ?? '').replace(/^\/+/, '');
    const base = authBaseRaw.trim().replace(/\/?$/, '/');
    try {
        const resolved = new URL(base, window.location.href);
        const pathname = resolved.pathname.endsWith('/') ? resolved.pathname : `${resolved.pathname}/`;
        return `${pathname}${seg}`;
    } catch {
        return `/auth/${seg}`;
    }
}

function readRuiInputValue(host) {
    if (!host) return '';
    try {
        if (typeof host.value === 'string') return host.value.trim();
    } catch {
        /* ignore */
    }
    const fromShadow = host.shadowRoot?.querySelector?.('input, textarea');
    if (fromShadow) return (fromShadow.value ?? '').trim();
    // RazyUI `<rui-input>` builds the native control in the light DOM (no shadow root).
    const fromLight = host.querySelector?.('input, textarea');
    return (fromLight?.value ?? '').trim();
}

/** @param {Element | RadioNodeList | null | undefined} el */
function firstListedFormControl(el) {
    if (!el) return null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        return el;
    }
    if (typeof el === 'object' && el !== null && 'length' in el && typeof /** @type {{ item?: (i:number)=>Element|null }} */ (el).item === 'function') {
        const list = /** @type {{ length: number; item: (i:number)=>Element|null }} */ (el);
        if (list.length < 1) return null;
        const z = list.item(0);
        return z instanceof HTMLInputElement || z instanceof HTMLTextAreaElement ? z : null;
    }
    return null;
}

/** Last resort: native inputs under the form (RazyUI renders inside `<rui-input>`). */
function fallbackLoginInputsFromForm(form) {
    const inputs = Array.from(form.querySelectorAll('input')).filter(
        (el) =>
            el instanceof HTMLInputElement &&
            !el.disabled &&
            el.type !== 'checkbox' &&
            el.type !== 'hidden' &&
            el.type !== 'radio' &&
            el.type !== 'submit' &&
            el.type !== 'button'
    );
    const passwordEl = inputs.find((el) => el.type === 'password') ?? null;
    const rest = inputs.filter((el) => el !== passwordEl);
    const loginEl = rest[0] ?? null;
    return {
        login_name: loginEl ? loginEl.value.trim() : '',
        password: passwordEl ? passwordEl.value.trim() : '',
    };
}

/** Read login_name / password for `#login-form` (native + RazyUI light DOM). */
function readLoginCredentials(form) {
    let login_name = '';
    let password = '';
    try {
        const fd = new FormData(form);
        login_name = String(fd.get('login_name') ?? '').trim();
        password = String(fd.get('password') ?? '');
    } catch {
        /* ignore */
    }
    if (!login_name || !password) {
        try {
            const ln = firstListedFormControl(form.elements.namedItem('login_name'));
            const pw = firstListedFormControl(form.elements.namedItem('password'));
            if (!login_name && ln) login_name = String(ln.value ?? '').trim();
            if (!password && pw) password = String(pw.value ?? '');
        } catch {
            /* ignore */
        }
    }
    if (!login_name) login_name = readRuiInputValue(document.getElementById('login-email-host'));
    if (!password) password = readRuiInputValue(document.getElementById('login-password-host'));
    if (!login_name || !password) {
        const fb = fallbackLoginInputsFromForm(form);
        if (!login_name) login_name = fb.login_name;
        if (!password) password = fb.password;
    }
    return { login_name, password };
}

async function fetchSessionUser(authBaseRaw) {
    if (!authBaseRaw) return null;
    try {
        const url = resolveAuthApiPath(authBaseRaw, 'me');
        const res = await fetch(url, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.success || !data.data) return null;
        return data.data;
    } catch {
        return null;
    }
}

function applyWorkspaceUi(user) {
    const label = document.getElementById('workspace-user-label');
    const avatar = document.getElementById('workspace-user-avatar');
    const name = user.display_name || user.email || `User #${user.user_id}`;
    if (label) {
        label.textContent = user.role === 'admin' ? `${name} · Administrator` : name;
    }
    if (avatar) {
        const letter = String(name || 'U').trim().slice(0, 1).toUpperCase();
        avatar.textContent = letter || '?';
    }
}

/** Keeps {@code data-oaao-admin-settings} aligned with session user — Ajax login never reloads HTML from PHP. */
function syncOaaoAdminShellFlags(user) {
    const role = user ? String(/** @type {Record<string, unknown>} */ (user).role ?? '').trim().toLowerCase() : '';
    if (isPlatformHostShell()) {
        document.body.dataset.oaaoAdminSettings = role === 'platform_admin' ? '1' : '0';
        return;
    }
    document.body.dataset.oaaoAdminSettings = role === 'admin' ? '1' : '0';
}

/** @type {Record<string, unknown> | null} */
let oaaoSessionUser = null;

function finalizeAuthenticatedSession(user, authBaseRaw) {
    syncOaaoAdminShellFlags(user);
    if (isPlatformHostShell()) {
        initPlatformShell(user, authBaseRaw, razyui);
        return;
    }
    applyWorkspaceUi(user);
    wireWorkspaceLogout(authBaseRaw);
    void loadWorkspaceShellModule().then((m) => m.initWorkspaceShell());
}

function wireWorkspaceLogout(authBaseRaw) {
    const btn = document.getElementById('workspace-logout');
    if (!btn || btn.dataset.oaaoLogoutBound === '1') return;
    btn.dataset.oaaoLogoutBound = '1';
    btn.addEventListener('click', async () => {
        try {
            const url = resolveAuthApiPath(authBaseRaw, 'logout');
            await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: '{}',
            });
        } catch {
            /* ignore */
        }
        oaaoSessionUser = null;
        document.body.dataset.oaaoAdminSettings = '0';
        document.getElementById('workspace-view')?.removeAttribute('data-shell-init');
        const lv = document.getElementById('login-view');
        const wv = document.getElementById('workspace-view');
        if (wv) wv.hidden = true;
        if (lv) lv.hidden = false;
        document.body.classList.remove('oaao-session-active');
        document.getElementById('login-error')?.classList.add('hidden');
    });
}

async function wireLoginForm(authBaseRaw) {
    const form = document.getElementById('login-form');
    const errEl = document.getElementById('login-error');
    if (!form || form.dataset.oaaoLoginBound === '1') return;
    form.dataset.oaaoLoginBound = '1';

    const { default: AjaxForm } = await import(/* webpackIgnore: true */ shellModuleUrl('../razyui/component/AjaxForm.js'));
    const loginUrl = resolveAuthApiPath(authBaseRaw, 'login');

    AjaxForm.wrapAll(form, {
        url: loginUrl,
        method: 'POST',
        mode: 'json',
        headers: { Accept: 'application/json' },
        resetOnSubmit: false,
        async onValidation(_raw, control) {
            let cred = readLoginCredentials(control.form);
            if ((!cred.login_name || !cred.password) && typeof requestAnimationFrame !== 'undefined') {
                await new Promise((resolve) => requestAnimationFrame(resolve));
                cred = readLoginCredentials(control.form);
            }
            if (!cred.login_name || !cred.password) {
                errEl?.classList.remove('hidden');
                if (errEl) errEl.textContent = 'Enter username (or email) and password.';
                return false;
            }
            errEl?.classList.add('hidden');
            return true;
        },
        onSubmit(_raw, control) {
            const cred = readLoginCredentials(control.form);
            const remember_me = document.getElementById('login-remember')?.checked ?? false;
            return {
                login_name: cred.login_name,
                password: cred.password,
                remember_me,
            };
        },
        processor(parsed, res) {
            if (res.ok && parsed && parsed.result === true) {
                this.resolve(parsed, res);
            } else {
                const msg =
                    typeof parsed?.message === 'string'
                        ? parsed.message
                        : `Sign in failed (${res.status}).`;
                this.reject(msg, res);
            }
        },
        onSuccess(parsed) {
            oaaoSessionUser = parsed.data ?? null;
            void (async () => {
                const lv = document.getElementById('login-view');
                const wv = document.getElementById('workspace-view');
                const pv = document.getElementById('platform-view');
                if (lv) lv.hidden = true;
                if (isPlatformHostShell()) {
                    if (pv) pv.hidden = false;
                    if (wv) wv.hidden = true;
                } else {
                    const { revealAuthenticatedWorkspaceShell } = await loadWorkspaceShellModule();
                    await revealAuthenticatedWorkspaceShell();
                    if (pv) pv.hidden = true;
                }
                document.body.classList.add('oaao-session-active');
                if (oaaoSessionUser) finalizeAuthenticatedSession(oaaoSessionUser, authBaseRaw);
            })();
        },
        onError(err) {
            errEl?.classList.remove('hidden');
            if (errEl) {
                errEl.textContent =
                    typeof err === 'string'
                        ? err
                        : err?.message || 'Network error. Try again.';
            }
        },
    });
}

/** First-run SPA: show install vs login and submit superuser setup. */
(function initFirstRunSetup() {
    const authInstalled = document.body?.dataset?.authInstalled === '1';
    const authBaseRaw = (document.body?.dataset?.authBase || '').trim();
    const installView = document.getElementById('install-view');
    const loginView = document.getElementById('login-view');
    if (installView && loginView) {
        installView.hidden = authInstalled;
        loginView.hidden = true;
    }
    if (authInstalled || !authBaseRaw || !installView) {
        return;
    }
    const pgSimple = document.getElementById('setup-pg-simple');
    const pgWrap = document.getElementById('setup-pg-wrap');
    const pgAdvancedBtn = document.getElementById('setup-pg-advanced-toggle');
    pgAdvancedBtn?.addEventListener('click', () => {
        pgSimple?.classList.add('hidden');
        pgWrap?.classList.remove('hidden');
        const input = document.getElementById('setup-pg-url');
        if (!input || input.value.trim() !== '') {
            return;
        }
        const raw = document.getElementById('setup-pg-env-url')?.textContent?.trim() ?? '';
        if (!raw || raw === 'null') {
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'string' && parsed) {
                input.value = parsed;
            }
        } catch {
            /* ignore */
        }
    });
    const form = document.getElementById('setup-form');
    const errEl = document.getElementById('setup-error');
    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        errEl?.classList.add('hidden');
        const login_name = document.getElementById('setup-login-name')?.value?.trim() ?? '';
        const display_name = document.getElementById('setup-display-name')?.value?.trim() ?? '';
        const email = document.getElementById('setup-email')?.value?.trim() ?? '';
        const password = document.getElementById('setup-password')?.value ?? '';
        const pg_url = document.getElementById('setup-pg-url')?.value?.trim() ?? '';
        const pgFromEnv = document.body?.dataset?.authPgEnv === '1';

        if (!pgFromEnv && (!pg_url || !/^postgres(ql)?:\/\//i.test(pg_url))) {
            errEl?.classList.remove('hidden');
            if (errEl) {
                errEl.textContent = 'Enter a PostgreSQL URL or set OAAO_PG_URL on the server.';
            }
            return;
        }

        const btn = document.getElementById('setup-submit');
        if (btn) {
            btn.disabled = true;
        }
        try {
            const url = resolveAuthInstallSaveUrl(authBaseRaw);
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ login_name, display_name, email, password, pg_url }),
            });
            const text = await res.text();
            let data = {};
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                if (errEl) {
                    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 280);
                    errEl.textContent = snippet ? `Unexpected response (${res.status}): ${snippet}` : `Invalid JSON (${res.status}). Expected POST JSON from auth install/save.`;
                    errEl.classList.remove('hidden');
                }
                return;
            }
            if (data.installed && data.result === false && res.ok) {
                if (errEl) {
                    errEl.textContent = data.message ?? 'Reload the page to continue.';
                    errEl.classList.remove('hidden');
                }
                return;
            }
            if (!res.ok || !data.result) {
                if (errEl) {
                    errEl.textContent = data.message || `Setup failed (${res.status}).`;
                    errEl.classList.remove('hidden');
                }
                return;
            }
            // Bypass any cached shell HTML so data-auth-installed reflects the saved config.
            const next = new URL(window.location.href);
            next.searchParams.set('_oaao_rs', String(Date.now()));
            window.location.replace(next);
        } catch {
            errEl?.classList.remove('hidden');
            if (errEl) {
                errEl.textContent = 'Network error. Please try again.';
            }
        } finally {
            if (btn) {
                btn.disabled = false;
            }
        }
    });
})();

/**
 * Input’s barrel runs `JIT.defineComponent` at module load. It must load **after** `razyui.JIT`
 * exists — a top-level `import '../razyui/component/Input.js'` runs too early and skips
 * registration, so presets never apply (short wrapper, default tokens).
 */
const authInstalledEarly = document.body?.dataset?.authInstalled === '1';
const authBaseEarly = (document.body?.dataset?.authBase || '').trim();
if (authInstalledEarly && authBaseEarly) {
    oaaoSessionUser = await fetchSessionUser(authBaseEarly);
}
const loginViewEl = document.getElementById('login-view');
const workspaceViewEl = document.getElementById('workspace-view');
const platformViewEl = document.getElementById('platform-view');
if (isPlatformHostShell()) {
    const loginSub = document.querySelector('#login-view [data-i18n="auth.subtitle"]');
    if (loginSub) {
        loginSub.textContent = 'Sign in with your platform_admin account (not the customer admin on localhost)';
        loginSub.removeAttribute('data-i18n');
    }
}
/**
 * Reveal login/install cloaks only — workspace shell keeps `[razyui-cloak]` until
 * {@see workspace.js revealAuthenticatedWorkspaceShell} finishes JIT hydrate (RazyUI {@code preload()} reveals all cloaks globally).
 */
function revealAuthShellCloak() {
    document.querySelectorAll('#login-view [razyui-cloak], #install-view [razyui-cloak]').forEach((el) => {
        el.setAttribute('razyui-cloak', 'ready');
    });
}

function applySessionShellVisibility() {
    if (!authInstalledEarly || !loginViewEl) return;
    if (oaaoSessionUser) {
        loginViewEl.hidden = true;
        if (isPlatformHostShell() && platformViewEl) {
            platformViewEl.hidden = false;
            if (workspaceViewEl) workspaceViewEl.hidden = true;
        } else if (workspaceViewEl) {
            if (workspaceViewEl.hidden) workspaceViewEl.hidden = false;
            if (platformViewEl) platformViewEl.hidden = true;
        }
        document.body.classList.add('oaao-session-active');
    } else {
        loginViewEl.hidden = false;
        if (workspaceViewEl) workspaceViewEl.hidden = true;
        if (platformViewEl) platformViewEl.hidden = true;
        document.body.classList.remove('oaao-session-active');
    }
}

try {
    await applyLoginPreset(razyui);
    await applyShellComponentPresets(razyui);

    const JITModule = await razyui.load('JIT');
    globalThis.JIT = JITModule;
    JITModule.setPreset(oaaoPresets);

    await razyui.boot();

    await razyui.load('Input');
    const { registerElement } = await import(/* webpackIgnore: true */ shellModuleUrl('../razyui/component/Input.js'));
    await registerElement();

    revealAuthShellCloak();
} catch (err) {
    console.error('[oaao] RazyUI shell boot failed — login fields may look empty until fixed.', err);
    revealAuthShellCloak();
}

if (oaaoSessionUser && !isPlatformHostShell()) {
    const { revealAuthenticatedWorkspaceShell } = await loadWorkspaceShellModule();
    await revealAuthenticatedWorkspaceShell();
}

applySessionShellVisibility();
initOaaoVersionBadge();

if (authInstalledEarly && authBaseEarly) {
    if (oaaoSessionUser) {
        finalizeAuthenticatedSession(oaaoSessionUser, authBaseEarly);
    } else {
        await wireLoginForm(authBaseEarly);
    }
}
