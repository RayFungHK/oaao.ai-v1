/**
 * Platform sidemenu panel — cross-tenant usage summary.
 */
export async function mountSettingsPanel(host, ctx = {}) {
    return mountPlatformUsagePanel(host, ctx);
}

export async function mountPlatformUsagePanel(host, { signal } = {}) {
    if (!(host instanceof HTMLElement)) return;

    host.textContent = '';
    const loading = document.createElement('p');
    loading.className = 'text-sm fg-[var(--grid-ink-muted)]';
    loading.textContent = 'Loading usage…';
    host.append(loading);

    try {
        const res = await fetch('/platform/api/usage_summary', { credentials: 'same-origin', signal });
        const json = await res.json();
        host.textContent = '';

        if (!res.ok || !json?.success) {
            const err = document.createElement('p');
            err.className = 'text-sm fg-[var(--grid-danger)]';
            err.textContent = json?.message || `HTTP ${res.status}`;
            host.append(err);
            return;
        }

        const tenants = Array.isArray(json.data?.tenants) ? json.data.tenants : [];

        const title = document.createElement('div');
        title.className = 'oaao-sdlg-section-title mb-sm';
        title.textContent = 'Cross-tenant usage';
        host.append(title);

        const intro = document.createElement('p');
        intro.className = 'text-xs fg-[var(--grid-ink-muted)] mb-md';
        intro.textContent = 'Aggregate counts per customer tenant (platform tenant excluded from day-to-day product use).';
        host.append(intro);

        if (tenants.length === 0) {
            host.append(emptyNote('No tenant usage data yet.'));
            return;
        }

        const table = document.createElement('div');
        table.className = 'flex flex-col gap-2';
        for (const row of tenants) {
            if (String(row.kind || '') === 'platform') continue;
            table.append(buildUsageRow(row));
        }
        if (!table.childElementCount) {
            host.append(emptyNote('No customer tenant usage yet.'));
            return;
        }
        host.append(table);
    } catch (e) {
        if (e?.name === 'AbortError') return;
        host.textContent = '';
        host.append(errorText('Could not load usage summary.'));
    }
}

/** @param {Record<string, unknown>} row */
function buildUsageRow(row) {
    const card = document.createElement('div');
    card.className =
        'rounded-[10px] border-[1px] border-solid border-[var(--grid-line)] p-3 bg-[var(--grid-paper)] text-sm';
    const slug = escapeHtml(String(row.slug || ''));
    const name = escapeHtml(String(row.display_name || row.slug || ''));
    const status = escapeHtml(String(row.status || ''));
    card.innerHTML = `<div class="fw-semibold">${name}</div>
        <div class="text-xs fg-[var(--grid-caption)] mt-1">${slug} · ${status}</div>
        <div class="text-xs fg-[var(--grid-ink-muted)] mt-2">Users: ${row.user_count ?? '—'} · Vaults: ${row.vault_count ?? '—'} · Events: ${row.usage_events ?? '—'}</div>`;
    return card;
}

function emptyNote(text) {
    const p = document.createElement('p');
    p.className = 'text-sm fg-[var(--grid-ink-muted)] mt-md';
    p.textContent = text;
    return p;
}

function errorText(text) {
    const p = document.createElement('p');
    p.className = 'text-sm fg-[var(--grid-danger)]';
    p.textContent = text;
    return p;
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default mountSettingsPanel;
