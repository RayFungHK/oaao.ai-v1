/**
 * Confirm / dismiss on inline productivity fence panels (same strip API as [strip] chips).
 *
 * @module productivity-fence-actions
 */

import {
    findStripItemForFenceKind,
    mountProductivityFenceStripActions,
} from './strip-chip-shell.js?v=20260530-fence-actions-v211';

/**
 * @param {HTMLElement} fenceHost
 * @param {{ kind: 'calendar' | 'todo', state: string }} section
 * @param {{
 *   meta?: Record<string, unknown> | null,
 *   conversationId?: number,
 *   messageId?: number,
 *   stripShellCtx?: Record<string, unknown>,
 * }} [opts]
 */
export function attachProductivityFenceActions(fenceHost, section, opts = {}) {
    if (!(fenceHost instanceof HTMLElement)) return;
    if (section.state === 'confirmed' || section.state === 'dismissed') return;

    const meta = opts.meta;
    if (!meta || typeof meta !== 'object') return;

    const cid = Math.floor(Number(opts.conversationId ?? 0));
    const mid = Math.floor(Number(opts.messageId ?? 0));
    if (cid < 1 || mid < 1) return;

    const item = findStripItemForFenceKind(meta, section.kind);
    if (!item) return;

    mountProductivityFenceStripActions(
        fenceHost,
        item,
        cid,
        mid,
        opts.stripShellCtx && typeof opts.stripShellCtx === 'object' ? opts.stripShellCtx : {},
    );
}
