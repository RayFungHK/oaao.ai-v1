/**
 * Mic split-button dropdown — audio input device picker (workspace picker pattern).
 */
import { listLiveMeetingAudioInputs, warmLiveMeetingMicPermission } from './live-meeting-audio.js';
import { hydrateLiveMeetingJit } from './live-meeting-jit.js';

const STORAGE_KEY = 'oaao_live_meeting_audio_input';

/** @param {MediaDeviceInfo[]} devices */
function devicesNeedPermissionUnlock(devices) {
    if (!devices.length) return true;
    return devices.every((d) => !String(d.label || '').trim());
}

/** Lucide check — selected row indicator (matches shell inline SVG style). */
const AUDIO_INPUT_TICK_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * @param {HTMLElement} mount
 * @param {{
 *   signal?: AbortSignal,
 *   t?: (key: string, _fallback?: string, vars?: Record<string, string>) => string,
 *   isRecording?: () => boolean,
 *   onSelectionChange?: (deviceId: string, label: string) => void,
 * }} [opts]
 */
export function wireLiveMeetingAudioInputPicker(mount, opts = {}) {
    const trigger = mount.querySelector('[data-oaao-live-meeting="audio-input-trigger"]');
    const anchor = mount.querySelector('[data-oaao-live-meeting="audio-input-anchor"]');
    const panel = mount.querySelector('[data-oaao-live-meeting="audio-input-panel"]');
    if (
        !(trigger instanceof HTMLButtonElement)
        || !(anchor instanceof HTMLElement)
        || !(panel instanceof HTMLElement)
        || trigger.dataset.oaaoLiveAudioPickerBound === '1'
    ) {
        const noop = async () => {};
        return {
            getSelectedDeviceId: () => '',
            getSelectedLabel: () => '',
            refreshDevices: noop,
            closePanel: () => {},
            setDeviceId: () => {},
            setRecordingLock: () => {},
        };
    }
    trigger.dataset.oaaoLiveAudioPickerBound = '1';

    const t =
        typeof opts.t === 'function'
            ? opts.t
            : (key, _fb = '', vars = {}) => {
                  let s = key;
                  Object.entries(vars).forEach(([k, v]) => {
                      s = s.split(`{{${k}}}`).join(String(v));
                  });
                  return s;
              };
    const isRecording = typeof opts.isRecording === 'function' ? opts.isRecording : () => false;

    /** @type {{ deviceId: string, label: string }[]} */
    let rows = [];
    let selectedDeviceId = readStoredDeviceId();
    let micPermissionDenied = false;

    function readStoredDeviceId() {
        try {
            return String(sessionStorage.getItem(STORAGE_KEY) || '').trim();
        } catch {
            return '';
        }
    }

    function persistDeviceId(deviceId) {
        selectedDeviceId = String(deviceId || '').trim();
        try {
            if (selectedDeviceId) {
                sessionStorage.setItem(STORAGE_KEY, selectedDeviceId);
            } else {
                sessionStorage.removeItem(STORAGE_KEY);
            }
        } catch {
            /* ignore */
        }
        syncTriggerTitle();
    }

    function selectedLabel() {
        if (!selectedDeviceId) {
            return t('live_meeting.audio_input.default');
        }
        const hit = rows.find((row) => row.deviceId === selectedDeviceId);
        return hit?.label || t('live_meeting.audio_input.unknown', '', { n: '?' });
    }

    function syncTriggerTitle() {
        const label = selectedLabel();
        trigger.title = `${t('live_meeting.audio_input.label')}: ${label}`;
        trigger.setAttribute('aria-label', trigger.title);
    }

    function closePanel() {
        anchor.hidden = true;
        anchor.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
    }

    function openPanel() {
        anchor.hidden = false;
        anchor.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
    }

    function isOpen() {
        return !anchor.hidden && !anchor.classList.contains('hidden');
    }

    async function renderPanel() {
        panel.textContent = '';
        const rowBtnClass =
            'w-full flex items-center gap-1.5 min-w-0 px-2 py-1.5 rounded-[6px] border-none bg-transparent fg-[var(--grid-ink)] text-[0.8125rem] text-left cursor-pointer font-inherit hover:bg-[var(--grid-line)]/35';
        const rowBtnSelectedClass = ' bg-[var(--grid-line)]/45 fw-medium';

        const addRow = (deviceId, label) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'option');
            btn.dataset.oaaoLiveAudioDeviceId = deviceId;
            const selected = deviceId === selectedDeviceId;
            btn.className = rowBtnClass + (selected ? rowBtnSelectedClass : '');
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');

            const tick = document.createElement('span');
            tick.className =
                'inline-flex shrink-0 w-3.5 h-3.5 items-center justify-center fg-[var(--grid-ink)]';
            tick.setAttribute('aria-hidden', 'true');
            if (selected) {
                tick.innerHTML = AUDIO_INPUT_TICK_SVG;
            }

            const labelEl = document.createElement('span');
            labelEl.className = 'truncate min-w-0 flex-1';
            labelEl.textContent = label;
            btn.append(tick, labelEl);
            btn.addEventListener('click', () => {
                if (isRecording()) return;
                persistDeviceId(deviceId);
                if (typeof opts.onSelectionChange === 'function') {
                    opts.onSelectionChange(deviceId, label);
                }
                closePanel();
            });
            panel.append(btn);
        };

        if (rows.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'm-0 px-2 py-1.5 text-[0.8125rem] fg-[var(--grid-ink-muted)]';
            empty.textContent = micPermissionDenied
                ? t('live_meeting.audio_input.permission_denied')
                : t('live_meeting.audio_input.none');
            panel.append(empty);
        } else {
            addRow('', t('live_meeting.audio_input.default'));
            rows.forEach((row) => addRow(row.deviceId, row.label));
        }

        trigger.disabled = isRecording();
        void hydrateLiveMeetingJit(panel);
    }

    async function refreshDevices({ preferStored = true, warmPermission = false } = {}) {
        const previous = selectedDeviceId || (preferStored ? readStoredDeviceId() : '');
        micPermissionDenied = false;
        let devices = await listLiveMeetingAudioInputs();
        if (warmPermission && devicesNeedPermissionUnlock(devices)) {
            const warm = await warmLiveMeetingMicPermission();
            if (!warm.ok && warm.reason === 'denied') {
                micPermissionDenied = true;
                rows = [];
                selectedDeviceId = '';
                syncTriggerTitle();
                if (isOpen()) {
                    await renderPanel();
                }
                return;
            }
            devices = await listLiveMeetingAudioInputs();
        }
        rows = devices
            .filter((device) => String(device.deviceId || '').trim() !== '')
            .map((device, index) => ({
                deviceId: device.deviceId,
                label:
                    String(device.label || '').trim()
                    || t('live_meeting.audio_input.unknown', '', { n: String(index + 1) }),
            }));

        const stored = preferStored ? readStoredDeviceId() : '';
        const next =
            (previous && (previous === '' || rows.some((row) => row.deviceId === previous)) ? previous : '')
            || (stored && (stored === '' || rows.some((row) => row.deviceId === stored)) ? stored : '')
            || '';
        selectedDeviceId = next;
        syncTriggerTitle();
        if (isOpen()) {
            await renderPanel();
        }
    }

    trigger.addEventListener(
        'click',
        (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isRecording()) return;
            if (isOpen()) {
                closePanel();
                return;
            }
            openPanel();
            void refreshDevices({ preferStored: true, warmPermission: true }).then(() => renderPanel());
        },
        { signal: opts.signal },
    );

    document.addEventListener(
        'click',
        (e) => {
            if (!isOpen()) return;
            const target = e.target;
            if (!(target instanceof Node)) return;
            if (trigger.contains(target) || anchor.contains(target)) return;
            closePanel();
        },
        { signal: opts.signal },
    );

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Escape') closePanel();
        },
        { signal: opts.signal },
    );

    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
            void refreshDevices({ preferStored: true });
        });
    }

    void refreshDevices({ preferStored: true });

    return {
        getSelectedDeviceId: () => selectedDeviceId,
        getSelectedLabel: selectedLabel,
        refreshDevices,
        closePanel,
        setDeviceId: (deviceId, label = '') => {
            persistDeviceId(deviceId);
            if (label && deviceId) {
                const idx = rows.findIndex((row) => row.deviceId === deviceId);
                if (idx >= 0) {
                    rows[idx].label = label;
                } else {
                    rows.push({ deviceId, label });
                }
            }
        },
        setRecordingLock: (locked) => {
            trigger.disabled = !!locked;
            if (locked) closePanel();
        },
    };
}
