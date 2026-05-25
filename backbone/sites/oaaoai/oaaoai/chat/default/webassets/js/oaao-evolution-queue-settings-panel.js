/**
 * Legacy path shim — frozen SPA registry may still reference {@code /webassets/chat/default/js/…}.
 * Re-export from core webassets ({@see oaao-evolution-queue-settings-panel.js}).
 */
export { mountSettingsPanel, teardownSettingsPanel } from '../../../core/default/js/oaao-evolution-queue-settings-panel.js';
