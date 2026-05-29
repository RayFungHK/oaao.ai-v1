/**
 * Preferences — UX-1 model tuning wizard (intro → 5 guided questions → auto inference params).
 */

import { oaaoMountLoadingLogo } from '@oaao/core-js/oaao-loading-logo.js';
import { oaaoResolveLang, oaaoT } from '@oaao/core-js/oaao-i18n.js';
import { INFERENCE_PARAM_DEFS } from '@oaao/chat-js/composer-model-params.js';
import {
    clearSurveyParamWave,
    mergeGuidedProfileParams,
    mountStyleEmotionSwatch,
    mountSurveyParamWave,
    optionWaveParams,
    resolveOptionPalette,
    resolveStepOptionExpressiveness,
} from './oaao-survey-param-wave.js';

const SURVEY_STYLE_ID = 'oaao-survey-panel-styles';
const SURVEY_STYLE_REV = '20260529-survey-wizard-v13-wave-fix';
const GUIDED_TOTAL_STEPS = 5;

/** @type {Record<string, string>} */
const THEME_I18N_KEYS = {
    daily: 'preferences.survey.theme_daily',
    corporate: 'preferences.survey.theme_corporate',
    research: 'preferences.survey.theme_research',
};

/**
 * @param {string} themeId
 * @param {string} fallback
 */
function localizedThemeLabel(themeId, fallback) {
    const key = THEME_I18N_KEYS[themeId];
    return key ? oaaoT(key, fallback) : fallback;
}

/**
 * @returns {string}
 */
function wizardLocaleForApi() {
    const lang = oaaoResolveLang();
    return lang === 'zh-Hant' ? 'zh-Hant' : 'en';
}

function userApiUrl(action) {
    const rawMount = (document.body?.dataset?.oaaoMountPrefix ?? '').trim();
    const prefix = rawMount && rawMount !== '/' ? (rawMount.startsWith('/') ? rawMount : `/${rawMount}`) : '';
    return `${prefix}/user/api/${String(action).replace(/^\/+/, '')}`;
}

function ensureSurveyPanelStyles() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById(SURVEY_STYLE_ID);
    if (prev?.dataset.oaaoRev === SURVEY_STYLE_REV) return;
    prev?.remove();
    const style = document.createElement('style');
    style.id = SURVEY_STYLE_ID;
    style.dataset.oaaoRev = SURVEY_STYLE_REV;
    style.textContent = `
.oaao-survey-pack-card.is-selected,.oaao-survey-sample-card.is-selected{
  border-color:var(--grid-accent,#2563eb)!important;
  background:color-mix(in srgb,var(--grid-accent) 8%,var(--grid-paper))!important;
}
.oaao-survey-pack-card.is-selected .oaao-survey-pack-title,.oaao-survey-sample-card.is-selected .oaao-survey-sample-style{
  color:var(--grid-accent,#2563eb);
  font-weight:600;
}
.oaao-survey-sample-sep{border:none;border-top:1px solid var(--grid-line);margin:0}
.oaao-survey-style-head{display:flex;flex-direction:row;align-items:center;gap:0.5rem;min-width:0}
`;
    document.head.append(style);
}

/**
 * @param {HTMLElement} group
 */
function syncRadioCardSelection(group) {
    const name = group.dataset.oaaoSurveyRadio;
    if (!name) return;
    const root = group.closest('[data-oaao-survey-root]') ?? document;
    root.querySelectorAll(`[data-oaao-survey-radio="${name}"] label`).forEach((lbl) => {
        if (!(lbl instanceof HTMLElement)) return;
        const inp = lbl.querySelector('input[type="radio"]');
        lbl.classList.toggle('is-selected', inp instanceof HTMLInputElement && inp.checked);
    });
}

/**
 * @param {HTMLElement} mount
 * @param {Array<{ id?: string, label?: string, temperature?: number, top_p?: number }>} packs
 * @param {string} selectedPack
 */
function buildPackGrid(mount, packs, selectedPack) {
    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 sm:grid-cols-3 gap-2';
    grid.dataset.oaaoSurveyRadio = 'pack';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', oaaoT('preferences.survey.packs_title', 'Personality pack'));

    for (const pack of packs) {
        const id = String(pack.id ?? '');
        const label = document.createElement('label');
        label.className =
            'oaao-survey-pack-card flex flex-col gap-1 rounded-[10px] border border-solid border-[var(--grid-line)] px-3 py-2 cursor-pointer font-inherit';
        const inp = document.createElement('input');
        inp.type = 'radio';
        inp.name = 'oaao_survey_pack';
        inp.value = id;
        inp.className = 'sr-only';
        if (id && id === selectedPack) {
            inp.checked = true;
            label.classList.add('is-selected');
        }
        inp.addEventListener('change', () => syncRadioCardSelection(grid));
        const title = document.createElement('span');
        title.className = 'oaao-survey-pack-title text-[0.8125rem] fg-[var(--grid-ink)]';
        title.textContent = String(pack.label ?? id);
        const meta = document.createElement('span');
        meta.className = 'text-[0.6875rem] font-mono fg-[var(--grid-caption)]';
        meta.textContent = `temp ${pack.temperature ?? '—'} · top_p ${pack.top_p ?? '—'}`;
        label.append(inp, title, meta);
        grid.append(label);
    }
    mount.append(grid);
}

