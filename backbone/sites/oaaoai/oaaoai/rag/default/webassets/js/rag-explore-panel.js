/**
 * RAG Explore — hybrid vector search + Cytoscape.js graph visualization.
 *
 * @module rag-explore-panel
 */

import { oaaoT } from '@oaao/core-js/oaao-i18n.js';
import {
    jitApply,
    OAAO_COMBOBOX_CONTAINER_JIT,
    OAAO_FIELD_DROPDOWN_JIT,
    OAAO_FIELD_INPUT_JIT,
} from '@oaao/core-js/oaao-jit-dsl.js';

/** @type {Promise<{ default?: unknown, registerElement?: () => Promise<void> }> | null} */
let comboboxModulePromise = null;
/** @type {boolean} */
let comboboxCustomElementRegistered = false;

/** @returns {Promise<((sel: HTMLSelectElement, opts?: Record<string, unknown>) => unknown) | null>} */
async function loadComboboxCtor() {
    try {
        if (!comboboxModulePromise) {
            const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
            const prefix =
                rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
            let path = '/webassets/core/default/razyui/component/Combobox.js';
            if (prefix) {
                path = `${prefix.replace(/\/+$/, '')}${path}`.replace(/\/{2,}/g, '/');
            }
            const shellV = document.body?.dataset?.oaaoShellEsmV?.trim() ?? '';
            if (shellV) path += `${path.includes('?') ? '&' : '?'}v=${encodeURIComponent(shellV)}`;
            comboboxModulePromise = import(/* webpackIgnore: true */ path);
        }
        const mod = await comboboxModulePromise;
        if (!comboboxCustomElementRegistered && typeof mod.registerElement === 'function') {
            await mod.registerElement();
            comboboxCustomElementRegistered = true;
        }
        return typeof mod.default === 'function' ? mod.default : null;
    } catch (err) {
        console.error('[rag-explore] Combobox load failed', err);
        return null;
    }
}

