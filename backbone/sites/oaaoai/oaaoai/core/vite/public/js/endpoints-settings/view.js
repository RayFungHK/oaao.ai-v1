/**
 * Compatibility shim — stale caches may resolve {@code ./view.js}.
 * Prefer {@link ./endpoints-settings-view.js}; {@link ./purpose-key-prefix.js} for purpose-key helpers.
 *
 * @deprecated
 */
export * from './endpoints-settings-view.js';
