/**
 * CS-4-S4…S6 — Thread skill suggestion chip + create dialog.
 *
 * @module conversation-skill-suggest
 */

/** @type {Map<number, Record<string, unknown>>} */
const skillSuggestionByConversation = new Map();

/** @type {Set<number>} */
const skillSuggestionDismissed = new Set();

const SKILL_DISMISS_STORAGE_KEY = 'oaao_skill_suggest_dismiss_v1';

function loadPersistedSkillDismissals() {
    try {
        const raw = localStorage.getItem(SKILL_DISMISS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        for (const id of parsed) {
            const cid = Math.floor(Number(id));
            if (cid > 0) skillSuggestionDismissed.add(cid);
        }
    } catch {
        /* ignore */
    }
}

/**
 * @param {number} conversationId
 */
function persistSkillDismissal(conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid < 1) return;
    skillSuggestionDismissed.add(cid);
    try {
        const ids = [...skillSuggestionDismissed].filter((n) => n > 0).slice(-200);
        localStorage.setItem(SKILL_DISMISS_STORAGE_KEY, JSON.stringify(ids));
    } catch {
        /* ignore */
    }
}

loadPersistedSkillDismissals();

/**
 * @param {number} conversationId
 */
export function dismissSkillSuggestion(conversationId) {
    const cid = Math.floor(Number(conversationId));
    if (cid > 0) persistSkillDismissal(cid);
    skillSuggestionByConversation.delete(cid);
}

/**
 * @param {HTMLElement} mount
 */
export function syncSkillSuggestBannerVisibility(mount) {
    const wrap = mount.querySelector('[data-oaao-chat="composer-refs"]');
    const banner = mount.querySelector('[data-oaao-chat="thread-skill-suggest"]');
    if (!(wrap instanceof HTMLElement) || !(banner instanceof HTMLElement)) return;
    const visible = !banner.classList.contains('hidden');
    if (visible) wrap.classList.remove('hidden');
}

/**
 * @param {(path: string) => string} chatApiUrl
 * @param {() => number|null} getWorkspaceId
 */
/** @type {Promise<typeof import('../../../core/default/webassets/razyui/component/Dialog.js').default>|null} */
let dialogCtorPromise = null;

function skillDialogPrefixed(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    const prefix = (document.body?.dataset?.oaaoMountPrefix || '').trim();
    return prefix ? `${prefix}${p}`.replace(/\/{2,}/g, '/') : p;
}