function hydrateRagExploreJit(root) {
    const JIT = /** @type {{ hydrate?: (el: Element) => void } | undefined} */ (globalThis.JIT);
    if (JIT && typeof JIT.hydrate === 'function') JIT.hydrate(root);
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @returns {string[]}
 */
function readVaultIdsFromComboboxDom(wrap, sel) {
    /** @type {string[]} */
    const ids = [];
    if (!(wrap instanceof HTMLElement)) return ids;

    for (const item of wrap.querySelectorAll('.combobox-item.has-checkbox')) {
        const tick = item.querySelector('.combobox-checkbox.is-checked');
        if (!tick) continue;
        const v = String(item.getAttribute('data-value') ?? item.dataset.value ?? '').trim();
        if (v) ids.push(v);
    }

    if (!ids.length) {
        for (const item of wrap.querySelectorAll('.combobox-item.is-selected')) {
            const v = String(item.getAttribute('data-value') ?? item.dataset.value ?? '').trim();
            if (v) ids.push(v);
        }
    }

    if (!ids.length) {
        const label = wrap.querySelector('.combobox-label:not(.is-placeholder)');
        const text = label?.textContent?.trim() ?? '';
        if (text) {
            const parts = text
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean);
            const tokens = parts.length ? parts : [text];
            for (const token of tokens) {
                for (let i = 0; i < sel.options.length; i++) {
                    const opt = sel.options[i];
                    const name = String(opt.textContent ?? '').trim();
                    if (!name) continue;
                    if (name === token || token.includes(name) || name.includes(token)) {
                        ids.push(String(opt.value).trim());
                    }
                }
            }
        }
    }

    return [...new Set(ids.filter(Boolean))];
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @param {{ getChecked?: () => Record<string, boolean> | null, getValue?: () => unknown, getControl?: () => { value?: unknown } } | null} [inst]
 * @returns {string[]}
 */
function syncVaultPickerSelection(wrap, sel, inst) {
    /** @type {string[]} */
    let ids = readVaultIdsFromComboboxDom(wrap, sel);

    const cb = inst ?? (wrap instanceof HTMLElement ? wrap._oaaoCombobox ?? null : null);
    if (!ids.length && cb && typeof cb.getChecked === 'function') {
        const checked = cb.getChecked();
        if (checked && typeof checked === 'object') {
            ids = Object.keys(checked)
                .filter((k) => checked[k])
                .map((v) => String(v).trim())
                .filter(Boolean);
        }
    }
    if (!ids.length && cb && typeof cb.getControl === 'function') {
        const ctrl = cb.getControl();
        const raw = ctrl?.value;
        const arr = Array.isArray(raw) ? raw : raw != null && String(raw).trim() !== '' ? [raw] : [];
        ids = arr.map((v) => String(v).trim()).filter(Boolean);
    }
    if (!ids.length && cb && typeof cb.getValue === 'function') {
        const raw = cb.getValue();
        const arr = Array.isArray(raw) ? raw : raw != null && String(raw).trim() !== '' ? [raw] : [];
        ids = arr.map((v) => String(v).trim()).filter(Boolean);
    }
    if (!ids.length) {
        ids = readSelectedVaultIdsFromSelect(sel);
    }

    ids = [...new Set(ids.filter(Boolean))];
    for (let i = 0; i < sel.options.length; i++) {
        sel.options[i].selected = ids.includes(sel.options[i].value);
    }
    if (wrap instanceof HTMLElement) {
        wrap.dataset.oaaoRagVaultIds = ids.join(',');
    }
    sel.dataset.default = ids.join(',');
    return ids;
}

/**
 * @param {HTMLElement} wrap
 */
function applyVaultComboboxChrome(wrap) {
    if (!(wrap instanceof HTMLElement)) return;
    const box = wrap.querySelector('.combobox-container');
    if (box instanceof HTMLElement) {
        jitApply(box, OAAO_COMBOBOX_CONTAINER_JIT);
    }
    const floating = wrap.querySelector('.combobox-floating');
    if (floating instanceof HTMLElement) {
        jitApply(floating, OAAO_FIELD_DROPDOWN_JIT);
    }
    hydrateRagExploreJit(wrap);
}

/**
 * @param {HTMLSelectElement} sel
 * @returns {string[]}
 */
function readSelectedVaultIdsFromSelect(sel) {
    if (!(sel instanceof HTMLSelectElement)) return [];
    if (sel.multiple) {
        const fromDom = Array.from(sel.selectedOptions)
            .map((o) => String(o.value).trim())
            .filter(Boolean);
        if (fromDom.length) return fromDom;
    } else {
        const v = String(sel.value || '').trim();
        if (v) return [v];
    }
    return String(sel.dataset.default ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @returns {number[]}
 */
function readSelectedVaultIds(wrap, sel) {
    /** @type {{ getChecked?: () => Record<string, boolean> | null, getValue?: () => unknown, getControl?: () => { value?: unknown } } | null} */
    const inst = wrap instanceof HTMLElement ? wrap._oaaoCombobox ?? null : null;
    const synced = syncVaultPickerSelection(/** @type {HTMLElement} */ (wrap), sel, inst);
    return synced.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 */
function wireVaultPickerLiveSync(wrap, sel) {
    if (!(wrap instanceof HTMLElement) || wrap.dataset.oaaoRagVaultSyncBound === '1') return;
    wrap.dataset.oaaoRagVaultSyncBound = '1';
    wrap._oaaoRagVaultSel = sel;

    const resync = () => {
        syncVaultPickerSelection(wrap, sel, wrap._oaaoCombobox ?? null);
    };

    wrap.addEventListener(
        'click',
        () => {
            requestAnimationFrame(resync);
        },
        true,
    );
    wrap.addEventListener('change', resync, true);
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 * @returns {Promise<unknown | null>}
 */
async function mountVaultCombobox(wrap, sel) {
    if (!(wrap instanceof HTMLElement) || !(sel instanceof HTMLSelectElement) || !sel.multiple) return null;
    if (wrap.dataset.oaaoComboboxMounted === '1') return wrap._oaaoCombobox ?? null;

    const initial = readSelectedVaultIdsFromSelect(sel);
    sel.dataset.default = initial.join(',');

    const ComboboxCls = await loadComboboxCtor();
    if (typeof ComboboxCls !== 'function') return null;

    try {
        /** @type {{ setValue?: (v: string|string[]) => void, setChecked?: (m: Record<string, boolean>) => void } | null} */
        const instance = new ComboboxCls(sel, {
            placeholder: oaaoT('rag.explore.vault_ph', 'Select vaults…'),
            checkbox: true,
            onCheckboxChange: (_value, _checked, allChecked) => {
                if (allChecked && typeof allChecked === 'object') {
                    syncVaultPickerSelection(
                        wrap,
                        sel,
                        /** @type {{ getChecked?: () => Record<string, boolean> }} */ ({
                            getChecked: () => allChecked,
                        }),
                    );
                }
            },
            onSelect: () => {
                syncVaultPickerSelection(wrap, sel, wrap._oaaoCombobox ?? null);
            },
        });
        wrap.dataset.oaaoComboboxMounted = '1';
        wrap._oaaoCombobox = instance;
        wireVaultPickerLiveSync(wrap, sel);

        for (let i = 0; i < sel.options.length; i++) {
            sel.options[i].selected = initial.includes(sel.options[i].value);
        }
        if (instance && typeof instance.setValue === 'function') {
            instance.setValue(initial);
        }
        if (instance && typeof instance.setChecked === 'function') {
            /** @type {Record<string, boolean>} */
            const checked = {};
            for (let i = 0; i < sel.options.length; i++) {
                const v = sel.options[i].value;
                checked[v] = initial.includes(v);
            }
            instance.setChecked(checked);
        }
        syncVaultPickerSelection(wrap, sel, instance);
        applyVaultComboboxChrome(wrap);
        return instance ?? null;
    } catch (err) {
        console.warn('[rag-explore] Combobox init failed', err);
        return null;
    }
}

/** @type {import('cytoscape') | null} */
let cytoscapeMod = null;
/** @type {boolean} */
let cytoscapeBilkentReady = false;

async function loadCytoscape() {
    if (cytoscapeMod) return cytoscapeMod;
    const mod = await import('https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/+esm');
    cytoscapeMod = mod.default;
    if (!cytoscapeBilkentReady) {
        try {
            const bilkent = await import(
                'https://esm.sh/cytoscape-cose-bilkent@4.1.0?external=cytoscape'
            );
            const reg = bilkent.default ?? bilkent;
            cytoscapeMod.use(reg);
            cytoscapeBilkentReady = true;
        } catch (err) {
            console.warn('[rag-explore] cose-bilkent unavailable — using built-in cose', err);
        }
    }
    return cytoscapeMod;
}

/**
 * @param {HTMLElement} host
 */
async function ensureGraphHostReady(host) {
    for (let i = 0; i < 16; i++) {
        if (host.clientWidth >= 64 && host.clientHeight >= 64) return;
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
}

/**
 * @param {HTMLElement} host
 * @returns {{ width: number, height: number, aspect: number, landscape: boolean }}
 */
function measureGraphHost(host) {
    const width = Math.max(host.clientWidth, 280);
    const height = Math.max(host.clientHeight, 220);
    const aspect = width / height;
    return { width, height, aspect, landscape: aspect > 1.12 };
}

/**
 * Seed positions on an ellipse matching the container aspect (wide box → horizontal spread).
 *
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 */
function scatterGraphNodesForHost(cyInst, host) {
    const collection = cyInst.nodes();
    const n = collection.length;
    if (n < 1) return;
    const { width: w, height: h, aspect, landscape } = measureGraphHost(host);
    const cx = w / 2;
    const cy0 = h / 2;
    const rx = landscape ? w * 0.42 : w * 0.34;
    const ry = landscape ? h * 0.36 : h * 0.4;
    collection.forEach((node, i) => {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const jitter = (Math.random() - 0.5) * (landscape ? 14 : 10);
        node.position({
            x: cx + rx * Math.cos(a) + jitter,
            y: cy0 + (ry / Math.max(aspect, 0.65)) * Math.sin(a) + jitter * 0.6,
        });
    });
}

/**
 * Gently stretch the laid-out graph toward the container aspect (landscape panels stay wide).
 *
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 */
function normalizeGraphLayoutAspect(cyInst, host) {
    const nodes = cyInst.nodes();
    if (nodes.length < 2) return;
    const { aspect: hostAspect, landscape } = measureGraphHost(host);
    const bb = cyInst.elements().boundingBox();
    if (bb.w < 12 || bb.h < 12) return;
    const graphAspect = bb.w / bb.h;
    const targetAspect = Math.max(0.6, Math.min(2.8, hostAspect));

    let scaleX = 1;
    let scaleY = 1;
    if (landscape && graphAspect < targetAspect * 0.7) {
        const factor = Math.min(2.5, Math.sqrt(targetAspect / Math.max(graphAspect, 0.15)));
        scaleX = factor;
        scaleY = 1 / Math.sqrt(factor);
    } else if (!landscape && hostAspect < 0.88 && graphAspect > targetAspect * 1.4) {
        const factor = Math.min(2.5, Math.sqrt(graphAspect / Math.max(targetAspect, 0.15)));
        scaleY = factor;
        scaleX = 1 / Math.sqrt(factor);
    } else {
        return;
    }

    const cx = bb.x1 + bb.w / 2;
    const cy = bb.y1 + bb.h / 2;
    nodes.positions((node) => {
        const p = node.position();
        return {
            x: cx + (p.x - cx) * scaleX,
            y: cy + (p.y - cy) * scaleY,
        };
    });
}

/**
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 * @param {number} [padding]
 */
function fitGraphToHost(cyInst, host, padding = 52) {
    cyInst.resize();
    cyInst.fit(cyInst.elements(), padding);
}

/** @type {WeakMap<import('cytoscape').Core, Map<string, { x: number, y: number }>>} */
const graphLayoutBasePositions = new WeakMap();

/**
 * @param {import('cytoscape').Core} cyInst
 */
function captureGraphLayoutBase(cyInst) {
    /** @type {Map<string, { x: number, y: number }>} */
    const map = new Map();
    cyInst.nodes().forEach((node) => {
        const p = node.position();
        map.set(node.id(), { x: p.x, y: p.y });
    });
    graphLayoutBasePositions.set(cyInst, map);
}

/**
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 * @param {number} [padding]
 */
function finalizeGraphLayoutForHost(cyInst, host, padding = 52) {
    captureGraphLayoutBase(cyInst);
    normalizeGraphLayoutAspect(cyInst, host);
    fitGraphToHost(cyInst, host, padding);
}

/**
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 * @param {number} [padding]
 */
function refitGraphToHost(cyInst, host, padding = 52) {
    const base = graphLayoutBasePositions.get(cyInst);
    if (base) {
        cyInst.nodes().forEach((node) => {
            const p = base.get(node.id());
            if (p) node.position(p);
        });
        normalizeGraphLayoutAspect(cyInst, host);
    }
    fitGraphToHost(cyInst, host, padding);
}

/** @param {string} pathOnly */
function oaaoPrefixedSitePath(pathOnly) {
    const raw = (typeof document !== 'undefined' && document.body?.dataset?.oaaoMountPrefix)?.trim() ?? '';
    const path = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
    if (!raw || raw === '/') return path;
    const prefix = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/{2,}/g, '/').replace(/\/$/, '');
    if (!prefix) return path;
    if (path === prefix || path.startsWith(`${prefix}/`)) return path;

    return `${prefix}${path}`;
}

/** @type {Promise<Record<string, unknown>> | null} */
let ragExploreMdPromise = null;
/** @type {Record<string, Function> | null} */
let ragExploreMd = null;

const RAG_EXPLORE_MD_OPTS = { preset: 'oaao-chat' };

function loadRagExploreMarkdownHelpers() {
    if (!ragExploreMdPromise) {
        const url = oaaoPrefixedSitePath('/webassets/core/default/razyui/component/MarkdownHelpers.js');
        ragExploreMdPromise = import(/* webpackIgnore: true */ url).then((mod) => {
            ragExploreMd = /** @type {Record<string, Function>} */ (mod);
            return mod;
        });
    }
    return ragExploreMdPromise;
}

/** @param {string} md */
function ragExploreMarkdownToHtml(md) {
    if (!ragExploreMd || typeof ragExploreMd.parseSafe !== 'function') return '';
    return String(ragExploreMd.parseSafe(md, RAG_EXPLORE_MD_OPTS));
}

/**
 * @param {HTMLElement} out
 * @param {string} markdown
 */
function renderSummaryPlainFallback(out, markdown) {
    out.classList.remove('oaao-md-bubble', 'fg-[var(--grid-caption)]', 'italic');
    out.innerHTML = '';
    out.textContent = markdown;
    out.style.whiteSpace = 'pre-wrap';
}

/**
 * @param {HTMLElement} out
 * @param {{ markdown?: string, placeholder?: string, error?: string, plain?: string }} opts
 */
function renderRagExploreSummary(out, opts) {
    const markdown = String(opts.markdown ?? '').trim();
    const placeholder = String(opts.placeholder ?? '').trim();
    const error = String(opts.error ?? '').trim();
    const plain = String(opts.plain ?? '').trim();

    out.classList.remove('oaao-md-bubble', 'fg-[var(--grid-caption)]', 'italic');
    out.style.whiteSpace = '';

    if (plain) {
        renderSummaryPlainFallback(out, plain);
        return;
    }

    if (error) {
        out.textContent = error;
        out.classList.add('fg-[var(--grid-caption)]');
        return;
    }

    if (!markdown) {
        out.innerHTML = '';
        out.textContent = placeholder;
        if (placeholder) out.classList.add('fg-[var(--grid-caption)]', 'italic');
        return;
    }

    void loadRagExploreMarkdownHelpers()
        .then(() => {
            let html = '';
            try {
                html = ragExploreMarkdownToHtml(markdown);
            } catch (err) {
                console.warn('[rag-explore] summary markdown parse failed', err);
                renderSummaryPlainFallback(out, markdown);
                return;
            }
            if (!html.trim()) {
                renderSummaryPlainFallback(out, markdown);
                return;
            }
            out.classList.add('oaao-md-bubble');
            out.style.whiteSpace = '';
            out.innerHTML = html;
            if (ragExploreMd && typeof ragExploreMd.renderMathInElement === 'function') {
                void ragExploreMd.renderMathInElement(out).catch((err) => {
                    console.warn('[rag-explore] summary math render failed', err);
                });
            }
        })
        .catch((err) => {
            console.warn('[rag-explore] summary markdown helpers failed', err);
            renderSummaryPlainFallback(out, markdown);
        });
}

/** @param {string} type */
function graphTypeStyle(type) {
    const t = String(type ?? 'concept').toLowerCase();
    if (t.includes('chunk')) return { color: '#ec4899', size: 30 };
    if (t.includes('document')) return { color: '#60a5fa', size: 24 };
    if (t.includes('person')) return { color: '#34d399', size: 18 };
    if (t.includes('org')) return { color: '#a78bfa', size: 18 };
    if (t.includes('location') || t.includes('place')) return { color: '#fb923c', size: 17 };
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    const palette = ['#f59e0b', '#14b8a6', '#6366f1', '#84cc16', '#e879f9', '#22d3ee'];
    return { color: palette[h % palette.length], size: 16 };
}

function ragApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
    return `${prefix}/rag/api/${String(action).replace(/^\/+/, '')}`;
}

function vaultApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
    return `${prefix}/vault/api/${String(action).replace(/^\/+/, '')}`;
}

function gridToken(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

/** @param {string} text @param {number} max */
function truncateGraphLabel(text, max = 30) {
    const t = String(text ?? '').trim();
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(4, max - 1))}…`;
}

/**
 * Normalize orchestrator Cytoscape elements — short visible labels, full text for tooltip.
 *
 * @param {unknown[]} rawNodes
 * @param {unknown[]} rawEdges
 */
function prepareGraphElements(rawNodes, rawEdges) {
    /** @type {import('cytoscape').ElementDefinition[]} */
    const nodes = [];
    /** @type {Set<string>} */
    const nodeIds = new Set();

    for (const el of rawNodes) {
        if (!el || typeof el !== 'object') continue;
        const wrap = /** @type {{ data?: Record<string, unknown> } & Record<string, unknown>} */ (el);
        const data = wrap.data && typeof wrap.data === 'object' ? wrap.data : wrap;
        const full = String(data.label ?? data.name ?? data.id ?? '').trim();
        const id = String(data.id ?? '').trim();
        if (!full || !id) continue;
        nodeIds.add(id);
        nodes.push({
            data: {
                ...data,
                id,
                label: truncateGraphLabel(full, 28),
                fullLabel: full,
                type: String(data.type ?? 'concept'),
            },
        });
    }

    /** @type {import('cytoscape').ElementDefinition[]} */
    const edges = [];
    for (const el of rawEdges) {
        if (!el || typeof el !== 'object') continue;
        const wrap = /** @type {{ data?: Record<string, unknown> } & Record<string, unknown>} */ (el);
        const data = wrap.data && typeof wrap.data === 'object' ? wrap.data : wrap;
        const src = String(data.source ?? '').trim();
        const tgt = String(data.target ?? '').trim();
        const id = String(data.id ?? `${src}->${tgt}`).trim();
        if (!src || !tgt || !nodeIds.has(src) || !nodeIds.has(tgt)) continue;
        edges.push({
            data: {
                id,
                source: src,
                target: tgt,
                label: truncateGraphLabel(String(data.label ?? 'related'), 18),
            },
        });
    }

    return { nodes, edges };
}

/**
 * Client-side safety net — keep the largest connected cluster (matches orchestrator prune).
 *
 * @param {import('cytoscape').ElementDefinition[]} nodes
 * @param {import('cytoscape').ElementDefinition[]} edges
 * @param {number} maxIsolated
 */
function retainLargestGraphComponent(nodes, edges, maxIsolated = 10) {
    const dropped = { before: nodes.length, after: nodes.length, isolated: 0 };
    if (!nodes.length) return { nodes, edges, dropped };

    if (!edges.length) {
        const kept = nodes.slice(0, maxIsolated);
        dropped.after = kept.length;
        dropped.isolated = Math.max(0, nodes.length - kept.length);
        return { nodes: kept, edges: [], dropped };
    }

    /** @type {Map<string, Set<string>>} */
    const adj = new Map();
    for (const el of edges) {
        const src = String(el.data?.source ?? '');
        const tgt = String(el.data?.target ?? '');
        if (!src || !tgt) continue;
        if (!adj.has(src)) adj.set(src, new Set());
        if (!adj.has(tgt)) adj.set(tgt, new Set());
        adj.get(src).add(tgt);
        adj.get(tgt).add(src);
    }

    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {Set<string>[]} */
    const components = [];
    for (const start of adj.keys()) {
        if (seen.has(start)) continue;
        /** @type {Set<string>} */
        const comp = new Set();
        /** @type {string[]} */
        const stack = [start];
        while (stack.length) {
            const cur = stack.pop();
            if (!cur || seen.has(cur)) continue;
            seen.add(cur);
            comp.add(cur);
            for (const nxt of adj.get(cur) ?? []) {
                if (!seen.has(nxt)) stack.push(nxt);
            }
        }
        if (comp.size) components.push(comp);
    }

    if (!components.length) {
        const kept = nodes.slice(0, maxIsolated);
        dropped.after = kept.length;
        dropped.isolated = Math.max(0, nodes.length - kept.length);
        return { nodes: kept, edges: [], dropped };
    }

    components.sort((a, b) => {
        let ea = 0;
        let eb = 0;
        for (const el of edges) {
            const s = String(el.data?.source ?? '');
            const t = String(el.data?.target ?? '');
            if (a.has(s) && a.has(t)) ea += 1;
            if (b.has(s) && b.has(t)) eb += 1;
        }
        return eb - ea || b.size - a.size;
    });

    const keep = components[0];
    const keptNodes = nodes.filter((n) => keep.has(String(n.data?.id ?? '')));
    const keptEdges = edges.filter((e) => {
        const s = String(e.data?.source ?? '');
        const t = String(e.data?.target ?? '');
        return keep.has(s) && keep.has(t);
    });
    dropped.after = keptNodes.length;
    dropped.isolated = Math.max(0, nodes.length - keptNodes.length);
    return { nodes: keptNodes, edges: keptEdges, dropped };
}

/**
 * @param {import('cytoscape').ElementDefinition[]} nodes
 * @param {import('cytoscape').ElementDefinition[]} edges
 */
function enrichGraphNodes(nodes, edges) {
    /** @type {Map<string, number>} */
    const degreeMap = new Map();
    for (const el of edges) {
        const src = String(el.data?.source ?? '');
        const tgt = String(el.data?.target ?? '');
        if (src) degreeMap.set(src, (degreeMap.get(src) ?? 0) + 1);
        if (tgt) degreeMap.set(tgt, (degreeMap.get(tgt) ?? 0) + 1);
    }
    for (const node of nodes) {
        const id = String(node.data?.id ?? '');
        const deg = degreeMap.get(id) ?? 0;
        const sty = graphTypeStyle(String(node.data?.type ?? 'concept'));
        node.data = {
            ...node.data,
            degree: deg,
            nodeColor: sty.color,
            nodeSize: sty.size + Math.min(deg * 4, 16),
        };
    }
}

/**
 * @param {number} nodeCount
 * @param {number} edgeCount
 * @param {boolean} bilkentAvailable
 * @param {HTMLElement} host
 * @returns {import('cytoscape').LayoutOptions}
 */
function pickGraphLayout(nodeCount, edgeCount, bilkentAvailable, host) {
    const { width, height, aspect, landscape } = measureGraphHost(host);
    const pad = 48;
    const idealEdgeLength = landscape ? Math.round(90 + Math.min(aspect, 2.4) * 22) : 95;
    const gravity = landscape ? 0.14 : 0.28;
    const bbox = { x1: 0, y1: 0, w: width, h: height };

    if (edgeCount > 0 && bilkentAvailable) {
        return {
            name: 'cose-bilkent',
            animate: false,
            randomize: false,
            fit: true,
            padding: pad,
            boundingBox: bbox,
            nodeDimensionsIncludeLabels: false,
            idealEdgeLength,
            edgeElasticity: landscape ? 0.5 : 0.45,
            nestingFactor: 0.12,
            gravity,
            numIter: landscape ? 3000 : 2600,
            tile: false,
            tilingPaddingVertical: 18,
            tilingPaddingHorizontal: landscape ? 28 : 18,
        };
    }
    if (edgeCount > 0) {
        const sparse = edgeCount < nodeCount * 0.45;
        return {
            name: 'cose',
            animate: false,
            padding: pad,
            fit: true,
            boundingBox: bbox,
            randomize: false,
            nodeDimensionsIncludeLabels: false,
            nodeRepulsion: sparse ? (landscape ? 42000 : 36000) : landscape ? 28000 : 24000,
            idealEdgeLength: sparse ? (landscape ? 140 : 120) : idealEdgeLength,
            edgeElasticity: 0.55,
            nodeOverlap: sparse ? 52 : 36,
            componentSpacing: landscape ? 260 : sparse ? 220 : 150,
            gravity: sparse ? (landscape ? 0.08 : 0.1) : gravity,
            numIter: sparse ? 2600 : 1800,
            initialTemp: 280,
            coolingFactor: 0.95,
            minTemp: 1,
        };
    }
    return {
        name: 'circle',
        animate: false,
        fit: true,
        padding: pad,
        boundingBox: bbox,
        spacingFactor: landscape ? 2.15 : 1.85,
        avoidOverlap: true,
    };
}

/**
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 * @param {number} nodeCount
 * @param {number} edgeCount
 */
function runGraphLayout(cyInst, host, nodeCount, edgeCount) {
    scatterGraphNodesForHost(cyInst, host);
    const opts = pickGraphLayout(nodeCount, edgeCount, cytoscapeBilkentReady, host);
    cyInst.layout({ ...opts }).run();
}

/**
 * Hover / select reveals labels; tooltip shows full text.
 *
 * @param {import('cytoscape').Core} cyInst
 * @param {HTMLElement} host
 */
function attachGraphInteractions(cyInst, host) {
    /** @type {import('cytoscape').NodeSingular | null} */
    let hovered = null;

    cyInst.on('mouseover', 'node', (ev) => {
        const node = ev.target;
        hovered?.removeClass('graph-node-hover');
        hovered = node;
        node.addClass('graph-node-hover');
        const full = String(node.data('fullLabel') ?? node.data('label') ?? '');
        host.title = full;
    });
    cyInst.on('mouseout', 'node', (ev) => {
        ev.target.removeClass('graph-node-hover');
        if (hovered === ev.target) hovered = null;
        host.title = '';
    });
    cyInst.on('tap', 'node', (ev) => {
        cyInst.elements().unselect();
        cyInst.edges().removeClass('graph-edge-focus');
        ev.target.select();
        ev.target.connectedEdges().addClass('graph-edge-focus');
    });
    cyInst.on('tap', (ev) => {
        if (ev.target === cyInst) {
            cyInst.elements().unselect();
            cyInst.edges().removeClass('graph-edge-focus');
        }
    });
}

/**
 * Show workspace shell sidebar for RAG Explore (defensive — also used when {@code workspace.js} sync lags).
 *
 * @returns {HTMLElement | null}
 */
function activateRagExploreWorkspaceSidebar() {
    document.getElementById('workspace-chat-sidebar-section')?.classList.add('hidden');
    document.getElementById('workspace-vault-sidebar-section')?.classList.add('hidden');
    const section = document.getElementById('workspace-rag-explore-sidebar-section');
    section?.classList.remove('hidden');
    const root = document.getElementById('workspace-rag-explore-sidebar-root');
    if (root instanceof HTMLElement) {
        root.classList.add('overflow-y-auto', 'overscroll-contain', '[-webkit-overflow-scrolling:touch]');
    }
    const view = document.getElementById('workspace-view');
    view?.classList.add('oaao-workspace-layout--split');
    view?.classList.remove('oaao-workspace-layout--gallery', 'oaao-workspace-layout--rail-only');
    if (typeof globalThis.__oaaoSyncWorkspaceModuleSidebar === 'function') {
        globalThis.__oaaoSyncWorkspaceModuleSidebar('workspace/rag-explore');
    }
    if (typeof globalThis.__oaaoSyncWorkspaceShellLayout === 'function') {
        globalThis.__oaaoSyncWorkspaceShellLayout('workspace/rag-explore');
    }
    return root instanceof HTMLElement ? root : null;
}

/**
 * @param {string} key
 * @param {string} fallback
 * @returns {HTMLElement}
 */
function sidebarFieldLabel(key, fallback) {
    const el = document.createElement('label');
    el.className =
        'block text-[0.6875rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)] mb-1';
    el.textContent = oaaoT(key, fallback);
    return el;
}

const RAG_STATE_CARD =
    'rounded-[8px] border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-2.5 py-2 min-w-0';

/**
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function stateFieldCard(label, value) {
    const card = document.createElement('div');
    card.className = `${RAG_STATE_CARD} flex flex-col gap-0.5`;
    const cap = document.createElement('p');
    cap.className = 'm-0 text-[0.625rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)]';
    cap.textContent = label;
    const body = document.createElement('p');
    body.className = 'm-0 text-[0.75rem] leading-snug break-words fg-[var(--grid-ink)]';
    body.textContent = value;
    card.append(cap, body);
    return card;
}

/**
 * @param {string} label
 * @param {number | string} value
 * @returns {HTMLElement}
 */
function stateMetricCard(label, value) {
    const card = document.createElement('div');
    card.className = `${RAG_STATE_CARD} flex flex-col gap-0.5 items-start`;
    const num = document.createElement('p');
    num.className = 'm-0 text-[1.125rem] fw-semibold tabular-nums leading-none fg-[var(--grid-ink)]';
    num.textContent = String(value);
    const cap = document.createElement('p');
    cap.className = 'm-0 text-[0.625rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)]';
    cap.textContent = label;
    card.append(num, cap);
    return card;
}

/**
 * @param {string} message
 * @returns {HTMLElement}
 */
function stateStatusCard(message) {
    const card = document.createElement('div');
    card.className =
        `${RAG_STATE_CARD} flex items-center gap-2 bg-[var(--grid-panel-bright)] border-[var(--grid-accent)]/25`;
    const dot = document.createElement('span');
    dot.className = 'shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--grid-accent)]';
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('p');
    text.className = 'm-0 text-[0.75rem] fg-[var(--grid-ink-muted)]';
    text.textContent = message;
    card.append(dot, text);
    return card;
}

/**
 * @param {string} message
 * @returns {HTMLElement}
 */
function stateIdleCard(message) {
    const card = document.createElement('div');
    card.className = `${RAG_STATE_CARD} bg-[var(--grid-panel-bright)]`;
    const text = document.createElement('p');
    text.className = 'm-0 text-[0.75rem] leading-snug fg-[var(--grid-caption)] italic';
    text.textContent = message;
    card.append(text);
    return card;
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLSelectElement} sel
 */
function resetVaultPickerChrome(wrap, sel) {
    if (!(wrap instanceof HTMLElement)) return;
    delete wrap.dataset.oaaoComboboxMounted;
    delete wrap.dataset.oaaoRagVaultSyncBound;
    wrap._oaaoCombobox = null;
    wrap._oaaoRagVaultSel = null;
    wrap.replaceChildren(sel);
    sel.multiple = true;
    sel.replaceChildren();
    sel.dataset.default = '';
    sel.value = '';
}

/** @type {AbortController | null} */
let ragExploreMountAbort = null;

/**
 * @param {HTMLElement} host
 */
export default async function mountRagExplorePanel(host) {
    if (!(host instanceof HTMLElement)) return;

    ragExploreMountAbort?.abort();
    ragExploreMountAbort = new AbortController();
    const { signal } = ragExploreMountAbort;

    host.replaceChildren();

    activateRagExploreWorkspaceSidebar();
    const sidebarRoot = document.getElementById('workspace-rag-explore-sidebar-root');

    const shell = document.createElement('div');
    shell.className =
        'flex flex-col flex-1 min-h-0 min-w-0 w-full h-full bg-[var(--grid-paper)] text-[0.8125rem] fg-[var(--grid-ink)]';

    const inPanelAside = document.createElement('aside');
    inPanelAside.className =
        'hidden shrink-0 flex flex-col min-h-0 w-[min(272px,38vw)] max-w-[272px] border-r border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] overflow-hidden';
    inPanelAside.setAttribute('aria-label', oaaoT('rag.explore.sidebar_heading', 'Explore'));

    const contentCol = document.createElement('div');
    contentCol.className = 'flex flex-col flex-1 min-h-0 min-w-0';

    const header = document.createElement('div');
    header.className =
        'shrink-0 flex items-center px-6 py-3 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';

    const title = document.createElement('h1');
    title.className = 'text-[1.05rem] fw-semibold m-0';
    title.textContent = oaaoT('rag.explore.title', 'RAG Explore');
    header.append(title);

    const searchForm = document.createElement('form');
    searchForm.className =
        'flex flex-col gap-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2';

    const queryInput = document.createElement('input');
    queryInput.type = 'search';
    queryInput.name = 'query';
    queryInput.placeholder = oaaoT('rag.explore.query_ph', 'Search vault knowledge…');
    queryInput.className = 'oaao-input-inline w-full min-w-0';
    jitApply(queryInput, OAAO_FIELD_INPUT_JIT);

    const vaultWrap = document.createElement('div');
    vaultWrap.className = 'oaao-combobox-form w-full min-w-0';
    vaultWrap.dataset.oaaoRagVaultPicker = '1';

    const vaultSel = document.createElement('select');
    vaultSel.multiple = true;
    vaultSel.name = 'vault_ids';
    vaultWrap.append(vaultSel);

    const searchBtn = document.createElement('button');
    searchBtn.type = 'submit';
    searchBtn.className = 'oaao-settings-action-btn oaao-settings-action-btn--primary w-full shrink-0';
    searchBtn.textContent = oaaoT('rag.explore.search', 'Search');

    const stateSection = document.createElement('div');
    stateSection.className =
        'flex flex-col gap-1.5 shrink-0 pt-1 border-t border-solid border-[var(--grid-line)]';
    const stateHeading = document.createElement('p');
    stateHeading.className =
        'm-0 text-[0.6875rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)]';
    stateHeading.textContent = oaaoT('rag.explore.state_heading', 'State');
    const stateBody = document.createElement('div');
    stateBody.className = 'flex flex-col gap-2 min-w-0';
    stateBody.dataset.oaaoRagState = '1';
    stateSection.append(stateHeading, stateBody);

    searchForm.append(
        sidebarFieldLabel('rag.explore.query_label', 'Query'),
        queryInput,
        sidebarFieldLabel('rag.explore.vault_label', 'Vaults'),
        vaultWrap,
        searchBtn,
        stateSection,
    );

    const summaryPane = document.createElement('section');
    summaryPane.className =
        'shrink-0 flex flex-col gap-2 px-6 py-3 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)] max-h-[min(34vh,300px)] min-h-[5.5rem]';
    summaryPane.setAttribute('aria-label', oaaoT('rag.explore.summary_heading', 'Research summary'));
    const summaryHeadRow = document.createElement('div');
    summaryHeadRow.className = 'flex items-center justify-between gap-2 shrink-0 min-w-0';
    const summaryHeading = document.createElement('p');
    summaryHeading.className =
        'm-0 text-[0.6875rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)] truncate';
    summaryHeading.textContent = oaaoT('rag.explore.summary_heading', 'Research summary');
    const summaryBtn = document.createElement('button');
    summaryBtn.type = 'button';
    summaryBtn.className = 'oaao-settings-action-btn shrink-0 text-[0.75rem] px-2.5 py-1 hidden';
    summaryBtn.textContent = oaaoT('rag.explore.summary_regenerate', 'Regenerate');
    const summaryCard = document.createElement('div');
    summaryCard.className =
        'rounded-[10px] border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] shadow-[0_1px_3px_rgba(15,23,42,0.06)] p-4 flex-1 min-h-[4.5rem] max-h-[30vh] overflow-y-auto overflow-x-hidden';
    const summaryOut = document.createElement('div');
    summaryOut.className = 'min-w-0 text-[0.875rem] leading-relaxed break-words fg-[var(--grid-ink)]';
    renderRagExploreSummary(summaryOut, {
        placeholder: oaaoT(
            'rag.explore.summary_empty',
            'Enter a question — retrieved passages and graph entities will appear below with an LLM briefing here.',
        ),
    });
    summaryCard.append(summaryOut);
    summaryHeadRow.append(summaryHeading, summaryBtn);
    summaryPane.append(summaryHeadRow, summaryCard);

    if (sidebarRoot instanceof HTMLElement) {
        searchForm.className =
            'flex flex-col gap-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain';
        sidebarRoot.replaceChildren(searchForm);
    } else {
        inPanelAside.classList.remove('hidden');
        inPanelAside.classList.add('flex');
        inPanelAside.append(searchForm);
        shell.classList.replace('flex-col', 'flex-row');
        header.className =
            'shrink-0 flex flex-wrap items-end gap-3 px-4 py-3 border-b border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';
        title.className = 'text-[1.05rem] fw-semibold m-0 w-full';
    }

    const resultsWrap = document.createElement('div');
    resultsWrap.className = 'flex flex-1 min-h-0 min-w-0 flex-col lg:flex-row';

    const body = resultsWrap;

    const passagesPane = document.createElement('div');
    passagesPane.className =
        'flex flex-col min-h-0 min-w-0 w-full lg:w-[42%] xl:w-[38%] border-b lg:border-b-0 lg:border-r border-solid border-[var(--grid-line)] bg-[var(--grid-panel-bright)]';

    const passagesHead = document.createElement('div');
    passagesHead.className =
        'shrink-0 px-4 py-2 text-[0.6875rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)] border-b border-solid border-[var(--grid-line)]';
    passagesHead.textContent = oaaoT('rag.explore.passages', 'Passages');

    const passagesList = document.createElement('div');
    passagesList.className = 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-2';

    passagesPane.append(passagesHead, passagesList);

    const graphPane = document.createElement('div');
    graphPane.className = 'flex flex-col flex-1 min-h-0 min-w-0 bg-[var(--grid-paper)]';

    const graphHead = document.createElement('div');
    graphHead.className =
        'shrink-0 px-4 py-2 flex flex-col gap-0.5 border-b border-solid border-[var(--grid-line)]';
    const graphTitle = document.createElement('p');
    graphTitle.className =
        'm-0 text-[0.6875rem] uppercase tracking-wide fw-semibold fg-[var(--grid-caption)]';
    graphTitle.textContent = oaaoT('rag.explore.graph', 'Knowledge graph');
    const graphHint = document.createElement('p');
    graphHint.className = 'm-0 text-[0.6875rem] fg-[var(--grid-caption)]';
    graphHint.textContent = oaaoT(
        'rag.explore.graph_hint',
        'Force-directed graph — hover nodes for names; click to highlight relations.',
    );
    graphHead.append(graphTitle, graphHint);

    const graphHost = document.createElement('div');
    graphHost.className = 'flex-1 min-h-[240px] min-w-0 relative';
    graphHost.setAttribute('data-oaao-rag-graph', '1');

    graphPane.append(graphHead, graphHost);

    body.append(passagesPane, graphPane);

    const status = document.createElement('p');
    status.className =
        'shrink-0 px-6 py-2 m-0 text-[0.75rem] fg-[var(--grid-ink-muted)] border-t border-solid border-[var(--grid-line)]';

    function showStatus(text) {
        if (!text) {
            status.textContent = '';
            status.classList.add('hidden');
            return;
        }
        status.textContent = text;
        status.classList.remove('hidden');
    }

    contentCol.append(header, summaryPane, resultsWrap, status);
    if (inPanelAside.classList.contains('flex')) {
        shell.append(inPanelAside, contentCol);
    } else {
        shell.append(contentCol);
    }
    host.append(shell);

    /** @type {import('cytoscape').Core | null} */
    let cy = null;
    /** @type {ResizeObserver | null} */
    let graphResizeObs = null;
    /** @type {{ passages?: unknown[], graph?: { nodes?: unknown[], edges?: unknown[] } } | null} */
    let lastExploreData = null;

    /**
     * @param {{ query?: string, vaultLabels?: string, passageCount?: number | null, nodeCount?: number | null, status?: string }} patch
     */
    function updateStatePanel(patch) {
        stateBody.replaceChildren();
        if (patch.query) {
            stateBody.append(stateFieldCard(oaaoT('rag.explore.state_query', 'Query'), patch.query));
        }
        if (patch.vaultLabels) {
            stateBody.append(stateFieldCard(oaaoT('rag.explore.state_vaults', 'Vaults'), patch.vaultLabels));
        }
        if (patch.passageCount != null || patch.nodeCount != null) {
            const metrics = document.createElement('div');
            metrics.className = 'grid grid-cols-2 gap-2 min-w-0';
            metrics.append(
                stateMetricCard(oaaoT('rag.explore.passages', 'Passages'), patch.passageCount ?? 0),
                stateMetricCard(oaaoT('rag.explore.state_graph_nodes', 'Graph nodes'), patch.nodeCount ?? 0),
            );
            stateBody.append(metrics);
        }
        if (patch.status) {
            stateBody.append(stateStatusCard(patch.status));
        }
        if (!stateBody.childElementCount) {
            stateBody.append(
                stateIdleCard(oaaoT('rag.explore.state_idle', 'Idle — enter a query and pick vaults.')),
            );
        }
    }

    function clearResults() {
        passagesList.replaceChildren();
        const empty = document.createElement('p');
        empty.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0 px-1';
        empty.textContent = oaaoT('rag.explore.await_search', 'Results appear here after you search.');
        passagesList.append(empty);
        if (cy) {
            cy.destroy();
            cy = null;
        }
        graphResizeObs?.disconnect();
        graphResizeObs = null;
        graphHost.replaceChildren();
        summaryBtn.classList.add('hidden');
        renderRagExploreSummary(summaryOut, {
            placeholder: oaaoT(
                'rag.explore.summary_empty',
                'Enter a question — retrieved passages and graph entities will appear below with an LLM briefing here.',
            ),
        });
        showStatus('');
        status.classList.add('hidden');
    }

    /** @returns {string} */
    function selectedVaultLabels() {
        const ids = readSelectedVaultIds(vaultWrap, vaultSel);
        /** @type {string[]} */
        const names = [];
        for (let i = 0; i < vaultSel.options.length; i++) {
            const opt = vaultSel.options[i];
            if (ids.includes(Number(opt.value))) {
                names.push(String(opt.textContent ?? opt.value).trim());
            }
        }
        return names.length ? names.join(', ') : '—';
    }

    async function reloadVaultPicker() {
        resetVaultPickerChrome(vaultWrap, vaultSel);
        await loadVaultOptions();
        await mountVaultCombobox(vaultWrap, vaultSel);
        hydrateRagExploreJit(vaultWrap);
    }

    async function onWorkspaceScopeChanged() {
        queryInput.value = '';
        lastExploreData = null;
        clearResults();
        updateStatePanel({ status: oaaoT('rag.explore.state_workspace_reset', 'Workspace changed — vault list refreshed.') });
        await reloadVaultPicker();
    }

    window.addEventListener('oaao-workspace-scope-changed', () => {
        void onWorkspaceScopeChanged();
    }, { signal });

    async function loadVaultOptions() {
        try {
            const wid = globalThis.OAAO_ACTIVE_WORKSPACE_ID;
            const qs =
                typeof wid === 'number' && wid > 0
                    ? `?workspace_id=${wid}&include=flat`
                    : '?include=flat&scope=all';
            const res = await fetch(`${vaultApiUrl('vault_tree')}${qs}`, { credentials: 'same-origin' });
            const j = await res.json();
            vaultSel.replaceChildren();
            const rows = j?.data?.vaults ?? [];
            if (!Array.isArray(rows)) return;
            for (const v of rows) {
                if (!v || typeof v !== 'object') continue;
                const id = Number(v.id ?? v.vault_id ?? 0);
                if (!Number.isFinite(id) || id < 1) continue;
                const opt = document.createElement('option');
                opt.value = String(id);
                opt.textContent = String(v.name ?? v.title ?? `Vault ${id}`);
                vaultSel.append(opt);
            }
            /** @type {string[]} */
            const initial = [];
            if (vaultSel.options.length === 1) {
                initial.push(vaultSel.options[0].value);
                vaultSel.options[0].selected = true;
            }
            vaultSel.dataset.default = initial.join(',');
        } catch {
            /* ignore */
        }
    }

    /**
     * @param {{ passages?: unknown[], graph?: { nodes?: unknown[], edges?: unknown[] } }} data
     */
    async function renderResults(data) {
        passagesList.replaceChildren();
        const passages = Array.isArray(data.passages) ? data.passages : [];
        if (!passages.length) {
            const empty = document.createElement('p');
            empty.className = 'text-[0.8125rem] fg-[var(--grid-caption)] m-0 px-1';
            empty.textContent = oaaoT('rag.explore.no_passages', 'No matching passages.');
            passagesList.append(empty);
        } else {
            for (const row of passages) {
                if (!row || typeof row !== 'object') continue;
                const card = document.createElement('article');
                card.className =
                    'rounded-[8px] border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] p-3 flex flex-col gap-1';
                const meta = document.createElement('div');
                meta.className = 'text-[0.6875rem] fg-[var(--grid-caption)] tabular-nums';
                meta.textContent = `${row.vault_name ?? 'Vault'} · score ${row.score ?? '—'}`;
                const pathLine = document.createElement('div');
                pathLine.className = 'text-[0.75rem] fw-medium break-all min-w-0';
                const vaultPath = String(row.vault_path ?? '').trim();
                const fileName = String(row.file_name ?? '').trim();
                pathLine.textContent =
                    vaultPath ||
                    fileName ||
                    (row.document_id ? `doc ${row.document_id}` : oaaoT('rag.explore.passage_unknown_doc', 'Unknown document'));
                const segLabel = String(row.segment_label ?? '').trim();
                if (segLabel) {
                    const seg = document.createElement('div');
                    seg.className = 'text-[0.6875rem] fg-[var(--grid-caption)]';
                    seg.textContent = segLabel;
                    card.append(meta, pathLine, seg);
                } else {
                    card.append(meta, pathLine);
                }
                const text = document.createElement('p');
                text.className = 'm-0 text-[0.8125rem] leading-relaxed whitespace-pre-wrap break-words';
                const excerpt = String(row.excerpt ?? '').trim();
                text.textContent = excerpt || String(row.text ?? '');
                card.append(text);
                passagesList.append(card);
            }
        }

        const graph = data.graph && typeof data.graph === 'object' ? data.graph : {};
        const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
        const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
        const graphStats = graph.stats && typeof graph.stats === 'object' ? graph.stats : null;
        let { nodes, edges } = prepareGraphElements(rawNodes, rawEdges);
        ({ nodes, edges } = retainLargestGraphComponent(nodes, edges, 10));
        enrichGraphNodes(nodes, edges);

        const cytoscape = await loadCytoscape();
        const accent = gridToken('--grid-accent', '#2563eb');
        const ink = gridToken('--grid-ink', '#37352f');
        const inkMuted = gridToken('--grid-ink-muted', '#6b7280');
        const panel = gridToken('--grid-panel-bright', '#ffffff');

        if (cy) {
            cy.destroy();
            cy = null;
        }

        if (!nodes.length) {
            graphHost.replaceChildren();
            const hint = document.createElement('p');
            hint.className =
                'absolute inset-0 flex items-center justify-center m-0 px-4 text-center text-[0.8125rem] fg-[var(--grid-caption)]';
            hint.textContent = oaaoT(
                'rag.explore.no_graph',
                'No graph nodes matched — enable Graph mode on vaults and ensure documents are graph-indexed.',
            );
            graphHost.append(hint);
            return;
        }

        graphHost.replaceChildren();
        await ensureGraphHostReady(graphHost);

        graphHint.textContent =
            edges.length > 0
                ? (() => {
                      const dropped =
                          Number(graphStats?.dropped_isolated ?? 0) ||
                          Math.max(0, (Number(graphStats?.total_nodes ?? rawNodes.length) || rawNodes.length) - nodes.length);
                      const base = oaaoT(
                          'rag.explore.graph_hint',
                          'Force-directed graph — hover nodes for names; click to highlight relations.',
                      );
                      if (dropped > 0) {
                          return oaaoT('rag.explore.graph_hint_pruned', 'Largest connected cluster ({shown} nodes) — {dropped} isolated matches hidden.')
                              .replace('{shown}', String(nodes.length))
                              .replace('{dropped}', String(dropped));
                      }
                      return base;
                  })()
                : oaaoT(
                      'rag.explore.graph_hint_isolated',
                      'Matched entities with no relations between them — hover nodes for names.',
                  );

        cy = cytoscape({
            container: graphHost,
            elements: [...nodes, ...edges],
            style: [
                {
                    selector: 'node',
                    style: {
                        label: 'data(label)',
                        'text-opacity': 0,
                        'text-valign': 'bottom',
                        'text-halign': 'center',
                        'text-margin-y': 8,
                        'font-size': 9,
                        'font-weight': 500,
                        color: ink,
                        'background-color': 'data(nodeColor)',
                        'background-opacity': 0.92,
                        'border-width': 2,
                        'border-color': 'data(nodeColor)',
                        'border-opacity': 0.55,
                        width: 'data(nodeSize)',
                        height: 'data(nodeSize)',
                        'text-wrap': 'wrap',
                        'text-max-width': 120,
                        'text-background-opacity': 1,
                        'text-background-color': panel,
                        'text-background-padding': 3,
                        'text-background-shape': 'roundrectangle',
                        'text-outline-color': panel,
                        'text-outline-width': 2,
                        'overlay-opacity': 0,
                        'z-index': 1,
                    },
                },
                {
                    selector: 'node.graph-node-hover, node:selected',
                    style: {
                        'text-opacity': 1,
                        'border-width': 3,
                        'background-opacity': 1,
                        'z-index': 10,
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        'line-color': inkMuted,
                        'target-arrow-color': inkMuted,
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        width: 2,
                        opacity: 0.72,
                        'z-index': 0,
                    },
                },
                {
                    selector: 'edge.graph-edge-focus',
                    style: {
                        width: 2.75,
                        opacity: 0.95,
                        'line-color': accent,
                        'target-arrow-color': accent,
                        label: 'data(label)',
                        'font-size': 8,
                        color: ink,
                        'text-background-opacity': 1,
                        'text-background-color': panel,
                        'text-background-padding': 2,
                    },
                },
                {
                    selector: 'edge:selected',
                    style: {
                        label: 'data(label)',
                        'font-size': 8,
                        color: inkMuted,
                        width: 2.5,
                        opacity: 0.95,
                        'text-background-opacity': 1,
                        'text-background-color': panel,
                        'text-background-padding': 2,
                    },
                },
            ],
            minZoom: 0.15,
            maxZoom: 3.5,
        });
        attachGraphInteractions(cy, graphHost);
        runGraphLayout(cy, graphHost, nodes.length, edges.length);
        cy.on('layoutstop', () => {
            if (!cy || cy.destroyed()) return;
            finalizeGraphLayoutForHost(cy, graphHost, 52);
        });
        graphResizeObs?.disconnect();
        graphResizeObs = new ResizeObserver(() => {
            if (!cy || cy.destroyed()) return;
            refitGraphToHost(cy, graphHost, 52);
        });
        graphResizeObs.observe(graphHost);
        requestAnimationFrame(() => {
            if (!cy || cy.destroyed()) return;
            refitGraphToHost(cy, graphHost, 52);
        });
    }

    async function runSummarize() {
        if (!lastExploreData) return;
        const q = queryInput.value.trim();
        if (!q) return;
        summaryBtn.disabled = true;
        renderRagExploreSummary(summaryOut, {
            plain: oaaoT('rag.explore.summary_working', 'Generating summary…'),
        });
        try {
            const res = await fetch(ragApiUrl('rag_explore_summarize'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    query: q,
                    passages: lastExploreData.passages ?? [],
                    graph: lastExploreData.graph ?? {},
                }),
            });
            let j = null;
            try {
                j = await res.json();
            } catch {
                j = null;
            }
            if (!res.ok || !j?.success) {
                const msg =
                    typeof j?.message === 'string'
                        ? j.message
                        : oaaoT('rag.explore.summary_failed', 'Summary failed.');
                renderRagExploreSummary(summaryOut, { error: msg });
                return;
            }
            const text = String(j?.data?.summary ?? '').trim();
            if (!text) {
                renderRagExploreSummary(summaryOut, {
                    error: oaaoT(
                        'rag.explore.summary_none',
                        'No summary returned — configure chat.primary (Fast) in Settings.',
                    ),
                });
            } else {
                renderRagExploreSummary(summaryOut, { markdown: text });
            }
            summaryBtn.classList.remove('hidden');
        } catch {
            renderRagExploreSummary(summaryOut, {
                error: oaaoT('rag.explore.summary_failed', 'Summary failed.'),
            });
        } finally {
            summaryBtn.disabled = false;
        }
    }

    searchForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        void (async () => {
            const q = queryInput.value.trim();
            if (!q) {
                showStatus(oaaoT('rag.explore.query_required', 'Enter a search query.'));
                queryInput.focus();
                return;
            }
            const vaultIds = readSelectedVaultIds(vaultWrap, vaultSel);
            if (!vaultIds.length) {
                showStatus(oaaoT('rag.explore.pick_vault', 'Select at least one vault.'));
                return;
            }
            const widRaw = globalThis.OAAO_ACTIVE_WORKSPACE_ID;
            const workspaceId =
                typeof widRaw === 'number' && Number.isFinite(widRaw) && widRaw > 0 ? widRaw : null;
            searchBtn.disabled = true;
            showStatus(oaaoT('rag.explore.searching', 'Searching…'));
            renderRagExploreSummary(summaryOut, {
                plain: oaaoT('rag.explore.searching', 'Searching…'),
            });
            summaryBtn.classList.add('hidden');
            try {
                const res = await fetch(ragApiUrl('rag_explore'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        query: q,
                        vault_ids: vaultIds,
                        ...(workspaceId != null ? { workspace_id: workspaceId } : {}),
                    }),
                });
                let j = null;
                try {
                    j = await res.json();
                } catch {
                    j = null;
                }
                if (!res.ok || !j?.success) {
                    const msg =
                        typeof j?.message === 'string' ? j.message : oaaoT('rag.explore.failed', 'Search failed.');
                    const errCode = typeof j?.error === 'string' ? j.error : '';
                    showStatus(errCode ? `${msg} (${errCode})` : msg);
                    return;
                }
                const data = j.data ?? {};
                lastExploreData = data;
                const passageCount = Array.isArray(data.passages) ? data.passages.length : 0;
                const graphStats = data.graph?.stats;
                const nodeCount =
                    graphStats && typeof graphStats.displayed_nodes === 'number'
                        ? graphStats.displayed_nodes
                        : Array.isArray(data.graph?.nodes)
                          ? data.graph.nodes.length
                          : 0;
                const countsText = oaaoT('rag.explore.done_counts', '{passages} passages · {nodes} graph nodes')
                    .replace('{passages}', String(passageCount))
                    .replace('{nodes}', String(nodeCount));
                showStatus(countsText);
                updateStatePanel({
                    query: q,
                    vaultLabels: selectedVaultLabels(),
                    passageCount,
                    nodeCount,
                    status: oaaoT('rag.explore.state_ready', 'Search complete.'),
                });
                if (passageCount > 0 || nodeCount > 0) {
                    renderRagExploreSummary(summaryOut, {
                        plain: oaaoT('rag.explore.summary_working', 'Generating summary…'),
                    });
                    await Promise.all([renderResults(data), runSummarize()]);
                } else {
                    renderRagExploreSummary(summaryOut, {
                        error: oaaoT('rag.explore.summary_no_hits', 'No passages or graph nodes matched this query.'),
                    });
                    summaryBtn.classList.add('hidden');
                }
            } catch {
                showStatus(oaaoT('rag.explore.failed', 'Search failed.'));
            } finally {
                searchBtn.disabled = false;
            }
        })();
    });

    summaryBtn.addEventListener('click', () => {
        void runSummarize();
    }, { signal });

    signal.addEventListener('abort', () => {
        graphResizeObs?.disconnect();
        graphResizeObs = null;
        if (cy) {
            cy.destroy();
            cy = null;
        }
    });

    clearResults();
    updateStatePanel({});
    await reloadVaultPicker();
    hydrateRagExploreJit(searchForm);
}

export function teardownShellPanel() {
    ragExploreMountAbort?.abort();
    ragExploreMountAbort = null;
    document.getElementById('workspace-rag-explore-sidebar-root')?.replaceChildren();
    document.getElementById('workspace-rag-explore-sidebar-section')?.classList.add('hidden');
}

export async function mountShellPanel(mount) {
    const host = mount.querySelector('[data-oaao-rag-explore="mount"]') ?? mount;
    await mountRagExplorePanel(/** @type {HTMLElement} */ (host));
}

export { mountRagExplorePanel };
