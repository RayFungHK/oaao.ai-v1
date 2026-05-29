/**
 * UX-1 — Inference-parameter wave (wizard profile + per-option palette).
 */

import { INFERENCE_PARAM_DEFS } from '@oaao/chat-js/composer-model-params.js';

/** Mirrors python/oaao_orchestrator/personalization_wizard.py _GUIDED_PARAM_HINTS */
/** @type {Record<string, Record<string, number>>} */
export const GUIDED_PARAM_HINTS = {
    q1_concise: { temperature: 0.25, top_p: 0.75, max_tokens: 512 },
    q1_balanced: { temperature: 0.55, top_p: 0.88, max_tokens: 1024 },
    q1_detailed: { temperature: 0.65, top_p: 0.92, max_tokens: 2048 },
    q1_very_detailed: { temperature: 0.7, top_p: 0.95, max_tokens: 3072 },
    q2_factual: { temperature: 0.2, top_p: 0.7, presence_penalty: 0.1 },
    q2_balanced: { temperature: 0.55, top_p: 0.9 },
    q2_creative: { temperature: 0.95, top_p: 0.98, frequency_penalty: 0.35 },
    q2_playful: { temperature: 1.1, top_p: 0.99, frequency_penalty: 0.55 },
    q3_steady: { frequency_penalty: 0.0, presence_penalty: 0.0 },
    q3_mixed: { frequency_penalty: 0.25, presence_penalty: 0.15 },
    q3_varied: { frequency_penalty: 0.55, presence_penalty: 0.35 },
    q4_brief: { max_tokens: 768, presence_penalty: -0.1 },
    q4_balanced: { max_tokens: 1536 },
    q4_thorough: { max_tokens: 3072, presence_penalty: 0.25 },
    q5_steady: { temperature: 0.35, top_p: 0.82, top_k: 40, max_tokens: 1536 },
    q5_expressive: { temperature: 0.92, top_p: 0.97, frequency_penalty: 0.45, max_tokens: 2048 },
};

/** @typedef {'steady' | 'balanced' | 'colorful'} WavePalette */

/** @type {readonly string[]} */
const LAYER_KEYS = [
    'temperature',
    'top_p',
    'top_k',
    'presence_penalty',
    'frequency_penalty',
    'max_tokens',
];

/** Ten discrete hues (0–1); wave + colorful swatch use stepped / conic disk. */
const DISK_COLORS_10 = [
    '#22c55e',
    '#84cc16',
    '#eab308',
    '#f59e0b',
    '#f97316',
    '#ef4444',
    '#ec4899',
    '#d946ef',
    '#a855f7',
    '#3b82f6',
];

/** @type {Record<WavePalette, readonly string[]>} */
const SWATCH_DISK_COLORS = {
    steady: ['#64748b'],
    balanced: ['#334155', '#0ea5e9', '#6366f1'],
    colorful: DISK_COLORS_10,
};

const WAVE_STYLE_ID = 'oaao-survey-param-wave-styles';
const WAVE_STYLE_REV = '20260529-survey-wave-v10';

/** Visual expressiveness anchors (never pin “balanced” to ~0). */
const EXPRESSIVENESS_TIER = {
    steady: 0.28,
    balanced: 0.52,
    lively: 0.84,
};

/** Max half-amplitude as fraction of plot height (keeps stroke inside box). */
const WAVE_AMP_FRAC = 0.3;

/** Left/right 20% converge to center; middle 60% carries parameter waves. */
const WAVE_BUF_RATIO = 0.2;

/** @type {WeakMap<HTMLElement, number>} */
const waveRafByHost = new WeakMap();

/**
 * @typedef {object} WaveRuntime
 * @property {SVGSVGElement} svg
 * @property {SVGPathElement} path
 * @property {number} drawW
 * @property {number} h
 * @property {number[]} norms
 * @property {number} energy
 * @property {number} signature
 * @property {number} expressiveness
 * @property {number} animStart
 */

/** @type {WeakMap<HTMLElement, WaveRuntime>} */
const waveRuntimeByHost = new WeakMap();

/**
 * @param {string} optionId
 * @param {string} [label]
 * @returns {WavePalette}
 */
