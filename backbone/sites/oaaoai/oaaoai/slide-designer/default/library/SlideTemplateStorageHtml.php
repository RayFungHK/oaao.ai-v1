<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Slide template HTML enrichment — fidelity preview backgrounds, PPTX slots, materials overlay, fonts.
 *
 * Top-20 #16 phase 2: extracted from {@see SlideTemplateStorage}.
 */
final class SlideTemplateStorageHtml
{
    /**
     * Fidelity preview: LibreOffice PNG as full-bleed background; hide slot text in iframe
     * (avoids duplicate typography and broken relative render/ paths in masters/NN.html).
     *
     * @param array<string, mixed> $ctx
     */
    public static function enrichMasterHtmlWithRenderBackground(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
    ): string {
        if (! str_contains($html, 'oaao-layout-pptx_master')) {
            return $html;
        }
        if (str_contains($html, 'oaao-master-render-bg')) {
            return $html;
        }
        if (SlideTemplateStorage::resolveRenderSlidePath($templateId, $page, $ctx) === null) {
            return $html;
        }

        $bgUrl = SlideTemplateStorage::renderSlideApiUrl($templateId, $page);
        $escaped = htmlspecialchars($bgUrl, ENT_QUOTES, 'UTF-8');
        $inject = '<style id="oaao-master-render-bg">'
            . '.oaao-layout-pptx_master{background-color:#111827;background-image:url(\''
            . $escaped
            . '\');background-size:cover;background-position:center center;background-repeat:no-repeat}'
            . '.oaao-master-fidelity .oaao-pptx-slot{opacity:0;pointer-events:none}'
            . '</style>';

        $html = str_replace(
            'oaao-slide-canvas oaao-layout-pptx_master',
            'oaao-slide-canvas oaao-layout-pptx_master oaao-master-fidelity',
            $html,
        );

        if (preg_match('/<\/head>/i', $html) === 1) {
            return (string) preg_replace('/<\/head>/i', $inject . '</head>', $html, 1);
        }

        return $inject . $html;
    }

    public static function stripPptxDecorLayer(string $html): string
    {
        if ($html === '') {
            return $html;
        }

        return (string) preg_replace(
            '/<div\s+class="oaao-pptx-decor"[^>]*>.*?<\/div>\s*/is',
            '',
            $html,
        );
    }