/**
 * @param {Record<string, number|null|undefined>} params
 */
function formatParamsSummary(params) {
    const keys = ['temperature', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty', 'max_tokens'];
    const parts = [];
    for (const k of keys) {
        if (params[k] !== null && params[k] !== undefined && params[k] !== '') {
            parts.push(`${k}=${params[k]}`);
        }
    }
    return parts.length ? parts.join(' · ') : oaaoT('preferences.survey.params_none', 'No overrides yet');
}

/**
 * @param {typeof import('../../razyui/razyui.js').default} razyui
 * @param {{ onApplied?: () => void }} opts
 */
async function openPersonalizationWizard(_razyui, opts = {}) {
    /**
     * Unwrapped Dialog ctor — {@link razyui.load('Dialog')} wraps the class and breaks private fields
     * ({@code TypeError: Cannot read from private field} at {@code getControl}).
     *
     * @see settings-dialog.js
     */
    const dialogHref = new URL('../razyui/component/Dialog.js', import.meta.url).href;
    const DialogMod = await import(dialogHref);
    const Dialog = DialogMod?.default;
    if (typeof Dialog !== 'function') {
        console.error('[oaao] survey wizard: Dialog missing', DialogMod);
        return;
    }

    /** @type {'intro'|'loading'|'question'} */
    let step = 'intro';
    let questionIndex = 0;
    /** @type {Array<{ id: string, label: string, step_index: number }>} */
    let guidedAnswers = [];
    let themeId = '';
    let themeLabel = '';
    let scenarioPrompt = '';
    /** @type {{ prompt: string, options: Array<{ id: string, label: string, hint?: string, sample?: string, model_params?: Record<string, number> }>, phase?: string, total_steps?: number } | null} */
    let currentQuestion = null;
    /** @type {Array<typeof currentQuestion>} */
    const questionCache = [];
    let finalizeRationale = '';
    /** @type {Record<string, number>} */
    let serverCumulativeParams = {};

    const body = document.createElement('div');
    body.className = 'flex flex-col gap-4 min-w-0';

    const stepHint = document.createElement('p');
    stepHint.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)]';

    const status = document.createElement('p');
    status.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)] min-h-[1rem]';

    const content = document.createElement('div');
    content.className = 'flex flex-col gap-3 min-h-[12rem]';

    const waveSection = document.createElement('div');
    waveSection.className = 'hidden flex flex-col gap-1 shrink-0 min-w-0';
    const waveCaption = document.createElement('p');
    waveCaption.className = 'm-0 text-[0.6875rem] fw-medium fg-[var(--grid-ink-muted)]';
    const waveHost = document.createElement('div');
    waveHost.className = 'min-h-[56px] w-full';
    waveSection.append(waveCaption, waveHost);

    /**
     * @param {string} [pendingOptionId]
     */
    function updateProfileWave(pendingOptionId = '') {
        const pendingId =
            pendingOptionId || (step === 'question' ? readSelectedGuidedId() : '');
        const optionRows =
            currentQuestion?.options?.map((o) => ({
                id: o.id,
                label: o.label,
                model_params: o.model_params,
            })) ?? [];
        /** @type {Record<string, number>} */
        let params;
        let waveOptionId = '';
        let waveExpressiveness = 0.5;
        const pendingLabel =
            currentQuestion?.options?.find((o) => o.id === pendingId)?.label ?? '';
        if (pendingId && step === 'question') {
            waveOptionId = pendingId;
            params = optionWaveParams(pendingId, optionRows, serverCumulativeParams);
            if (Object.keys(params).length < 2) {
                params = mergeGuidedProfileParams(
                    guidedAnswers.map((a) => ({ id: a.id })),
                    pendingId,
                    optionRows,
                );
            }
            waveExpressiveness = resolveStepOptionExpressiveness(
                pendingId,
                pendingLabel,
                params,
                optionRows,
            );
        } else if (Object.keys(serverCumulativeParams).length > 0) {
            params = { ...serverCumulativeParams };
        } else {
            params = mergeGuidedProfileParams(
                guidedAnswers.map((a) => ({ id: a.id })),
                '',
                optionRows,
            );
        }
        const hasProfile = Object.keys(params).length > 0;
        if ((step !== 'question' && step !== 'loading') || !hasProfile) {
            waveSection.classList.add('hidden');
            clearSurveyParamWave(waveHost);
            return;
        }
        waveSection.classList.remove('hidden');
        waveCaption.textContent =
            step === 'loading'
                ? oaaoT(
                      'preferences.survey.wizard_profile_wave_saved',
                      'Style profile updated from your choices',
                  )
                : pendingId
                  ? oaaoT(
                        'preferences.survey.wizard_profile_wave_preview',
                        'Preview — how your chat style profile looks with this option',
                    )
                  : oaaoT(
                        'preferences.survey.wizard_profile_wave',
                        'Your chat style profile so far',
                    );
        mountSurveyParamWave(waveHost, params, {
            compact: true,
            optionId: waveOptionId,
            expressiveness: waveExpressiveness,
        });
    }

    function setStepLabel() {
        if (step === 'intro' || step === 'loading') {
            stepHint.textContent = '';
            stepHint.hidden = true;
            return;
        }
        stepHint.hidden = false;
        if (step === 'question') {
            stepHint.textContent = oaaoT('preferences.survey.wizard_step_progress', 'Question {{current}} of {{total}}', {
                current: String(questionIndex + 1),
                total: String(GUIDED_TOTAL_STEPS),
            });
        } else {
            stepHint.textContent = '';
        }
    }

    function renderIntro() {
        content.replaceChildren();
        const lead = document.createElement('p');
        lead.className = 'm-0 text-[0.9375rem] leading-relaxed fg-[var(--grid-ink)]';
        lead.textContent = oaaoT(
            'preferences.survey.wizard_intro_body',
            'We will ask five short questions about how you like replies — no technical sliders.',
        );
        const sub = document.createElement('p');
        sub.className = 'm-0 text-[0.8125rem] leading-snug fg-[var(--grid-ink-muted)]';
        sub.textContent = oaaoT(
            'preferences.survey.wizard_intro_sub',
            'We use one everyday scenario for the whole run. Each option shows a different sample reply on that same topic so you can compare — then we set parameters automatically.',
        );
        content.append(lead, sub);
        waveSection.classList.add('hidden');
        clearSurveyParamWave(waveHost);
    }

    /**
     * @param {string} labelKey
     * @param {string} labelDefault
     * @param {boolean} [showProfileWave]
     */
    function renderLoading(labelKey, labelDefault, showProfileWave = false) {
        content.replaceChildren();
        const spin = document.createElement('div');
        spin.className = 'flex flex-col items-center justify-center gap-2 py-6';
        oaaoMountLoadingLogo(spin, { label: oaaoT(labelKey, labelDefault) });
        content.append(spin);
        if (showProfileWave) updateProfileWave();
        else waveSection.classList.add('hidden');
    }

    function renderQuestion() {
        content.replaceChildren();
        const q = currentQuestion;
        if (!q) return;

        if (scenarioPrompt) {
            const themeBadge = document.createElement('p');
            themeBadge.className = 'm-0 text-[0.6875rem] fw-medium fg-[var(--grid-accent)]';
            const badgeLabel = themeId ? localizedThemeLabel(themeId, themeLabel) : themeLabel;
            themeBadge.textContent = badgeLabel
                ? oaaoT('preferences.survey.wizard_theme_badge', 'Theme: {{label}}', { label: badgeLabel })
                : '';
            const scenario = document.createElement('p');
            scenario.className =
                'm-0 text-[0.75rem] leading-snug fg-[var(--grid-ink-muted)] rounded-[8px] border border-solid border-[var(--grid-line)] px-3 py-2 bg-[var(--grid-paper)]';
            scenario.textContent = scenarioPrompt;
            const compareHint = document.createElement('p');
            compareHint.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)]';
            compareHint.textContent = oaaoT(
                'preferences.survey.wizard_compare_samples',
                'Same situation below — compare how the assistant would reply in each style.',
            );
            content.append(themeBadge, scenario, compareHint);
        }

        const prompt = document.createElement('p');
        prompt.className = 'm-0 text-[0.9375rem] leading-relaxed fg-[var(--grid-ink)]';
        prompt.textContent = q.prompt;

        const list = document.createElement('div');
        list.className = 'flex flex-col gap-2 min-w-0';
        list.dataset.oaaoSurveyRadio = 'guided';
        list.setAttribute('role', 'radiogroup');

        const checkedId =
            guidedAnswers.find((a) => a.step_index === questionIndex)?.id ??
            (q.options[0]?.id ?? '');

        for (const row of q.options) {
            const palette = resolveOptionPalette(row.id, row.label);

            const lbl = document.createElement('label');
            lbl.className =
                'oaao-survey-sample-card flex flex-col gap-2 rounded-[10px] border border-solid border-[var(--grid-line)] px-3 py-2.5 cursor-pointer font-inherit text-left min-w-0';
            const inp = document.createElement('input');
            inp.type = 'radio';
            inp.name = 'oaao_survey_guided';
            inp.value = row.id;
            inp.className = 'sr-only';
            if (row.id === checkedId) {
                inp.checked = true;
                lbl.classList.add('is-selected');
            }
            inp.addEventListener('change', () => {
                syncRadioCardSelection(list);
                updateProfileWave(inp.value);
            });
            lbl.addEventListener('pointerdown', () => {
                updateProfileWave(row.id);
            });

            const styleHead = document.createElement('div');
            styleHead.className = 'oaao-survey-style-head';
            const swatchHost = document.createElement('span');
            swatchHost.className = 'inline-flex shrink-0';
            mountStyleEmotionSwatch(swatchHost, palette);
            const styleTitle = document.createElement('span');
            styleTitle.className = 'oaao-survey-sample-style text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] min-w-0';
            styleTitle.textContent = row.label || row.id;
            styleHead.append(swatchHost, styleTitle);

            const intro = document.createElement('span');
            intro.className = 'text-[0.75rem] leading-snug fg-[var(--grid-ink-muted)]';
            intro.textContent = row.hint ?? '';

            const sep = document.createElement('hr');
            sep.className = 'oaao-survey-sample-sep w-full';

            const sampleLabel = document.createElement('span');
            sampleLabel.className = 'text-[0.6875rem] fw-medium fg-[var(--grid-caption)]';
            sampleLabel.textContent = oaaoT('preferences.survey.wizard_sample_label', 'Sample reply');

            const sample = document.createElement('span');
            sample.className =
                'text-[0.8125rem] leading-snug fg-[var(--grid-ink)] whitespace-pre-wrap';
            sample.textContent = row.sample ?? '';

            lbl.append(inp, styleHead);
            if (row.hint) lbl.append(intro);
            lbl.append(sep, sampleLabel, sample);
            list.append(lbl);
        }
        content.append(prompt, list);
        const waveId =
            guidedAnswers.find((a) => a.step_index === questionIndex)?.id ?? checkedId;
        updateProfileWave(waveId || checkedId);
    }

    /** @type {InstanceType<typeof Dialog> | null} */
    let ctrl = null;

    function wizardDialogCtrl() {
        if (ctrl && typeof ctrl.getControl === 'function') {
            return ctrl.getControl();
        }
        return null;
    }

    /**
     * @param {number} stepIndex
     * @returns {Promise<void>}
     */
    async function fetchGuidedStep(stepIndex) {
        const res = await fetch(userApiUrl('personalization_survey_wizard_guided'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                step_index: stepIndex,
                answers: guidedAnswers,
                locale: wizardLocaleForApi(),
                theme_id: themeId || undefined,
                scenario_prompt: scenarioPrompt || undefined,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
            throw new Error(
                typeof json?.message === 'string' ? json.message : 'guided_step_failed',
            );
        }
        const data = json.data ?? {};
        const opts = Array.isArray(data.options) ? data.options : [];
        if (!opts.length) {
            throw new Error('guided_empty_options');
        }
        if (data.theme_id) themeId = String(data.theme_id);
        if (data.theme_label) themeLabel = String(data.theme_label);
        if (data.scenario_prompt) scenarioPrompt = String(data.scenario_prompt);
        const cum = data.cumulative_model_params;
        if (cum && typeof cum === 'object') {
            serverCumulativeParams = {};
            for (const [k, v] of Object.entries(cum)) {
                const n = Number(v);
                if (Number.isFinite(n)) serverCumulativeParams[k] = n;
            }
        }
        currentQuestion = {
            prompt: String(data.prompt ?? ''),
            options: opts.map((/** @type {Record<string, unknown>} */ row) => {
                const mp = row.model_params;
                /** @type {Record<string, number> | undefined} */
                let modelParams;
                if (mp && typeof mp === 'object') {
                    modelParams = {};
                    for (const [k, v] of Object.entries(mp)) {
                        const n = Number(v);
                        if (Number.isFinite(n)) modelParams[k] = n;
                    }
                }
                return {
                    id: String(row.id ?? ''),
                    label: String(row.label ?? row.id ?? ''),
                    hint: String(row.hint ?? ''),
                    sample: String(row.sample ?? row.text ?? ''),
                    model_params: modelParams,
                };
            }),
            phase: String(data.phase ?? 'question'),
            total_steps: Number(data.total_steps) || GUIDED_TOTAL_STEPS,
        };
        questionCache[stepIndex] = currentQuestion;
    }

    async function startGuidedWizard() {
        questionIndex = 0;
        guidedAnswers = [];
        questionCache.length = 0;
        currentQuestion = null;
        themeId = '';
        themeLabel = '';
        scenarioPrompt = '';
        serverCumulativeParams = {};
        step = 'loading';
        setStepLabel();
        status.textContent = oaaoT('preferences.survey.wizard_question_loading', 'Preparing your first question…');
        renderLoading('preferences.survey.wizard_question_loading', 'Preparing your first question…', false);
        wireButtons();
        try {
            await fetchGuidedStep(0);
            step = 'question';
            setStepLabel();
            status.textContent = oaaoT(
                'preferences.survey.wizard_pick_hint',
                'Read each sample reply on the same topic, then pick the one that feels best.',
            );
            renderQuestion();
            wireButtons();
            globalThis.JIT?.hydrate?.(content);
        } catch {
            status.textContent = oaaoT('preferences.survey.wizard_question_failed', 'Could not load questions.');
            step = 'intro';
            setStepLabel();
            renderIntro();
            wireButtons();
        }
    }

    /**
     * @returns {string}
     */
    function readSelectedGuidedId() {
        const inp = content.querySelector('input[name="oaao_survey_guided"]:checked');
        return inp instanceof HTMLInputElement ? inp.value : '';
    }

    /**
     * @returns {Promise<{ model_params: Record<string, number>, rationale?: string }>}
     */
    async function fetchGuidedFinalize(selectedId) {
        const res = await fetch(userApiUrl('personalization_survey_wizard_finalize'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                guided_answers: guidedAnswers,
                selected_id: selectedId,
                locale: wizardLocaleForApi(),
                theme_id: themeId,
                theme_label: themeLabel,
                scenario_prompt: scenarioPrompt,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success) {
            throw new Error(
                typeof json?.message === 'string' ? json.message : 'finalize_failed',
            );
        }
        const data = json.data ?? {};
        const mp = data.model_params && typeof data.model_params === 'object' ? data.model_params : {};
        /** @type {Record<string, number>} */
        const modelParams = {};
        for (const def of INFERENCE_PARAM_DEFS) {
            const v = mp[def.key];
            if (v === null || v === undefined || v === '') continue;
            const n = Number(v);
            if (Number.isFinite(n)) modelParams[def.key] = n;
        }
        const tags = Array.isArray(data.preference_tags) ? data.preference_tags.map(String) : [];
        return {
            model_params: modelParams,
            rationale: typeof data.rationale === 'string' ? data.rationale : '',
            preference_tags: tags,
            preference_tags_summary:
                typeof data.preference_tags_summary === 'string' ? data.preference_tags_summary : '',
            preference_system_instruction:
                typeof data.preference_system_instruction === 'string'
                    ? data.preference_system_instruction
                    : '',
        };
    }

    async function advanceGuided() {
        const pickedId = readSelectedGuidedId();
        if (!pickedId || !currentQuestion) {
            status.textContent = oaaoT('preferences.survey.wizard_pick_required', 'Pick one option first.');
            return false;
        }
        const picked = currentQuestion.options.find((o) => o.id === pickedId);
        guidedAnswers = guidedAnswers.filter((a) => a.step_index !== questionIndex);
        guidedAnswers.push({
            id: pickedId,
            label: picked?.label ?? pickedId,
            step_index: questionIndex,
        });
        guidedAnswers.sort((a, b) => a.step_index - b.step_index);

        const isLast = questionIndex >= GUIDED_TOTAL_STEPS - 1;
        if (isLast) {
            step = 'loading';
            setStepLabel();
            status.textContent = oaaoT(
                'preferences.survey.wizard_finalize_loading',
                'Setting your chat style from your answers…',
            );
            renderLoading(
                'preferences.survey.wizard_finalize_loading',
                'Setting your chat style from your answers…',
                true,
            );
            wireButtons();
            wizardDialogCtrl()?.setButtons?.([]);
            try {
                const fin = await fetchGuidedFinalize(pickedId);
                mountSurveyParamWave(waveHost, fin.model_params, { compact: true });
                waveSection.classList.remove('hidden');
                waveCaption.textContent = oaaoT(
                    'preferences.survey.wizard_profile_wave_final',
                    'Final style profile',
                );
                finalizeRationale = fin.rationale ?? '';
                await saveGuidedParams(fin.model_params, fin);
            } catch (err) {
                console.warn('[oaao] guided finalize failed', err);
                status.textContent = oaaoT('preferences.survey.save_failed', 'Save failed.');
                step = 'question';
                setStepLabel();
                if (questionCache[questionIndex]) {
                    currentQuestion = questionCache[questionIndex];
                    renderQuestion();
                }
                wireButtons();
            }
            return true;
        }

        questionIndex += 1;
        step = 'loading';
        setStepLabel();
        status.textContent = oaaoT('preferences.survey.wizard_question_loading', 'Preparing the next question…');
        renderLoading('preferences.survey.wizard_question_loading', 'Preparing the next question…', true);
        wireButtons();
        try {
            if (questionCache[questionIndex]) {
                currentQuestion = questionCache[questionIndex];
            } else {
                await fetchGuidedStep(questionIndex);
            }
            step = 'question';
            setStepLabel();
            status.textContent = oaaoT(
                'preferences.survey.wizard_pick_hint',
                'Read each sample reply on the same topic, then pick the one that feels best.',
            );
            renderQuestion();
            wireButtons();
            globalThis.JIT?.hydrate?.(content);
        } catch {
            status.textContent = oaaoT('preferences.survey.wizard_question_failed', 'Could not load questions.');
            questionIndex -= 1;
            guidedAnswers.pop();
            step = 'question';
            if (questionCache[questionIndex]) {
                currentQuestion = questionCache[questionIndex];
                renderQuestion();
            }
            wireButtons();
        }
        return true;
    }

    /**
     * @param {Record<string, number>} modelParams
     * @param {{ preference_tags?: string[], preference_tags_summary?: string, preference_system_instruction?: string }} [profile]
     */
    async function saveGuidedParams(modelParams, profile = {}) {
        status.textContent = oaaoT('preferences.survey.saving', 'Saving…');
        /** @type {Record<string, number|null>} */
        const toSave = {};
        for (const def of INFERENCE_PARAM_DEFS) {
            const v = modelParams[def.key];
            toSave[def.key] = v !== undefined && Number.isFinite(v) ? v : null;
        }
        const res = await fetch(userApiUrl('personalization_survey_save'), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                completed: true,
                model_params: toSave,
                locale: wizardLocaleForApi(),
                preference_profile: {
                    preference_tags: profile.preference_tags ?? [],
                    preference_tags_summary: profile.preference_tags_summary ?? '',
                    preference_system_instruction: profile.preference_system_instruction ?? '',
                },
                wizard: {
                    mode: 'guided',
                    theme_id: themeId,
                    theme_label: themeLabel,
                    scenario_prompt: scenarioPrompt,
                    guided_answers: guidedAnswers,
                    rationale: finalizeRationale,
                },
            }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
            throw new Error(typeof json?.message === 'string' ? json.message : 'save_failed');
        }
        status.textContent = finalizeRationale || oaaoT('preferences.survey.saved', 'Saved.');
        opts.onApplied?.();
        window.setTimeout(() => ctrl?.close?.(), 600);
    }

    /**
     * RazyUI Dialog footer buttons ({@code text}, {@code color}, {@code action}, {@code role}).
     *
     * @param {{ text: string, color?: string, role?: string, close?: boolean, action?: () => void | boolean | Promise<void | boolean> }} spec
     */
    function dlgBtn(spec) {
        /** @type {Record<string, unknown>} */
        const b = { text: spec.text };
        if (spec.color) b.color = spec.color;
        if (spec.role) b.role = spec.role;
        if (spec.close === false) b.close = false;
        if (spec.action) b.action = spec.action;
        return b;
    }

    function wireButtons() {
        const dc = wizardDialogCtrl();
        if (!dc?.setButtons) return;
        if (step === 'intro') {
            dc.setButtons([
                dlgBtn({ text: oaaoT('preferences.survey.wizard_cancel', 'Cancel'), color: 'muted', role: 'cancel' }),
                dlgBtn({
                    text: oaaoT('preferences.survey.wizard_skip', 'Skip for now'),
                    color: 'muted',
                    role: 'cancel',
                }),
                dlgBtn({
                    text: oaaoT('preferences.survey.wizard_start', 'Start'),
                    color: 'accent',
                    close: false,
                    action: () => {
                        void startGuidedWizard();
                    },
                }),
            ]);
        } else if (step === 'loading') {
            dc.setButtons([
                dlgBtn({ text: oaaoT('preferences.survey.wizard_cancel', 'Cancel'), color: 'muted', role: 'cancel' }),
            ]);
        } else if (step === 'question') {
            const isLast = questionIndex >= GUIDED_TOTAL_STEPS - 1;
            dc.setButtons([
                dlgBtn({
                    text: oaaoT('preferences.survey.wizard_back', 'Back'),
                    color: 'muted',
                    close: false,
                    action: () => {
                        if (questionIndex <= 0) {
                            step = 'intro';
                            guidedAnswers = [];
                            questionCache.length = 0;
                            currentQuestion = null;
                            setStepLabel();
                            status.textContent = '';
                            renderIntro();
                            wireButtons();
                            return;
                        }
                        guidedAnswers = guidedAnswers.filter((a) => a.step_index !== questionIndex);
                        questionIndex -= 1;
                        currentQuestion = questionCache[questionIndex] ?? null;
                        setStepLabel();
                        status.textContent = oaaoT(
                            'preferences.survey.wizard_pick_hint',
                            'Read each sample reply on the same topic, then pick the one that feels best.',
                        );
                        renderQuestion();
                        wireButtons();
                    },
                }),
                dlgBtn({
                    text: isLast
                        ? oaaoT('preferences.survey.wizard_apply', 'Apply & save')
                        : oaaoT('preferences.survey.wizard_next', 'Next'),
                    color: 'accent',
                    close: false,
                    action: () => {
                        void advanceGuided();
                    },
                }),
            ]);
        }
    }

    body.append(stepHint, content, waveSection, status);
    setStepLabel();
    renderIntro();

    ctrl = new Dialog({
        id: 'oaao-personalization-wizard',
        title: oaaoT('preferences.survey.wizard_title', 'Tune your chat style'),
        content: body,
        size: 'lg',
        width: 'min(640px, calc(100vw - 2rem))',
        closable: true,
        buttons: [
            dlgBtn({ text: oaaoT('preferences.survey.wizard_cancel', 'Cancel'), color: 'muted', role: 'cancel' }),
            dlgBtn({
                text: oaaoT('preferences.survey.wizard_start', 'Start'),
                color: 'accent',
                close: false,
                action: () => {
                    void startGuidedWizard();
                },
            }),
        ],
        onOpen() {
            wireButtons();
            globalThis.JIT?.hydrate?.(body);
        },
    });
    ctrl.open();
}