export function resolveOptionPalette(optionId, label = '') {
    const id = String(optionId || '').toLowerCase();
    const lab = String(label || '').toLowerCase();
    if (
        id.includes('factual') ||
        id.includes('steady') ||
        id.includes('concise') ||
        id.includes('brief') ||
        lab.includes('事實') ||
        lab.includes('穩健') ||
        lab.includes('穩重') ||
        lab.includes('沉穩') ||
        lab.includes('嚴謹') ||
        lab.includes('務實') ||
        lab.includes('專業') ||
        lab.includes('正式') ||
        lab.includes('steady') ||
        lab.includes('factual') ||
        lab.includes('精準') ||
        lab.includes('precise') ||
        lab.includes('簡短') ||
        lab.includes('扼要')
    ) {
        return 'steady';
    }
    if (
        id.includes('creative') ||
        id.includes('playful') ||
        id.includes('varied') ||
        id.includes('expressive') ||
        id.includes('very_detailed') ||
        lab.includes('創意') ||
        lab.includes('活潑') ||
        lab.includes('輕鬆') ||
        lab.includes('啟發') ||
        lab.includes('有趣') ||
        lab.includes('熱情') ||
        lab.includes('對話') ||
        lab.includes('互動') ||
        lab.includes('creative') ||
        lab.includes('playful') ||
        lab.includes('convers')
    ) {
        return 'colorful';
    }
    if (
        lab.includes('條列') ||
        lab.includes('架構') ||
        lab.includes('list') ||
        lab.includes('bullet') ||
        lab.includes('structure')
    ) {
        return 'steady';
    }
    if (lab.includes('敘事') || lab.includes('narrat') || lab.includes('story')) {
        return 'balanced';
    }
    return 'balanced';
}

/** @type {readonly string[]} */
const STEADY_LABEL_MARKERS = [
    'steady',
    'factual',
    'concise',
    'brief',
    'precise',
    'calm',
    'formal',
    '穩重',
    '穩健',
    '沉穩',
    '嚴謹',
    '務實',
    '專業',
    '正式',
    '事實',
    '精準',
    '簡短',
    '扼要',
    '點到為止',
    '簡潔',
];

/** @type {readonly string[]} */
const LIVELY_LABEL_MARKERS = [
    'playful',
    'creative',
    'expressive',
    'varied',
    'lively',
    'warm',
    'enthus',
    '活潑',
    '輕鬆',
    '啟發',
    '有趣',
    '熱情',
    '創意',
    '天馬',
    '腦力',
    'very_detailed',
];

/** @type {readonly string[]} */
const BALANCED_LABEL_MARKERS = [
    'balanced',
    'mixed',
    'neutral',
    'moderate',
    '平衡',
    '適中',
    '適度',
    '中庸',
];

/**
 * @param {string} optionId
 * @param {string} [label]
 * @returns {'steady' | 'balanced' | 'lively' | null}
 */
function expressivenessTierFromOption(optionId, label = '') {
    const id = String(optionId || '').toLowerCase();
    const lab = String(label || '');
    const labLo = lab.toLowerCase();

    for (const kw of STEADY_LABEL_MARKERS) {
        if (id.includes(kw) || lab.includes(kw) || labLo.includes(kw)) return 'steady';
    }
    for (const kw of LIVELY_LABEL_MARKERS) {
        if (id.includes(kw) || lab.includes(kw) || labLo.includes(kw)) return 'lively';
    }
    for (const kw of BALANCED_LABEL_MARKERS) {
        if (id.includes(kw) || lab.includes(kw) || labLo.includes(kw)) return 'balanced';
    }
    if (/q\d+_(steady|factual|concise|brief)\b/.test(id)) return 'steady';
    if (/q\d+_(balanced|mixed)\b/.test(id)) return 'balanced';
    if (/q\d+_(playful|creative|expressive|varied|very_detailed)\b/.test(id)) return 'lively';
    return null;
}

/**
 * @param {number} rank
 * @param {number} count
 * @returns {number}
 */
