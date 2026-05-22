/**
 * Dev server only — production assets come from `scripts/sync-webassets.mjs`
 * (`npm run build`), which copies **RazyUI-v2/dist** into `webassets/razyui/` verbatim.
 *
 * Do not re-bundle RazyUI here for prod: a flat `razyui.js` breaks relative
 * `../component/*.js` and `modulepreload` URLs that assume **chunks/** + **component/** layout.
 *
 * Optional: `npm run build:legacy-bundle` still runs this config (not used for deploy).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webassets = path.resolve(__dirname, '../default/webassets');

export default defineConfig({
    base: process.env.VITE_BASE ?? './',
    publicDir: path.resolve(__dirname, 'public'),
    build: {
        target: 'es2022',
        manifest: false,
        outDir: webassets,
        emptyOutDir: true,
        cssCodeSplit: false,
        modulePreload: { polyfill: false, resolveDependencies: () => [] },
        lib: {
            entry: path.resolve(__dirname, 'src/razyui-vendor.js'),
            name: 'OaaoRazyUI',
            formats: ['es'],
            fileName: 'razyui/razyui',
        },
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
                assetFileNames: 'razyui/assets/[name]-[hash][extname]',
            },
        },
    },
    resolve: {
        preserveSymlinks: true,
        alias: {
            'razyui-tokens': path.resolve(__dirname, 'node_modules/razyui/src/tokens.json'),
            'razyui/theme.css': path.resolve(__dirname, 'node_modules/razyui/src/sass/style.css'),
            'razyui/icons.css': path.resolve(__dirname, 'node_modules/razyui/src/sass/component/razyui-icons.css'),
        },
    },
    server: {
        port: 5181,
        strictPort: false,
        fs: {
            allow: [
                path.resolve(__dirname),
                path.resolve(__dirname, '../../../../../../../RazyUI-v2'),
            ],
        },
    },
});