async function loadDialogCtor() {
    if (!dialogCtorPromise) {
        dialogCtorPromise = import(
            /* webpackIgnore: true */ skillDialogPrefixed('/webassets/core/default/razyui/component/Dialog.js'),
        ).then((m) => m.default);
    }
    return dialogCtorPromise;
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {Record<string, unknown>} payload
 * @param {(path: string) => string} chatApiUrl
 * @param {() => Record<string, unknown>} workspaceBodyFields
 * @param {{ variant?: 'create' | 'upgrade' }} [opts]
 */
export async function renderSkillSuggestBanner(
    mount,
    conversationId,
    payload,
    chatApiUrl,
    workspaceBodyFields,
    opts = {},
) {
    const variant = opts.variant === 'upgrade' ? 'upgrade' : 'create';
    const cid = Math.floor(Number(conversationId));
    if (cid < 1 || skillSuggestionDismissed.has(cid)) return;

    skillSuggestionByConversation.set(cid, payload);

    const banner = mount.querySelector('[data-oaao-chat="thread-skill-suggest"]');
    if (!(banner instanceof HTMLElement)) return;

    banner.classList.remove('hidden');
    banner.replaceChildren();

    const row = document.createElement('div');
    row.className =
        variant === 'upgrade'
            ? 'flex flex-wrap items-center gap-2 w-full min-w-0 rounded-xl border border-solid border-violet-4/40 bg-violet-1/30 px-3 py-2'
            : 'flex flex-wrap items-center gap-2 w-full min-w-0 rounded-xl border border-solid border-amber-4/40 bg-amber-1/30 px-3 py-2';

    const icon = document.createElement('span');
    icon.className =
        variant === 'upgrade'
            ? 'text-[0.75rem] fw-semibold uppercase tracking-wide fg-violet-10 shrink-0'
            : 'text-[0.75rem] fw-semibold uppercase tracking-wide fg-amber-10 shrink-0';
    icon.textContent = variant === 'upgrade' ? 'Upgrade' : 'Skill';

    const label = document.createElement('span');
    label.className = 'flex-1 min-w-0 text-[0.8125rem] fg-[var(--grid-ink)] truncate';
    if (variant === 'upgrade') {
        const usage = payload.usage_count != null ? ` (${payload.usage_count} uses)` : '';
        label.textContent = String(payload.proposed_title || payload.title || `Save skill v2?${usage}`);
    } else {
        label.textContent = String(payload.proposed_title || 'Save as reusable skill?');
    }

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit';
    openBtn.textContent = 'Review';

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className =
        'rounded-[8px] h-8 px-2.5 text-[0.75rem] border-none bg-transparent fg-[var(--grid-caption)] cursor-pointer font-inherit underline';
    dismissBtn.textContent = 'Dismiss';

    openBtn.addEventListener('click', () => {
        void openCreateSkillDialog(mount, cid, payload, chatApiUrl, workspaceBodyFields, variant);
    });
    dismissBtn.addEventListener('click', () => {
        persistSkillDismissal(cid);
        skillSuggestionByConversation.delete(cid);
        banner.classList.add('hidden');
        banner.replaceChildren();
        syncSkillSuggestBannerVisibility(mount);
    });

    row.append(icon, label, openBtn, dismissBtn);
    banner.append(row);
    syncSkillSuggestBannerVisibility(mount);
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {Record<string, unknown>} payload
 * @param {(path: string) => string} chatApiUrl
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
async function openCreateSkillDialog(mount, conversationId, payload, chatApiUrl, workspaceBodyFields, variant = 'create') {
    const Dialog = await loadDialogCtor();
    const body = document.createElement('div');
    body.className = 'flex flex-col gap-3 min-w-0';

    const hint = document.createElement('p');
    hint.className = 'm-0 text-[0.8125rem] fg-[var(--grid-caption)] leading-snug';
    hint.textContent =
        variant === 'upgrade'
            ? 'This skill has been used repeatedly. Save an improved v2 to refine the procedure.'
            : 'Confirm to save this thread pattern as a reusable MicroSkill. You can edit before publishing.';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className =
        'w-full rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 text-[0.875rem] font-inherit';
    titleInput.value = String(
        payload.proposed_title || payload.title || (variant === 'upgrade' ? 'Skill v2' : ''),
    );

    const summaryInput = document.createElement('textarea');
    summaryInput.rows = 3;
    summaryInput.className =
        'w-full rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 text-[0.8125rem] font-inherit resize-y';
    summaryInput.value = String(payload.summary || '');

    const preview = document.createElement('pre');
    preview.className =
        'm-0 max-h-[240px] overflow-auto rounded-[8px] border border-solid border-[var(--grid-line)] bg-[var(--grid-panel)] p-3 text-[0.75rem] whitespace-pre-wrap';
    preview.textContent = String(payload.preview_md || payload.preview_markdown || '');

    body.append(hint, titleInput, summaryInput, preview);

    void new Dialog({
        title: variant === 'upgrade' ? 'Upgrade skill' : 'Create skill',
        content: body,
        size: 'md',
        closable: true,
        buttons: [
            { text: 'Cancel', color: 'muted', role: 'cancel' },
            ...(variant === 'upgrade'
                ? [
                      {
                          text: 'Save as v2',
                          color: 'accent',
                          close: false,
                          action: async (ctrl) => {
                              const res = await fetch(chatApiUrl('skills_save'), {
                                  method: 'POST',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                  body: JSON.stringify({
                                      title: titleInput.value.trim(),
                                      summary: summaryInput.value.trim(),
                                      preview_markdown: preview.textContent,
                                      status: 'published',
                                      kind: 'conversation',
                                      bump_as_version: true,
                                      parent_skill_id:
                                          typeof payload.skill_id === 'string'
                                              ? payload.skill_id
                                              : typeof payload.parent_skill_id === 'string'
                                                ? payload.parent_skill_id
                                                : undefined,
                                      ...workspaceBodyFields(),
                                  }),
                              });
                              const data = await res.json().catch(() => null);
                              if (!res.ok || !data?.success) return;
                              dismissSkillSuggestion(conversationId);
                              const banner = mount.querySelector('[data-oaao-chat="thread-skill-suggest"]');
                              if (banner instanceof HTMLElement) {
                                  banner.classList.add('hidden');
                                  banner.replaceChildren();
                              }
                              syncSkillSuggestBannerVisibility(mount);
                              ctrl.close();
                          },
                      },
                  ]
                : [
                      {
                          text: 'Save skill',
                          color: 'accent',
                          close: false,
                          action: async (ctrl) => {
                              const res = await fetch(chatApiUrl('skills_save'), {
                                  method: 'POST',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                  body: JSON.stringify({
                                      title: titleInput.value.trim(),
                                      summary: summaryInput.value.trim(),
                                      preview_markdown: preview.textContent,
                                      status: 'published',
                                      kind: 'conversation',
                                      conversation_id: conversationId,
                                      ...workspaceBodyFields(),
                                  }),
                              });
                              const data = await res.json().catch(() => null);
                              if (!res.ok || !data?.success) return;
                              dismissSkillSuggestion(conversationId);
                              const banner = mount.querySelector('[data-oaao-chat="thread-skill-suggest"]');
                              if (banner instanceof HTMLElement) {
                                  banner.classList.add('hidden');
                                  banner.replaceChildren();
                              }
                              syncSkillSuggestBannerVisibility(mount);
                              ctrl.close();
                          },
                      },
                      {
                          text: 'Save as v2',
                          color: 'muted',
                          close: false,
                          action: async (ctrl) => {
                              const res = await fetch(chatApiUrl('skills_save'), {
                                  method: 'POST',
                                  credentials: 'include',
                                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                                  body: JSON.stringify({
                                      title: titleInput.value.trim(),
                                      summary: summaryInput.value.trim(),
                                      preview_markdown: preview.textContent,
                                      status: 'published',
                                      kind: 'conversation',
                                      bump_as_version: true,
                                      parent_skill_id:
                                          typeof payload.parent_skill_id === 'string'
                                              ? payload.parent_skill_id
                                              : undefined,
                                      ...workspaceBodyFields(),
                                  }),
                              });
                              const data = await res.json().catch(() => null);
                              if (!res.ok || !data?.success) return;
                              dismissSkillSuggestion(conversationId);
                              ctrl.close();
                          },
                      },
                  ]),
        ],
    });
}

/**
 * @param {HTMLElement} mount
 * @param {number} conversationId
 * @param {Record<string, unknown>} payload
 * @param {(path: string) => string} chatApiUrl
 * @param {() => Record<string, unknown>} workspaceBodyFields
 */
export function handleSkillSuggestedStream(
    mount,
    conversationId,
    payload,
    chatApiUrl,
    workspaceBodyFields,
) {
    void renderSkillSuggestBanner(mount, conversationId, payload, chatApiUrl, workspaceBodyFields, {
        variant: 'create',
    });
}

export function handleSkillUpgradeSuggestedStream(
    mount,
    conversationId,
    payload,
    chatApiUrl,
    workspaceBodyFields,
) {
    void renderSkillSuggestBanner(mount, conversationId, payload, chatApiUrl, workspaceBodyFields, {
        variant: 'upgrade',
    });
}

export default {
    handleSkillSuggestedStream,
    handleSkillUpgradeSuggestedStream,
    renderSkillSuggestBanner,
    dismissSkillSuggestion,
    syncSkillSuggestBannerVisibility,
};