function expressivenessFromRank(rank, count) {
    if (count <= 1) return EXPRESSIVENESS_TIER.balanced;
    if (count === 2) return rank === 0 ? EXPRESSIVENESS_TIER.steady : EXPRESSIVENESS_TIER.lively;
    if (count === 3) {
        const tiers = [
            EXPRESSIVENESS_TIER.steady,
            EXPRESSIVENESS_TIER.balanced,
            EXPRESSIVENESS_TIER.lively,
        ];
        return tiers[Math.max(0, Math.min(rank, tiers.length - 1))];
    }
    const t = rank / Math.max(1, count - 1);
    return (
        EXPRESSIVENESS_TIER.steady +
        t * (EXPRESSIVENESS_TIER.lively - EXPRESSIVENESS_TIER.steady)
    );
}

/**
 * 0 = calm / steady line, 1 = lively / rippled line.
 *
 * @param {string} optionId
 * @param {string} [label]
 * @param {Record<string, number>} [params]
 * @returns {number}
 */
export function rawOptionExpressiveness(optionId, label = '', params = {}) {
    const id = String(optionId || '').toLowerCase();
    const lab = String(label || '');
    const labLo = lab.toLowerCase();

    let score = 0.48;

    if (params.temperature !== undefined && Number.isFinite(Number(params.temperature))) {
        score = normalizeParam('temperature', Number(params.temperature));
    }
    if (params.frequency_penalty !== undefined && Number.isFinite(Number(params.frequency_penalty))) {
        const fp = normalizeParam('frequency_penalty', Number(params.frequency_penalty));
        score = score * 0.55 + fp * 0.45;
    }
    if (params.presence_penalty !== undefined && Number.isFinite(Number(params.presence_penalty))) {
        const pp = normalizeParam('presence_penalty', Number(params.presence_penalty));
        score = score * 0.75 + pp * 0.25;
    }

    for (const kw of STEADY_LABEL_MARKERS) {
        if (id.includes(kw) || lab.includes(kw) || labLo.includes(kw)) {
            score = Math.min(score, 0.14);
        }
    }
    for (const kw of LIVELY_LABEL_MARKERS) {
        if (id.includes(kw) || lab.includes(kw) || labLo.includes(kw)) {
            score = Math.max(score, 0.86);
        }
    }

    if (/q[1-5]_(steady|factual|concise|brief)/.test(id)) score = Math.min(score, 0.12);
    if (/q[1-5]_(playful|creative|expressive|varied|very_detailed)/.test(id)) {
        score = Math.max(score, 0.88);
    }

    return Math.max(0, Math.min(1, score));
}

/**
 * Spread expressiveness across options on the same step (LLM labels often cluster).
 *
 * @param {string} pendingId
 * @param {string} [label]
 * @param {Record<string, number>} params
 * @param {Array<{ id: string, label?: string, model_params?: Record<string, number> }>} [allOptions]
 * @returns {number}
 */
export function resolveStepOptionExpressiveness(
    pendingId,
    label = '',
    params = {},
    allOptions = [],
) {
    const id = String(pendingId || '').trim();
    const tier = expressivenessTierFromOption(id, label);
    if (tier) return EXPRESSIVENESS_TIER[tier];

    const raw = rawOptionExpressiveness(id, label, params);
    if (allOptions.length < 2) return Math.max(EXPRESSIVENESS_TIER.steady, Math.min(EXPRESSIVENESS_TIER.lively, raw));

    const rows = allOptions.map((o) => ({
        id: o.id,
        tier: expressivenessTierFromOption(o.id, o.label ?? ''),
        score: rawOptionExpressiveness(
            o.id,
            o.label ?? '',
            o.model_params && Object.keys(o.model_params).length
                ? o.model_params
                : GUIDED_PARAM_HINTS[o.id] ?? {},
        ),
    }));

    const sorted = [...rows].sort((a, b) => {
        const ta = a.tier ? EXPRESSIVENESS_TIER[a.tier] : a.score;
        const tb = b.tier ? EXPRESSIVENESS_TIER[b.tier] : b.score;
        return ta - tb;
    });
    const rank = sorted.findIndex((r) => r.id === id);
    if (rank >= 0) return expressivenessFromRank(rank, sorted.length);

    return Math.max(EXPRESSIVENESS_TIER.steady, Math.min(EXPRESSIVENESS_TIER.lively, raw));
}

