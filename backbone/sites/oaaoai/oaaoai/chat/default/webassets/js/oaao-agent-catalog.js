/**
 * Agent kinds for task pipeline UI — aligned with {@link PlannerAgentRegister} / orchestrator registry.
 */

/** @typedef {{ id: string, labelKey: string, descKey: string, fallbackLabel: string, fallbackDesc: string, icon: string, deprecated?: boolean }} OaaoAgentCatalogEntry */

/** @type {ReadonlyArray<OaaoAgentCatalogEntry>} */
const OAAO_TASK_AGENT_CATALOG_FALLBACK = [
    {
        id: 'vault_rag',
        labelKey: 'settings.planner.agent.vault_rag',
        descKey: 'workspace.task.agent_desc.vault_rag',
        fallbackLabel: 'Knowledge base',
        fallbackDesc: 'Retrieve answers from vault sources',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
    },
    {
        id: 'sandbox_code',
        labelKey: 'settings.planner.agent.sandbox_code',
        descKey: 'workspace.task.agent_desc.sandbox_code',
        fallbackLabel: 'Sandbox code',
        fallbackDesc: 'Write and run code in an isolated environment',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    },
    {
        id: 'slide_designer',
        labelKey: 'settings.planner.agent.slide_designer',
        descKey: 'workspace.task.agent_desc.slide_designer',
        fallbackLabel: 'Slide designer',
        fallbackDesc: 'Create and continue slide decks',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4M7 11h10"/></svg>',
    },
    {
        id: 'slides',
        labelKey: 'settings.planner.agent.slides',
        descKey: 'workspace.task.agent_desc.slides',
        fallbackLabel: 'Slides',
        fallbackDesc: 'Generate presentation decks (legacy)',
        deprecated: true,
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4M7 11h10"/></svg>',
    },
    {
        id: 'image_gen',
        labelKey: 'settings.planner.agent.image_gen',
        descKey: 'workspace.task.agent_desc.image_gen',
        fallbackLabel: 'Image generation',
        fallbackDesc: 'Generate images from prompts',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
    },
    {
        id: 'web_search',
        labelKey: 'settings.planner.agent.web_search',
        descKey: 'workspace.task.agent_desc.web_search',
        fallbackLabel: 'Web search',
        fallbackDesc: 'Search the public web for live information',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    },
    {
        id: 'mcp_tool',
        labelKey: 'settings.planner.agent.mcp_tool',
        descKey: 'workspace.task.agent_desc.mcp_tool',
        fallbackLabel: 'MCP integrations',
        fallbackDesc: 'Call connected MCP tools',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M6 12H2"/><path d="M22 12h-4"/><path d="M12 17a5 5 0 0 0 0-10 5 5 0 0 0 0 10Z"/></svg>',
    },
    {
        id: 'calendar_schedule',
        labelKey: 'settings.planner.agent.calendar_schedule',
        descKey: 'workspace.task.agent_desc.calendar_schedule',
        fallbackLabel: 'Calendar',
        fallbackDesc: 'Suggest calendar events from chat',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    },
    {
        id: 'todo_extract',
        labelKey: 'settings.planner.agent.todo_extract',
        descKey: 'workspace.task.agent_desc.todo_extract',
        fallbackLabel: 'Todos',
        fallbackDesc: 'Extract todos from chat',
        icon:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 5 2 2 4-4"/><path d="m3 12 2 2 4-4"/><path d="m3 19 2 2 4-4"/></svg>',
    },
];

const ICON_BY_KIND = Object.fromEntries(OAAO_TASK_AGENT_CATALOG_FALLBACK.map((e) => [e.id, e.icon]));

/**
 * @returns {ReadonlyArray<OaaoAgentCatalogEntry>}
 */
function buildOaaoTaskAgentCatalog() {
    const reg = globalThis.OAAO_PLANNER_AGENT_REGISTRY;
    if (!Array.isArray(reg) || reg.length === 0) {
        return OAAO_TASK_AGENT_CATALOG_FALLBACK;
    }
    /** @type {OaaoAgentCatalogEntry[]} */
    const out = [];
    for (const row of reg) {
        if (!row || typeof row !== 'object') continue;
        const id = String(/** @type {Record<string, unknown>} */ (row).agent_kind ?? '').trim();
        if (!id) continue;
        const fallback = OAAO_TASK_AGENT_CATALOG_FALLBACK.find((e) => e.id === id);
        const labelKey =
            typeof row.i18n_label_key === 'string' && row.i18n_label_key.trim()
                ? row.i18n_label_key.trim()
                : fallback?.labelKey ?? `settings.planner.agent.${id}`;
        const descKey =
            typeof row.i18n_desc_key === 'string' && row.i18n_desc_key.trim()
                ? row.i18n_desc_key.trim()
                : fallback?.descKey ?? `workspace.task.agent_desc.${id}`;
        out.push({
            id,
            labelKey,
            descKey,
            fallbackLabel:
                typeof row.name === 'string' && row.name.trim()
                    ? row.name.trim()
                    : fallback?.fallbackLabel ?? id,
            fallbackDesc:
                typeof row.description === 'string' && row.description.trim()
                    ? row.description.trim()
                    : fallback?.fallbackDesc ?? '',
            icon: fallback?.icon ?? ICON_BY_KIND[id] ?? ICON_BY_KIND.mcp_tool,
            ...(row.deprecated ? { deprecated: true } : {}),
        });
    }
    return out.length ? out : OAAO_TASK_AGENT_CATALOG_FALLBACK;
}

/** @type {ReadonlyArray<OaaoAgentCatalogEntry>} */
export const OAAO_TASK_AGENT_CATALOG = buildOaaoTaskAgentCatalog();

/**
 * @param {string} [kind]
 * @returns {OaaoAgentCatalogEntry | null}
 */
export function getOaaoAgentCatalogEntry(kind) {
    const id = String(kind ?? '').trim();
    if (!id) return null;
    return OAAO_TASK_AGENT_CATALOG.find((e) => e.id === id) ?? null;
}
