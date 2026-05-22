/**
 * Mirrors the old `vite build` deploy without re-bundling RazyUI.
 * RazyUI’s dist layout (`razyui.js` + `chunks/` + `component/`) must stay intact so
 * `import("../component/JIT.js")` and modulepreload URLs resolve from `chunks/index-*.js`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viteDir = path.resolve(__dirname, '..');
const webassets = path.resolve(viteDir, '../default/webassets');
const publicDir = path.resolve(viteDir, 'public');
const razyRoot = path.resolve(viteDir, '../../../../../../../RazyUI-v2');
const razyDist = path.join(razyRoot, 'dist');

if (!fs.existsSync(razyDist)) {
    console.error(`Missing ${razyDist}. Run: npm run prebuild`);
    process.exit(1);
}

for (const name of fs.readdirSync(webassets)) {
    fs.rmSync(path.join(webassets, name), { recursive: true, force: true });
}

fs.cpSync(publicDir, webassets, { recursive: true });
fs.cpSync(razyDist, path.join(webassets, 'razyui'), { recursive: true });

/** RazyUI icon font (`ri-*`) — not bundled into {@code dist/razyui.css}; ship alongside shell CSS. */
const npmRazyRoot = path.join(viteDir, 'node_modules', 'razyui');
const iconsCssCandidates = [
    path.join(razyRoot, 'src/sass/component/razyui-icons.css'),
    path.join(npmRazyRoot, 'src/sass/component/razyui-icons.css'),
];
const iconsFontsCandidates = [
    path.join(razyRoot, 'src/sass/fonts'),
    path.join(npmRazyRoot, 'src/sass/fonts'),
];
const iconsCssSrc = iconsCssCandidates.find((p) => fs.existsSync(p)) ?? iconsCssCandidates[0];
const iconsFontsDir = iconsFontsCandidates.find((p) => fs.existsSync(p)) ?? iconsFontsCandidates[0];
const webCssDir = path.join(webassets, 'css');
const webFontsDir = path.join(webassets, 'fonts');
if (fs.existsSync(iconsCssSrc)) {
    fs.mkdirSync(webCssDir, { recursive: true });
    fs.mkdirSync(webFontsDir, { recursive: true });
    const iconsCssDest = path.join(webCssDir, 'razyui-icons.css');
    let iconsCssText = fs.readFileSync(iconsCssSrc, 'utf8');
    /** Upstream uses {@code font-display: block} — rail glyphs stay blank until font loads; swap matches shell UX. */
    iconsCssText = iconsCssText.replace(/font-display:\s*block/gi, 'font-display: swap');
    iconsCssText = iconsCssText.replace(/\bspeak:\s*never\b/gi, 'speak: none');
    fs.writeFileSync(iconsCssDest, iconsCssText);
    for (const ext of ['woff2', 'woff', 'ttf']) {
        const base = `razyui-icons.${ext}`;
        const from = path.join(iconsFontsDir, base);
        if (fs.existsSync(from)) {
            fs.copyFileSync(from, path.join(webFontsDir, base));
        }
    }
}

console.log('webassets synced (public + RazyUI-v2/dist → razyui/ + razyui-icons)');