/**
 * @param {string} key
 * @param {number} value
 * @returns {number}
 */
function normalizeParam(key, value) {
    const def = INFERENCE_PARAM_DEFS.find((d) => d.key === key);
    if (!def || !Number.isFinite(value)) return 0.35;
    const t = (value - def.min) / (def.max - def.min);
    return Math.max(0, Math.min(1, t));
}

/**
 * Spread normalized values so low/high profiles look clearly different.
 *
 * @param {number} n
 * @returns {number}
 */
function amplifyNorm(n) {
    const x = Math.max(0, Math.min(1, n));
    if (x < 0.5) return 0.5 * Math.pow(x * 2, 2.1);
    return 1 - 0.5 * Math.pow((1 - x) * 2, 2.1);
}

/**
 * @param {Record<string, number>} merged
 * @returns {number[]}
 */
function layerNormValues(merged) {
    const active = LAYER_KEYS.filter(
        (key) => merged[key] !== undefined && Number.isFinite(Number(merged[key])),
    );
    const keys = active.length >= 1 ? active : LAYER_KEYS;
    return keys.map((key) => {
        if (merged[key] === undefined) return 0.28;
        return amplifyNorm(normalizeParam(key, Number(merged[key])));
    });
}

/**
 * Deterministic phase / frequency bias so options remain visually distinct.
 *
 * @param {string} optionId
 * @returns {number}
 */
function waveSignatureFromOptionId(optionId) {
    const s = String(optionId || '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) {
        h = (h * 33 + s.charCodeAt(i)) | 0;
    }
    return ((h >>> 0) % 360) * (Math.PI / 180);
}

/**
 * @param {number[]} norms
 * @returns {number}
 */
function profileEnergy(norms) {
    if (!norms.length) return 0.45;
    const mean = norms.reduce((a, b) => a + b, 0) / norms.length;
    const spread = Math.max(...norms) - Math.min(...norms);
    return Math.max(0.15, Math.min(1, mean * 0.75 + spread * 0.55));
}

/**
 * @param {Array<{ id: string, model_params?: Record<string, number> }>} answers
 * @param {string} [pendingId]
 * @param {Array<{ id: string, model_params?: Record<string, number> }>} [options]
 * @returns {Record<string, number>}
 */
/**
 * Params that drive the preview wave while comparing options on the current step.
 * Uses this option only (not full cumulative merge) so shapes differ clearly.
 *
 * @param {string} pendingId
 * @param {Array<{ id: string, model_params?: Record<string, number> }>} [options]
 * @param {Record<string, number>} [serverCumulative]
 * @returns {Record<string, number>}
 */
export function optionWaveParams(pendingId, options = [], serverCumulative = {}) {
    const id = String(pendingId || '').trim();
    if (!id) return {};
    const opt = options.find((o) => o.id === id);
    const mp = opt?.model_params;
    const hints = GUIDED_PARAM_HINTS[id];
    const cum = serverCumulative && typeof serverCumulative === 'object' ? serverCumulative : {};

    if (mp && typeof mp === 'object' && Object.keys(mp).length >= 2) {
        /** @type {Record<string, number>} */
        const delta = {};
        for (const key of LAYER_KEYS) {
            if (mp[key] === undefined || !Number.isFinite(Number(mp[key]))) continue;
            const v = Number(mp[key]);
            const base = cum[key];
            if (base === undefined || !Number.isFinite(Number(base)) || Math.abs(v - Number(base)) > 1e-6) {
                delta[key] = v;
            }
        }
        if (Object.keys(delta).length >= 2) return delta;
        return { ...mp };
    }
    if (hints && Object.keys(hints).length) return { ...hints };
    return {};
}

export function mergeGuidedProfileParams(answers, pendingId = '', options = []) {
    /** @type {Record<string, number>} */
    const merged = {};
    const apply = (/** @type {string} */ id, /** @type {Record<string, number> | undefined} */ mp) => {
        const hints = GUIDED_PARAM_HINTS[id];
        if (hints) Object.assign(merged, hints);
        if (mp && typeof mp === 'object') Object.assign(merged, mp);
    };
    for (const row of answers) {
        if (!row?.id) continue;
        const optMp = options.find((o) => o.id === row.id)?.model_params;
        apply(row.id, optMp);
    }
    if (pendingId) {
        const optMp = options.find((o) => o.id === pendingId)?.model_params;
        apply(pendingId, optMp);
    }
    return merged;
}

function ensureWaveStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(WAVE_STYLE_ID);
    if (prev?.dataset.oaaoRev === WAVE_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = WAVE_STYLE_ID;
    style.dataset.oaaoRev = WAVE_STYLE_REV;
    style.textContent = `
.oaao-survey-param-wave{
  position:relative;
  overflow:hidden;
  isolation:isolate;
}
.oaao-survey-param-wave svg{
  display:block;
  width:100%;
  max-width:100%;
}
.oaao-style-emotion-swatch{
  display:inline-flex;
  width:1.25rem;
  height:1.25rem;
  border-radius:6px;
  overflow:hidden;
  flex-shrink:0;
  border:none;
  box-shadow:inset 0 0 0 1px rgba(15,23,42,0.07);
}
.oaao-style-emotion-swatch svg{
  display:block;
  width:100%;
  height:100%;
}
`;
    document.head.append(style);
}

/**
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {string}
 */
function diskSectorPath(cx, cy, r, startDeg, endDeg) {
    const rad = (/** @type {number} */ d) => (d * Math.PI) / 180;
    const x1 = cx + r * Math.cos(rad(startDeg));
    const y1 = cy + r * Math.sin(rad(startDeg));
    const x2 = cx + r * Math.cos(rad(endDeg));
    const y2 = cy + r * Math.sin(rad(endDeg));
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/**
 * @param {readonly string[]} colors
 * @returns {SVGSVGElement}
 */
function buildDiskSwatchSvg(colors) {
    const size = 20;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('aria-hidden', 'true');

    const n = colors.length;
    const slice = 360 / n;
    let start = -90;
    for (let i = 0; i < n; i += 1) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', diskSectorPath(cx, cy, r, start, start + slice));
        path.setAttribute('fill', colors[i] ?? colors[0]);
        svg.append(path);
        start += slice;
    }
    return svg;
}

/**
 * @param {number} drawW
 * @param {number} xBuf0
 * @param {number} xBuf1
 * @returns {number[]}
 */
function samplePathXs(drawW, xBuf0, xBuf1) {
    /** @type {number[]} */
    const xs = [0];
    for (let x = 2; x < xBuf0; x += 2) xs.push(x);
    if (xBuf0 > 0 && xs[xs.length - 1] !== xBuf0) xs.push(xBuf0);
    for (let x = xBuf0 + 1; x <= xBuf1; x += 1) xs.push(x);
    for (let x = xBuf1 + 2; x < drawW; x += 2) xs.push(x);
    if (xs[xs.length - 1] !== drawW) xs.push(drawW);
    return xs;
}

/**
 * @param {Element} defs
 * @param {string} gradId
 * @param {readonly string[]} colors
 */
function appendSteppedLinearGradient(defs, gradId, colors) {
    const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', gradId);
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%');
    grad.setAttribute('y2', '0%');
    const n = colors.length;
    for (let i = 0; i < n; i += 1) {
        const startPct = (i / n) * 100;
        const endPct = ((i + 1) / n) * 100;
        const c = colors[i] ?? colors[n - 1];
        const stStart = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stStart.setAttribute('offset', `${startPct}%`);
        stStart.setAttribute('stop-color', c);
        const stEnd = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stEnd.setAttribute('offset', `${endPct}%`);
        stEnd.setAttribute('stop-color', c);
        grad.append(stStart, stEnd);
    }
    defs.append(grad);
}

/**
 * Single-profile wave unit (middle 60%). Zero at u=0 and u=1.
 *
 * @param {number} localU
 * @param {number[]} norms
 * @param {number} energy
 * @param {number} animPhase
 * @param {number} stretch
 * @param {number} signature
 * @param {number} expressiveness
 * @returns {number}
 */