    /**
     * @return array<string, string>
     */
    public static function loadSlideSlotsFromPath(string $slotsPath): array
    {
        if (! is_readable($slotsPath)) {
            return [];
        }
        try {
            /** @var mixed $raw */
            $raw = json_decode((string) file_get_contents($slotsPath), true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return [];
        }
        if (! is_array($raw)) {
            return [];
        }
        $slots = $raw['slots'] ?? null;
        if (! is_array($slots)) {
            return [];
        }
        $out = [];
        foreach ($slots as $key => $val) {
            $sid = trim((string) $key);
            $body = trim((string) $val);
            if ($sid !== '' && $body !== '') {
                $out[$sid] = $body;
            }
        }

        return $out;
    }

    /**
     * Repair on-disk slide.html when slots.json has content but HTML is stale or still shows decor PNG.
     *
     * @param array<string, string> $slots
     */
    public static function applyPptxSlotsToSlideHtml(string $html, array $slots): string
    {
        if ($slots === [] || ! str_contains($html, 'oaao-pptx-slot')) {
            return $html;
        }

        $html = self::stripPptxDecorLayer($html);
        foreach ($slots as $slotId => $text) {
            $safeId = preg_quote($slotId, '/');
            $escaped = htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            $inner = '<p class="oaao-pptx-slot-p">' . $escaped . '</p>';
            $pattern = '/(<div\s+class="oaao-pptx-slot"[^>]*data-slot-id="'
                . $safeId
                . '"[^>]*>\s*<div\s+class="oaao-pptx-slot-inner">)(.*?)(<\/div>)/s';
            $html = (string) preg_replace($pattern, '$1' . $inner . '$3', $html, 1);
        }

        return $html;
    }

    /**
     * Saved project slide preview: inject decor when render PNG exists; keep slot text visible.
     * When render is missing, force a dark canvas so light template typography is readable.
     *
     * @param array<string, mixed> $ctx
     */
    public static function enrichProjectSlideHtmlForPreview(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
        bool $skipDecor = false,
    ): string {
        if (! str_contains($html, 'oaao-layout-pptx_master')) {
            return $html;
        }

        if ($skipDecor) {
            $html = self::stripPptxDecorLayer($html);
        }

        $renderPath = $skipDecor ? null : SlideTemplateStorage::resolveRenderSlidePath($templateId, $page, $ctx);
        $hasDecorDiv = preg_match('/<div\s+class="oaao-pptx-decor\b/i', $html) === 1;

        if ($renderPath !== null && ! $skipDecor) {
            $bgUrl = SlideTemplateStorage::renderSlideApiUrl($templateId, $page);
            $escaped = htmlspecialchars($bgUrl, ENT_QUOTES, 'UTF-8');
            if (! $hasDecorDiv) {
                $decor = '<div class="oaao-pptx-decor" aria-hidden="true">'
                    . '<img src="' . $escaped . '" alt="" decoding="async" /></div>';
                $needle = '<div class="oaao-slide-canvas';
                $idx = strpos($html, $needle);
                if ($idx !== false) {
                    $close = strpos($html, '>', $idx);
                    if ($close !== false) {
                        $html = substr($html, 0, $close + 1) . $decor . substr($html, $close + 1);
                    }
                }
            }
        }

        if (str_contains($html, 'oaao-project-slide-preview')) {
            return $html;
        }

        if ($skipDecor) {
            $canvasBg = preg_match('/background:\s*#(?:0{2,3}|1[0-9a-f]{5}|2[0-4])/i', $html) === 1
                ? '#111827'
                : '#f8fafc';
        } else {
            $canvasBg = $renderPath !== null ? 'transparent' : '#111827';
        }
        $cjkStack = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", "Segoe UI", system-ui, sans-serif';
        $inject = '<style id="oaao-project-slide-preview">'
            . '.oaao-slide-canvas.oaao-layout-pptx_master{background:'
            . $canvasBg
            . ' !important}';
        if ($skipDecor) {
            $inject .= '.oaao-pptx-slot-inner,.oaao-pptx-slot-inner .oaao-pptx-slot-p{font-family:'
                . $cjkStack
                . ' !important;line-height:1.35 !important;word-break:break-word !important}'
                . '.oaao-pptx-slot[data-slot-id^="callout"] .oaao-pptx-slot-inner{font-size:clamp(7px,1.1vw,13px) !important}'
                . '.oaao-pptx-slot[data-slot-id="slot_1"] .oaao-pptx-slot-inner,.oaao-pptx-slot[data-slot-id="title"] .oaao-pptx-slot-inner{font-size:clamp(14px,2.2vw,28px) !important}';
        }
        $inject .= '</style>';

        if (preg_match('/<\/head>/i', $html) === 1) {
            return (string) preg_replace('/<\/head>/i', $inject . '</head>', $html, 1);
        }

        return $inject . $html;
    }
    public static function enrichMasterHtmlWithSlideMaterials(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
    ): string {
        if (! str_contains($html, 'oaao-layout-pptx_master') || str_contains($html, 'oaao-pptx-assets')) {
            return $html;
        }

        $manifest = SlideTemplateStorage::loadMaterialsManifest($templateId, $ctx);
        if ($manifest === null) {
            return $html;
        }

        $assets = [];
        $slides = $manifest['slides'] ?? null;
        if (\is_array($slides)) {
            foreach ($slides as $slide) {
                if (! \is_array($slide) || (int) ($slide['index'] ?? 0) !== $page) {
                    continue;
                }
                $rawAssets = $slide['assets'] ?? null;
                if (\is_array($rawAssets)) {
                    $assets = $rawAssets;
                }
                break;
            }
        }

        if ($assets === []) {
            return $html;
        }

        $imgs = '';
        foreach ($assets as $asset) {
            if (! \is_array($asset)) {
                continue;
            }
            $rel = trim((string) ($asset['path'] ?? ''));
            if ($rel === '' || SlideTemplateStorage::resolveMaterialFilePath($templateId, $rel, $ctx) === null) {
                continue;
            }
            $left = (float) ($asset['left_pct'] ?? 0);
            $top = (float) ($asset['top_pct'] ?? 0);
            $width = (float) ($asset['width_pct'] ?? 10);
            $height = (float) ($asset['height_pct'] ?? 10);
            $z = (int) ($asset['z_index'] ?? 2);
            $overlay = ! empty($asset['overlay_on_fidelity']);
            $url = htmlspecialchars(self::materialApiUrl($templateId, $rel), ENT_QUOTES, 'UTF-8');
            $fidelityAttr = $overlay ? ' data-overlay-fidelity="1"' : '';
            $imgs .= sprintf(
                '<img class="oaao-pptx-asset" alt=""%s style="left:%s%%;top:%s%%;width:%s%%;height:%s%%;z-index:%d" src="%s">',
                $fidelityAttr,
                $left,
                $top,
                $width,
                $height,
                $z,
                $url,
            );
        }

        if ($imgs === '') {
            return $html;
        }

        $style = '<style id="oaao-master-materials">'
            . '.oaao-pptx-assets{position:absolute;inset:0;z-index:1;pointer-events:none}'
            . '.oaao-pptx-asset{position:absolute;object-fit:contain}'
            . '.oaao-master-fidelity .oaao-pptx-asset:not([data-overlay-fidelity="1"]){display:none}'
            . '</style>';
        $layer = '<div class="oaao-pptx-assets">' . $imgs . '</div>';

        if (preg_match('/<\/head>/i', $html) === 1 && ! str_contains($html, 'oaao-master-materials')) {
            $html = (string) preg_replace('/<\/head>/i', $style . '</head>', $html, 1);
        }

        $needle = '<div class="oaao-slide-canvas oaao-layout-pptx_master oaao-master-fidelity">';
        if (str_contains($html, $needle)) {
            return str_replace($needle, $needle . $layer, $html);
        }

        $needle2 = '<div class="oaao-slide-canvas oaao-layout-pptx_master">';

        return str_replace($needle2, $needle2 . $layer, $html);
    }

    /**
     * @return array<string, list<string>>
     */
    private static function fontBasenameAliases(): array
    {
        return [
            'arial.ttf'   => ['calibri.ttf', 'carlito.ttf', 'liberation-sans.ttf', 'liberationsans-regular.ttf'],
            'arialbd.ttf' => ['calibrib.ttf', 'carlito-bold.ttf', 'liberation-sans-bold.ttf'],
            'calibri.ttf' => ['carlito.ttf', 'liberation-sans.ttf', 'arial.ttf'],
            'calibrib.ttf' => ['carlito-bold.ttf', 'liberation-sans-bold.ttf', 'arialbd.ttf'],
        ];
    }

    private static function resolveFontFileInAssetDir(string $assetDir, string $rel): ?string
    {
        $rel = ltrim(str_replace(['..', '\\'], '', trim($rel)), '/');
        if ($rel === '' || ! str_starts_with($rel, 'materials/fonts/')) {
            return null;
        }

        $direct = $assetDir . '/' . $rel;
        if (is_readable($direct) && ! is_dir($direct)) {
            return $direct;
        }

        $fontsDir = $assetDir . '/materials/fonts';
        if (! is_dir($fontsDir)) {
            return null;
        }

        $base = basename($rel);
        foreach (scandir($fontsDir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            if (strcasecmp($name, $base) === 0) {
                $candidate = $fontsDir . '/' . $name;
                if (is_readable($candidate) && ! is_dir($candidate)) {
                    return $candidate;
                }
            }
        }

        $aliases = self::fontBasenameAliases();
        $lower = strtolower($base);
        if (! isset($aliases[$lower])) {
            return null;
        }

        foreach ($aliases[$lower] as $alt) {
            foreach (scandir($fontsDir) ?: [] as $name) {
                if ($name === '.' || $name === '..') {
                    continue;
                }
                if (strcasecmp($name, $alt) !== 0) {
                    continue;
                }
                $candidate = $fontsDir . '/' . $name;
                if (is_readable($candidate) && ! is_dir($candidate)) {
                    return $candidate;
                }
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public static function resolveFontFilePath(string $templateId, string $relPath, array $ctx): ?string
    {
        $rel = ltrim(str_replace(['..', '\\'], '', trim($relPath)), '/');
        if ($rel === '' || ! str_starts_with($rel, 'materials/fonts/')) {
            return null;
        }

        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        if ($safe === '') {
            return null;
        }

        $row = SlideTemplateStorage::resolveTemplateRecord($templateId, $ctx);
        if ($row !== null) {
            $part = SlideTemplateStoragePaths::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
            if (isset($row['tenant_id'])) {
                $part['tenant_id'] = (int) $row['tenant_id'];
            }
            if (isset($row['owner_user_id'])) {
                $part['owner_user_id'] = (int) $row['owner_user_id'];
            }
            $path = self::resolveFontFileInAssetDir(SlideTemplateStoragePaths::scopeBase($part) . '/' . $safe, $rel);
            if ($path !== null) {
                return $path;
            }
        }

        $uid = (int) ($ctx['user_id'] ?? 0);
        if ($uid > 0) {
            $path = self::resolveFontFileInAssetDir(SlideTemplateStoragePaths::root() . '/personal/' . $uid . '/' . $safe, $rel);
            if ($path !== null) {
                return $path;
            }
        }

        foreach ([SlideTemplateStoragePaths::root(), SlideTemplateStoragePaths::legacyRoot()] as $base) {
            $personalRoot = $base . '/personal';
            if (! is_dir($personalRoot)) {
                continue;
            }
            $pattern = $personalRoot . '/*/' . $safe;
            foreach (glob($pattern) ?: [] as $assetDir) {
                if (! is_dir($assetDir)) {
                    continue;
                }
                $path = self::resolveFontFileInAssetDir($assetDir, $rel);
                if ($path !== null) {
                    return $path;
                }
            }
        }

        return null;
    }

    /**
     * Drop @font-face blocks whose template_font URL cannot be resolved (stale slide HTML).
     *
     * @param array<string, mixed> $ctx
     */
    public static function sanitizeSlideHtmlFontFaces(string $html, array $ctx): string
    {
        if ($html === '' || ! str_contains($html, 'template_font')) {
            return $html;
        }

        $out = preg_replace_callback(
            '/@font-face\s*\{[^}]*\}/is',
            static function (array $m) use ($ctx): string {
                if (! preg_match('/template_font\?([^"\')\s]+)/i', $m[0], $q)) {
                    return $m[0];
                }
                $query = html_entity_decode($q[1], ENT_QUOTES | ENT_HTML5);
                parse_str($query, $params);
                $tid = isset($params['template_id']) && is_string($params['template_id'])
                    ? trim($params['template_id'])
                    : '';
                $path = isset($params['path']) && is_string($params['path'])
                    ? trim($params['path'])
                    : '';
                if ($tid === '' || $path === '') {
                    return '';
                }
                if (SlideTemplateStorage::resolveFontFilePath($tid, $path, $ctx) === null) {
                    return '';
                }

                return $m[0];
            },
            $html,
        );

        return \is_string($out) ? $out : $html;
    }

    /**
     * Inject @font-face rules from materials/fonts/manifest.json (CP2 fonts).
     *
     * @param array<string, mixed> $ctx
     */
    public static function enrichMasterHtmlWithTemplateFonts(
        string $html,
        string $templateId,
        array $ctx,
    ): string {
        if (str_contains($html, 'oaao-template-fonts')) {
            return $html;
        }

        $row = SlideTemplateStorage::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return $html;
        }

        $rel = trim((string) ($row['fonts_manifest'] ?? 'materials/fonts/manifest.json'));
        $rel = ltrim(str_replace(['..', '\\'], '', $rel), '/');
        if (! str_starts_with($rel, 'materials/')) {
            return $html;
        }

        $part = SlideTemplateStoragePaths::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $manifestPath = SlideTemplateStoragePaths::scopeBase($part) . '/' . $safe . '/' . $rel;
        if (! is_readable($manifestPath)) {
            return $html;
        }

        $raw = file_get_contents($manifestPath);
        if ($raw === false || $raw === '') {
            return $html;
        }

        $decoded = json_decode($raw, true);
        if (! \is_array($decoded)) {
            return $html;
        }

        $entries = $decoded['entries'] ?? null;
        $verifiedCss = '';
        if (\is_array($entries) && $entries !== []) {
            $assetDir = SlideTemplateStoragePaths::scopeBase($part) . '/' . $safe;
            $blocks = [];
            foreach ($entries as $entry) {
                if (! \is_array($entry)) {
                    continue;
                }
                $family = trim((string) ($entry['family'] ?? $entry['typeface'] ?? ''));
                $relFont = trim((string) ($entry['path'] ?? ''));
                if ($family === '' || $relFont === '') {
                    continue;
                }
                if (self::resolveFontFileInAssetDir($assetDir, $relFont) === null) {
                    continue;
                }
                $url = '/slide-designer/api/template_font?' . http_build_query([
                    'template_id' => trim($templateId),
                    'path'        => ltrim(str_replace(['..', '\\'], '', $relFont), '/'),
                ]);
                $escaped = str_replace(['\\', '"'], ['\\\\', '\\"'], $family);
                $blocks[] = "@font-face {\n"
                    . "  font-family: \"{$escaped}\";\n"
                    . "  src: url(\"{$url}\") format(\"truetype\");\n"
                    . "  font-weight: normal;\n"
                    . "  font-style: normal;\n"
                    . "  font-display: swap;\n"
                    . '}';
            }
            $verifiedCss = implode("\n", $blocks);
        }

        $css = $verifiedCss !== '' ? $verifiedCss : trim((string) ($decoded['font_face_css'] ?? ''));
        if ($css === '') {
            return $html;
        }

        $stack = trim((string) ($decoded['font_stack'] ?? ''));
        $inject = '<style id="oaao-template-fonts">' . $css;
        if ($stack !== '') {
            $inject .= '.oaao-layout-pptx_master{font-family:' . $stack . '}';
        }
        $inject .= '</style>';

        if (preg_match('/<\/head>/i', $html) === 1) {
            return (string) preg_replace('/<\/head>/i', $inject . '</head>', $html, 1);
        }

        return $inject . $html;
    }
}
