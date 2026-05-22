/**
 * Loads the SPA shell, signs in when the login view is visible, opens Admin Settings → Endpoints,
 * and fails if any request under {@code /webassets/} returns 404. Run against a running Apache stack
 * (e.g. {@code http://127.0.0.1:8080}). One-time deps: {@code cd core/vite && npx playwright install chromium}.
 *
 * Env: {@code OAAO_SMOKE_BASE_URL} (default {@code http://127.0.0.1:8080/}), {@code OAAO_SMOKE_USER}, {@code OAAO_SMOKE_PASS}.
 */
import { chromium } from 'playwright';

const BASE = (
    typeof process.env.OAAO_SMOKE_BASE_URL === 'string' && process.env.OAAO_SMOKE_BASE_URL.trim() !== ''
        ? process.env.OAAO_SMOKE_BASE_URL.trim()
        : 'http://127.0.0.1:8080/'
).replace(/\/?$/, '/');

const USER = process.env.OAAO_SMOKE_USER ?? 'admin';
const PASS = process.env.OAAO_SMOKE_PASS ?? '12345678';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const failures = [];
/** @type {string[]} */
const consoleErrors = [];

page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
});

page.on('response', (res) => {
    try {
        const u = res.url();
        if (res.status() === 404 && u.includes('/webassets/')) {
            failures.push(u);
        }
    } catch {
        //
    }
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });

await page
    .waitForFunction(
        () =>
            document.body?.classList?.contains('oaao-session-active') === true ||
            Boolean(document.getElementById('login-form')),
        null,
        { timeout: 30_000 },
    )
    .catch(() => {});

const rootDataset = await page.evaluate(() => document.body?.dataset?.oaaoCoreWebassetsRoot ?? '');
console.log('[smoke] data-oaao-core-webassets-root =', rootDataset || '(empty)');
if (/\/webassets\/(core|chat|endpoints|vault)\/[^/]+\/webassets\b/.test(String(rootDataset))) {
    console.warn('[smoke] root may violate rewrite (/…/version/webassets in URL pathname):', rootDataset);
}

const sessionActive = await page.evaluate(() => document.body?.classList?.contains('oaao-session-active') === true);
if (!sessionActive) {
    const emailInput = page.locator('#login-email-host').locator('input');
    await emailInput.waitFor({ state: 'visible', timeout: 60_000 });
    await emailInput.fill(USER);
    await page.locator('#login-password-host').locator('input').fill(PASS);
    await page.locator('#login-submit').click();
    await page.waitForFunction(() => document.body?.classList?.contains('oaao-session-active') === true, null, {
        timeout: 60_000,
    });
}

const settingsRail = page.locator('#workspace-rail-settings');
if (!(await settingsRail.isVisible().catch(() => false))) {
    console.warn('[smoke] #workspace-rail-settings not visible (not admin?). Skipping settings deep-link.');
    await browser.close();
    process.exit(0);
}

await settingsRail.click();
await page.locator('[data-settings-nav="settings-endpoints"]').waitFor({ state: 'visible', timeout: 20_000 });
await page.locator('[data-settings-nav="settings-endpoints"]').click();

await page.waitForTimeout(5000);

await browser.close();

const uniq = [...new Set(failures)];
if (uniq.length > 0) {
    console.error('[smoke] webassets 404 count:', uniq.length);
    for (const u of uniq) console.error('  ', u);
    if (consoleErrors.length > 0) {
        console.error('[smoke] sample browser console errors:');
        for (const line of consoleErrors.slice(0, 12)) console.error('  ', line);
    }
    process.exit(1);
}

console.log('[smoke] ok — no /webassets/ 404 after login + settings-endpoints');
process.exit(0);