function compositeWaveUnit(
    localU,
    norms,
    energy,
    animPhase,
    stretch,
    signature = 0,
    expressiveness = 0.5,
) {
    const e = Math.max(0, Math.min(1, expressiveness));
    const envelope = Math.sin(localU * Math.PI);
    const uWarp = (localU - 0.5) * stretch + 0.5;
    const freqScale = 0.22 + e * 1.05;
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < norms.length; i += 1) {
        const n = norms[i];
        const layerGain = Math.pow(0.12 + e * 0.88, i);
        const freq = (0.55 + i * 0.38 + n * 1.6 + energy * 0.45) * freqScale;
        const amp = (0.22 + n * 0.55) * layerGain;
        const phase = animPhase + signature + i * 0.85 + n * 1.4;
        sum += amp * Math.sin(uWarp * Math.PI * 2 * freq + phase);
        weight += amp;
    }
    const core = weight > 0 ? sum / weight : 0;
    const motion = 0.28 + e * e * 0.72;
    const baseline =
        0.14 *
        (0.4 + e * 0.6) *
        Math.sin(localU * Math.PI * 2.4 + animPhase * 0.65 + signature * 0.25);
    return envelope * (core * motion + baseline) * (0.55 + energy * 0.3);
}

/**
 * @param {number} h
 * @param {number} energy
 * @returns {number}
 */
function waveAmplitude(h, energy, normSpread = 0, expressiveness = 0.5) {
    const e = Math.max(0, Math.min(1, expressiveness));
    const calmScale = 0.32 + e * e * 0.68;
    return h * WAVE_AMP_FRAC * calmScale * (0.52 + energy * 0.32 + normSpread * 0.12);
}

/**
 * @param {number} drawW
 * @param {number} h
 * @param {number[]} norms
 * @param {number} energy
 * @param {number} animPhase
 * @param {number} stretch
 * @param {number} signature
 * @param {number} expressiveness
 * @returns {string}
 */
function buildWavePath(
    drawW,
    h,
    norms,
    energy,
    animPhase,
    stretch,
    signature = 0,
    expressiveness = 0.5,
) {
    const mid = h * 0.5;
    const xBuf0 = drawW * WAVE_BUF_RATIO;
    const xBuf1 = drawW * (1 - WAVE_BUF_RATIO);
    const activeSpan = Math.max(1, xBuf1 - xBuf0);
    const spread = norms.length ? Math.max(...norms) - Math.min(...norms) : 0;
    const amp = waveAmplitude(h, energy, spread, expressiveness);

    const parts = [];
    for (const x of samplePathXs(drawW, xBuf0, xBuf1)) {
        let y = mid;
        if (x >= xBuf0 && x <= xBuf1) {
            const localU = (x - xBuf0) / activeSpan;
            y =
                mid +
                compositeWaveUnit(
                    localU,
                    norms,
                    energy,
                    animPhase,
                    stretch,
                    signature,
                    expressiveness,
                ) *
                    amp;
        }
        parts.push(`${parts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(2)}`);
    }
    return parts.join(' ');
}

/**
 * @param {HTMLElement} host
 */
function stopWaveAnim(host) {
    const id = waveRafByHost.get(host);
    if (id !== undefined) {
        cancelAnimationFrame(id);
        waveRafByHost.delete(host);
    }
}

/**
 * @param {HTMLElement} host
 * @param {WaveRuntime} rt
 */
function startWaveAnim(host, rt) {
    stopWaveAnim(host);
    const tick = (/** @type {number} */ now) => {
        if (!host.isConnected) {
            stopWaveAnim(host);
            return;
        }
        const sec = (now - rt.animStart) / 1000;
        const animPhase = sec * (0.45 + rt.expressiveness * 1.25);
        const stretch =
            1 + (0.04 + rt.expressiveness * 0.16) * Math.sin(sec * 1.05 + rt.signature * 0.4);
        rt.path.setAttribute(
            'd',
            buildWavePath(
                rt.drawW,
                rt.h,
                rt.norms,
                rt.energy,
                animPhase,
                stretch,
                rt.signature,
                rt.expressiveness,
            ),
        );
        waveRafByHost.set(host, requestAnimationFrame(tick));
    };
    waveRafByHost.set(host, requestAnimationFrame(tick));
}