/**
 * @param {HTMLElement} host
 * @param {{ section?: { section_id?: string }, razyui?: typeof import('../../razyui/razyui.js').default, JIT?: { hydrate?: (el: HTMLElement) => void } }} [ctx]
 */
export async function mountPreferencesPanel(host, ctx = {}) {
    if (!(host instanceof HTMLElement)) return;
    ensureSurveyPanelStyles();
    host.replaceChildren();
    oaaoMountLoadingLogo(host, { label: oaaoT('preferences.survey.loading', 'Loading…') });

    const razyui = ctx.razyui;
    if (!razyui || typeof razyui.load !== 'function') {
        host.replaceChildren();
        const err = document.createElement('p');
        err.className = 'text-sm fg-[var(--grid-caution,#b45309)] m-0';
        err.textContent = oaaoT('preferences.survey.ui_unavailable', 'Preferences UI is not ready. Reload the page.');
        host.append(err);
        return;
    }

    try {
        const res = await fetch(userApiUrl('personalization_survey'), { credentials: 'same-origin' });
        const json = await res.json();
        host.replaceChildren();
        if (!res.ok || !json?.success) {
            const err = document.createElement('p');
            err.className = 'text-sm fg-[var(--grid-caution,#b45309)] m-0';
            err.textContent = json?.message || oaaoT('preferences.survey.load_failed', 'Could not load survey.');
            host.append(err);
            return;
        }

        const data = json.data ?? {};
        const packs = Array.isArray(data.personality_packs) ? data.personality_packs : [];
        const selectedPack = data.selected_pack != null ? String(data.selected_pack) : '';
        const modelParams =
            data.model_params && typeof data.model_params === 'object'
                ? /** @type {Record<string, number|null>} */ (data.model_params)
                : {};

        const wrap = document.createElement('div');
        wrap.className = 'flex flex-col gap-md min-w-0 max-w-xl';
        wrap.dataset.oaaoSurveyRoot = '1';

        const intro = document.createElement('p');
        intro.className = 'text-[0.8125rem] fg-[var(--grid-ink-muted)] leading-snug m-0';
        intro.textContent = oaaoT(
            'preferences.survey.intro_wizard',
            'Run the wizard: one shared scenario, sample replies per choice, then auto-set chat parameters.',
        );
        wrap.append(intro);

        if (data.completed) {
            const done = document.createElement('p');
            done.className = 'text-[0.75rem] fg-[var(--grid-accent)] m-0';
            done.textContent = oaaoT('preferences.survey.completed_badge', 'Tuning saved — run the wizard again anytime.');
            wrap.append(done);
        }

        const profile = data.preference_profile && typeof data.preference_profile === 'object'
            ? data.preference_profile
            : {};
        const tags = Array.isArray(profile.tags) ? profile.tags.map(String) : [];

        const tagsWrap = document.createElement('div');
        tagsWrap.className = 'flex flex-wrap gap-1.5 min-w-0';
        tagsWrap.dataset.oaaoSurveyTags = '1';
        const renderTagChips = (/** @type {string[]} */ list) => {
            tagsWrap.replaceChildren();
            if (!list.length) {
                const empty = document.createElement('span');
                empty.className = 'text-[0.75rem] fg-[var(--grid-caption)]';
                empty.textContent = oaaoT(
                    'preferences.survey.tags_empty',
                    'No style tags yet — run the wizard to generate your profile.',
                );
                tagsWrap.append(empty);
                return;
            }
            for (const tag of list) {
                const chip = document.createElement('span');
                chip.className =
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[0.6875rem] fw-medium bg-[var(--grid-paper)] border border-solid border-[var(--grid-line)] fg-[var(--grid-ink)]';
                chip.textContent = tag.startsWith('#') ? tag : `#${tag}`;
                tagsWrap.append(chip);
            }
        };
        renderTagChips(tags);

        const tagsSummary = document.createElement('p');
        tagsSummary.className = 'text-[0.75rem] fg-[var(--grid-ink-muted)] m-0';
        tagsSummary.dataset.oaaoSurveyTagsSummary = '1';
        tagsSummary.textContent =
            typeof profile.summary === 'string' && profile.summary
                ? profile.summary
                : oaaoT('preferences.survey.tags_summary_label', 'Style summary');

        const paramsLine = document.createElement('p');
        paramsLine.className = 'text-[0.75rem] font-mono fg-[var(--grid-caption)] m-0';
        paramsLine.dataset.oaaoSurveyParamsSummary = '1';
        paramsLine.textContent = formatParamsSummary(modelParams);

        wrap.append(tagsSummary, tagsWrap, paramsLine);

        if (packs.length) {
            const packsLabel = document.createElement('p');
            packsLabel.className = 'text-[0.8125rem] fw-medium fg-[var(--grid-ink)] m-0 mt-2';
            packsLabel.textContent = oaaoT(
                'preferences.survey.personality_packs',
                'Quick personality packs',
            );
            const packRow = document.createElement('div');
            packRow.className = 'flex flex-wrap gap-2';
            for (const pack of packs) {
                const pid = String(pack.id ?? '');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className =
                    'rounded-[8px] h-8 px-3 text-[0.75rem] border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] cursor-pointer font-inherit fg-[var(--grid-ink)]';
                if (pid && pid === selectedPack) {
                    btn.classList.add('border-[var(--grid-accent)]', 'fg-[var(--grid-accent)]');
                }
                btn.textContent = String(pack.label ?? pid);
                btn.addEventListener('click', async () => {
                    try {
                        const r = await fetch(userApiUrl('personalization_survey_save'), {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ selected_pack: pid, completed: true }),
                        });
                        const j = await r.json();
                        if (r.ok && j?.success) {
                            const mp = j.data?.model_params ?? {};
                            paramsLine.textContent = formatParamsSummary(
                                /** @type {Record<string, number|null>} */ (mp),
                            );
                            const prof = j.data?.preference_profile ?? {};
                            if (Array.isArray(prof.tags)) renderTagChips(prof.tags.map(String));
                        }
                    } catch {
                        /* ignore */
                    }
                });
                packRow.append(btn);
            }
            wrap.append(packsLabel, packRow);
        }

        const wizardBtn = document.createElement('button');
        wizardBtn.type = 'button';
        wizardBtn.className =
            'self-start rounded-[8px] h-9 px-4 text-[0.8125rem] fw-medium border-none bg-[var(--grid-accent)] fg-white cursor-pointer font-inherit';
        wizardBtn.textContent = oaaoT('preferences.survey.wizard_open', 'Open tuning wizard');
        wizardBtn.addEventListener('click', () => {
            void openPersonalizationWizard(razyui, {
                onApplied: async () => {
                    try {
                        const r = await fetch(userApiUrl('personalization_survey'), { credentials: 'same-origin' });
                        const j = await r.json();
                        if (r.ok && j?.success && paramsLine.isConnected) {
                            const mp = j.data?.model_params ?? {};
                            paramsLine.textContent = formatParamsSummary(
                                /** @type {Record<string, number|null>} */ (mp),
                            );
                            const prof = j.data?.preference_profile ?? {};
                            if (tagsWrap.isConnected && Array.isArray(prof.tags)) {
                                renderTagChips(prof.tags.map(String));
                            }
                            if (tagsSummary.isConnected && typeof prof.summary === 'string') {
                                tagsSummary.textContent = prof.summary || tagsSummary.textContent;
                            }
                        }
                    } catch {
                        /* ignore */
                    }
                },
            });
        });
        wrap.append(wizardBtn);

        const packLegend = document.createElement('p');
        packLegend.className = 'text-[0.8125rem] fw-semibold fg-[var(--grid-ink)] m-0 pt-2';
        packLegend.textContent = oaaoT('preferences.survey.packs_title', 'Quick preset (optional)');
        wrap.append(packLegend);

        const packMount = document.createElement('div');
        buildPackGrid(packMount, packs, selectedPack);
        wrap.append(packMount);

        const status = document.createElement('p');
        status.className = 'm-0 text-[0.75rem] fg-[var(--grid-caption)] min-h-[1rem]';
        status.id = 'oaao-survey-status';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className =
            'self-start rounded-[8px] h-9 px-4 text-[0.8125rem] fw-medium border border-solid border-[var(--grid-line)] bg-[var(--grid-paper)] fg-[var(--grid-ink)] cursor-pointer font-inherit';
        saveBtn.textContent = oaaoT('preferences.survey.save_pack', 'Save preset only');
        saveBtn.addEventListener('click', async () => {
            status.textContent = oaaoT('preferences.survey.saving', 'Saving…');
            const packInp = packMount.querySelector('input[name="oaao_survey_pack"]:checked');
            try {
                const r = await fetch(userApiUrl('personalization_survey_save'), {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        selected_pack: packInp instanceof HTMLInputElement ? packInp.value : '',
                        completed: true,
                    }),
                });
                const j = await r.json();
                if (!r.ok || !j?.success) {
                    status.textContent = j?.message || oaaoT('preferences.survey.save_failed', 'Save failed.');
                    return;
                }
                status.textContent = oaaoT('preferences.survey.saved', 'Saved.');
                if (j.data?.model_params && paramsLine.isConnected) {
                    paramsLine.textContent = formatParamsSummary(j.data.model_params);
                }
            } catch {
                status.textContent = oaaoT('preferences.survey.save_failed', 'Save failed.');
            }
        });

        wrap.append(status, saveBtn);
        host.append(wrap);
        ctx.JIT?.hydrate?.(host);
    } catch {
        host.replaceChildren();
        const err = document.createElement('p');
        err.className = 'text-sm fg-[var(--grid-caution,#b45309)] m-0';
        err.textContent = oaaoT('preferences.survey.load_failed', 'Could not load survey.');
        host.append(err);
    }
}

export function teardownPreferencesPanel() {}
