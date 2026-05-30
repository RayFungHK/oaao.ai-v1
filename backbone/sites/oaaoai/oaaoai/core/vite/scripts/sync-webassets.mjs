/**
 * Mirrors the old `vite build` deploy without re-bundling RazyUI.
 * RazyUI’s dist layout (`razyui.js` + `chunks/` + `component/`) must stay intact so
 * `import("../component/JIT.js")` and modulepreload URLs resolve from `chunks/index-*.js`.
 * After `npm run build:all` in RazyUI-v2, bump {@code OAAO_SHELL_ESM_V} / {@code $oaaoShellEsmRev} so browsers drop stale chunk hashes.
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
const razyCss = path.join(razyDist, 'razyui.css');

/** Abort before wiping webassets if RazyUI dist is incomplete (e.g. build:css only, failed vite). */
function validateRazyDist(distDir) {
    const required = [
        'razyui.js',
        'razyui.css',
        'component/Combobox.js',
        'component/Dialog.js',
        'component/Uploader.js',
        'component/BlockEditor.js',
        'chunks/index-Bdi4asOu.js',
        'chunks/outsideClick-ClYYJ9O-.js',
    ];
    const missing = required.filter((rel) => !fs.existsSync(path.join(distDir, rel)));
    if (missing.length > 0) {
        console.error('[sync-webassets] RazyUI dist incomplete — missing:');
        for (const rel of missing) console.error(`  ${rel}`);
        console.error('Run: cd RazyUI-v2 && npm install && npm run build:all');
        process.exit(1);
    }

    const chunksDir = path.join(distDir, 'chunks');
    if (fs.existsSync(chunksDir)) {
        for (const name of fs.readdirSync(chunksDir)) {
            if (!name.endsWith('.js.map')) continue;
            const jsName = name.slice(0, -4);
            if (!fs.existsSync(path.join(chunksDir, jsName))) {
                console.error(`[sync-webassets] Orphan source map without JS: chunks/${jsName}`);
                console.error('Run: cd RazyUI-v2 && npm run build:all');
                process.exit(1);
            }
        }
    }

    const comboboxPath = path.join(distDir, 'component/Combobox.js');
    const comboboxSrc = fs.readFileSync(comboboxPath, 'utf8');
    const chunkImportRe = /from\s+["']\.\.\/chunks\/([^"']+)["']/g;
    for (const match of comboboxSrc.matchAll(chunkImportRe)) {
        const chunkRel = `chunks/${match[1]}`;
        if (!fs.existsSync(path.join(distDir, chunkRel))) {
            console.error(`[sync-webassets] Combobox.js imports missing file: ${chunkRel}`);
            process.exit(1);
        }
    }
}

if (!fs.existsSync(razyDist)) {
    console.error(`Missing ${razyDist}. Run: npm run prebuild`);
    process.exit(1);
}

if (!fs.existsSync(razyCss)) {
    console.warn(`Missing ${razyCss} — run: npm run build:css (or build:all) in RazyUI-v2`);
    const { execSync } = await import('node:child_process');
    execSync('npm run build:css', { cwd: razyRoot, stdio: 'inherit' });
    if (!fs.existsSync(razyCss)) {
        console.error('build:css did not produce dist/razyui.css');
        process.exit(1);
    }
}

validateRazyDist(razyDist);

/** Only replace {@code razyui/}; merge {@code public/} over webassets (do not wipe shell JS absent from public). */
const razyuiDest = path.join(webassets, 'razyui');
if (fs.existsSync(razyuiDest)) {
    fs.rmSync(razyuiDest, { recursive: true, force: true });
}

fs.cpSync(publicDir, webassets, { recursive: true });
fs.cpSync(razyDist, razyuiDest, { recursive: true });

validateRazyDist(path.join(webassets, 'razyui'));

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