/**
 * Rounded square before style label — disk segments (more creative → more hues).
 *
 * @param {HTMLElement} host
 * @param {WavePalette} palette
 */
export function mountStyleEmotionSwatch(host, palette) {
    if (!(host instanceof HTMLElement)) return;
    ensureWaveStyles();
    host.replaceChildren();
    const wrap = document.createElement('span');
    wrap.className = 'oaao-style-emotion-swatch';
    wrap.dataset.palette = palette;
    wrap.setAttribute('aria-hidden', 'true');
    const colors = SWATCH_DISK_COLORS[palette] ?? SWATCH_DISK_COLORS.balanced;
    if (palette === 'steady' || colors.length < 2) {
        wrap.style.background = colors[0] ?? '#64748b';
    } else {
        wrap.append(buildDiskSwatchSvg(colors));
    }
    host.append(wrap);
}

/**
 * @param {HTMLElement} host
 * @param {Record<string, number>} params
 * @param {{ compact?: boolean, palette?: WavePalette, optionId?: string, expressiveness?: number }} [opts]
 */
export function mountSurveyParamWave(host, params, opts = {}) {
    if (!(host instanceof HTMLElement)) return;
    ensureWaveStyles();

    const compact = opts.compact !== false;

    host.className = [
        'oaao-survey-param-wave',
        'w-full',
        'rounded-[8px]',
        'border',
        'border-solid',
        'border-[var(--grid-line)]',
        'bg-[var(--grid-paper)]',
    ].join(' ');

    const viewW = 400;
    const drawW = viewW;
    const h = compact ? 56 : 72;
    const norms = layerNormValues(params);
    const energy = profileEnergy(norms);
    const signature = waveSignatureFromOptionId(opts.optionId ?? '');
    const expressiveness =
        typeof opts.expressiveness === 'number' && Number.isFinite(opts.expressiveness)
            ? Math.max(0, Math.min(1, opts.expressiveness))
            : rawOptionExpressiveness(opts.optionId ?? '', '', params);

    const optionKey = String(opts.optionId ?? '');
    let rt = waveRuntimeByHost.get(host);
    const reuseSvg = !!(rt && rt.svg.isConnected && host.contains(rt.svg));

    if (!reuseSvg) {
        stopWaveAnim(host);
        host.replaceChildren();

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${viewW} ${h}`);
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', String(h));
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.classList.add('block');

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const clipId = `oaao-wave-clip-${Math.random().toString(36).slice(2, 9)}`;
        const clip = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clip.setAttribute('id', clipId);
        const padY = 4;
        const clipRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        clipRect.setAttribute('x', '0');
        clipRect.setAttribute('y', String(padY));
        clipRect.setAttribute('width', String(viewW));
        clipRect.setAttribute('height', String(Math.max(8, h - padY * 2)));
        clip.append(clipRect);
        defs.append(clip);

        const gradId = `oaao-wave-grad-${Math.random().toString(36).slice(2, 9)}`;
        appendSteppedLinearGradient(defs, gradId, DISK_COLORS_10);
        svg.append(defs);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('clip-path', `url(#${clipId})`);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', `url(#${gradId})`);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.classList.add('oaao-wave-layer');
        g.append(path);
        svg.append(g);
        host.append(svg);

        rt = {
            svg,
            path,
            drawW,
            h,
            norms,
            energy,
            signature,
            expressiveness,
            animStart: performance.now(),
        };
        waveRuntimeByHost.set(host, rt);
    } else if (rt) {
        rt.norms = norms;
        rt.energy = energy;
        rt.signature = signature;
        rt.expressiveness = expressiveness;
        rt.drawW = drawW;
        rt.h = h;
    }

    if (!rt) return;

    host.dataset.oaaoWaveOptionKey = optionKey;
    rt.path.setAttribute('d', buildWavePath(drawW, h, norms, energy, 0, 1, signature, expressiveness));
    startWaveAnim(host, rt);
}

/**
 * @param {HTMLElement | null} host
 */
export function clearSurveyParamWave(host) {
    if (!(host instanceof HTMLElement)) return;
    stopWaveAnim(host);
    waveRuntimeByHost.delete(host);
    delete host.dataset.oaaoWaveOptionKey;
    host.replaceChildren();
}
