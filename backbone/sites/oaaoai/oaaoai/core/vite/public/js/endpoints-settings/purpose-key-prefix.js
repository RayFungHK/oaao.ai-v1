/**
 * First segment of {@code purpose_key} for matching {@code endpoint_type} tags (e.g. {@code embedding.primary} → {@code embedding}).
 *
 * Kept in a tiny module so callers never hit duplicate-export hazards in the large view bundle.
 *
 * @param {string} purposeKey
 * @returns {string}
 */
export function purposeKeyToEndpointFilterPrefix(purposeKey) {
    const s = String(purposeKey ?? '').trim();
    if (!s) return '';

    return s.split('.')[0].split(':')[0].trim() || '';
}
