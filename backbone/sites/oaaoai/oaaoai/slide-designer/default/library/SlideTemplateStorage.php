<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Custom slide templates — scoped storage (global / tenant / personal).
 *
 * On-disk layout (Razy distributor {@code data/}, same family as chat attachments):
 * {@code data/slide-templates/custom/incoming/} — upload staging;
 * {@code data/slide-templates/custom/personal/{user_id}/{template_id}/render/01.png} — LibreOffice previews;
 * {@code data/slide-templates/custom/personal/{user_id}/{template_id}.json} — manifest.
 */
final class SlideTemplateStorage
{
    public static function distributorDataDir(): string
    {
        return dirname(__DIR__, 3) . '/data';
    }

    public static function defaultRoot(): string
    {
        return self::distributorDataDir() . '/slide-templates/custom';
    }

    /** @deprecated Legacy path before templates moved under {@code data/}. */
    public static function legacyRoot(): string
    {
        return dirname(__DIR__, 3) . '/auth/data/slide-templates/custom';
    }

    public static function root(): string
    {
        $env = getenv('OAAO_SLIDE_TEMPLATE_CUSTOM_ROOT');
        if (is_string($env) && trim($env) !== '') {
            return rtrim(trim($env), '/\\');
        }

        $preferred = self::defaultRoot();
        $legacy = self::legacyRoot();
        if (is_dir($preferred) || ! is_dir($legacy)) {
            return $preferred;
        }

        return $legacy;
    }

    public static function incomingDir(): string
    {
        $dir = self::root() . '/incoming';
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        return $dir;
    }

    /**
     * @return array{scope: string, tenant_id: int|null, owner_user_id: int|null}
     */
    public static function partitionFromScope(array $ctx, string $scope): array
    {
        $scope = SlideTemplateScope::normalizeScope($scope);
        if ($scope === SlideTemplateScope::GLOBAL) {
            return ['scope' => $scope, 'tenant_id' => null, 'owner_user_id' => null];
        }
        if ($scope === SlideTemplateScope::TENANT) {
            $tid = isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : 0;

            return ['scope' => $scope, 'tenant_id' => $tid > 0 ? $tid : null, 'owner_user_id' => null];
        }

        $uid = (int) ($ctx['user_id'] ?? 0);

        return [
            'scope'           => SlideTemplateScope::PERSONAL,
            'tenant_id'       => isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : null,
            'owner_user_id'   => $uid > 0 ? $uid : null,
        ];
    }

    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function scopeBase(array $part): string
    {
        $scope = SlideTemplateScope::normalizeScope($part['scope'] ?? null);
        if ($scope === SlideTemplateScope::GLOBAL) {
            return self::root() . '/global';
        }
        if ($scope === SlideTemplateScope::TENANT) {
            $tid = (int) ($part['tenant_id'] ?? 0);

            return self::root() . '/tenant/' . max(1, $tid);
        }
        $uid = (int) ($part['owner_user_id'] ?? 0);

        return self::root() . '/personal/' . max(1, $uid);
    }

    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function templateJsonPath(string $templateId, array $part): string
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));

        return self::scopeBase($part) . '/' . $safe . '.json';
    }

    public static function previewHtmlUrl(string $templateId, int $page): string
    {
        return '/slide-designer/api/template_preview_html?' . http_build_query([
            'template_id' => trim($templateId),
            'page'        => max(1, $page),
        ]);
    }

    public static function masterHtmlUrl(string $templateId, int $page): string
    {
        return '/slide-designer/api/template_master_html?' . http_build_query([
            'template_id' => trim($templateId),
            'page'        => max(1, $page),
        ]);
    }

    public static function thumbnailApiUrl(string $templateId): string
    {
        return '/slide-designer/api/template_thumbnail?' . http_build_query([
            'template_id' => trim($templateId),
        ]);
    }

    public static function renderSlideApiUrl(string $templateId, int $page): string
    {
        return '/slide-designer/api/template_render?' . http_build_query([
            'template_id' => trim($templateId),
            'page'        => max(1, $page),
        ]);
    }

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
        if (self::resolveRenderSlidePath($templateId, $page, $ctx) === null) {
            return $html;
        }

        $bgUrl = self::renderSlideApiUrl($templateId, $page);
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

        $renderPath = $skipDecor ? null : self::resolveRenderSlidePath($templateId, $page, $ctx);
        $hasDecorDiv = preg_match('/<div\s+class="oaao-pptx-decor\b/i', $html) === 1;

        if ($renderPath !== null && ! $skipDecor) {
            $bgUrl = self::renderSlideApiUrl($templateId, $page);
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

    public static function materialApiUrl(string $templateId, string $relPath): string
    {
        return '/slide-designer/api/template_material?' . http_build_query([
            'template_id' => trim($templateId),
            'path'        => ltrim(str_replace(['..', '\\'], '', $relPath), '/'),
        ]);
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return array<string, mixed>|null
     */
    public static function loadMaterialsManifest(string $templateId, array $ctx): ?array
    {
        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return null;
        }

        $rel = trim((string) ($row['materials_manifest'] ?? 'materials/manifest.json'));
        if ($rel === '') {
            $rel = 'materials/manifest.json';
        }
        $rel = ltrim(str_replace(['..', '\\'], '', $rel), '/');
        if (! str_starts_with($rel, 'materials/')) {
            return null;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $path = self::scopeBase($part) . '/' . $safe . '/' . $rel;
        if (! is_readable($path)) {
            return null;
        }

        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }

        $decoded = json_decode($raw, true);

        return \is_array($decoded) ? $decoded : null;
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public static function resolveMaterialFilePath(string $templateId, string $relPath, array $ctx): ?string
    {
        $rel = ltrim(str_replace(['..', '\\'], '', trim($relPath)), '/');
        if ($rel === '' || ! str_starts_with($rel, 'materials/')) {
            return null;
        }

        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return null;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $path = self::scopeBase($part) . '/' . $safe . '/' . $rel;
        if (! is_readable($path) || is_dir($path)) {
            return null;
        }

        return $path;
    }

    /**
     * CP2: overlay unpacked raster/SVG assets (SVG always on fidelity PNG previews).
     *
     * @param array<string, mixed> $ctx
     */
    public static function enrichMasterHtmlWithSlideMaterials(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
    ): string {
        if (! str_contains($html, 'oaao-layout-pptx_master') || str_contains($html, 'oaao-pptx-assets')) {
            return $html;
        }

        $manifest = self::loadMaterialsManifest($templateId, $ctx);
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
            if ($rel === '' || self::resolveMaterialFilePath($templateId, $rel, $ctx) === null) {
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

        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row !== null) {
            $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
            if (isset($row['tenant_id'])) {
                $part['tenant_id'] = (int) $row['tenant_id'];
            }
            if (isset($row['owner_user_id'])) {
                $part['owner_user_id'] = (int) $row['owner_user_id'];
            }
            $path = self::resolveFontFileInAssetDir(self::scopeBase($part) . '/' . $safe, $rel);
            if ($path !== null) {
                return $path;
            }
        }

        $uid = (int) ($ctx['user_id'] ?? 0);
        if ($uid > 0) {
            $path = self::resolveFontFileInAssetDir(self::root() . '/personal/' . $uid . '/' . $safe, $rel);
            if ($path !== null) {
                return $path;
            }
        }

        foreach ([self::root(), self::legacyRoot()] as $base) {
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
                if (self::resolveFontFilePath($tid, $path, $ctx) === null) {
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

        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return $html;
        }

        $rel = trim((string) ($row['fonts_manifest'] ?? 'materials/fonts/manifest.json'));
        $rel = ltrim(str_replace(['..', '\\'], '', $rel), '/');
        if (! str_starts_with($rel, 'materials/')) {
            return $html;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $manifestPath = self::scopeBase($part) . '/' . $safe . '/' . $rel;
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
            $assetDir = self::scopeBase($part) . '/' . $safe;
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

    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function templateAssetDir(string $templateId, array $part): string
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));

        return self::scopeBase($part) . '/' . $safe;
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return array{row: array<string, mixed>, json_path: string}|null
     */
    public static function resolveTemplateRecordWithPath(string $templateId, array $ctx): ?array
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        if ($safe === '') {
            return null;
        }

        $candidates = [];
        $uid = (int) ($ctx['user_id'] ?? 0);
        $tid = isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : 0;
        if ($uid > 0) {
            $candidates[] = self::root() . '/personal/' . $uid . '/' . $safe . '.json';
        }
        if ($tid > 0) {
            $candidates[] = self::root() . '/tenant/' . $tid . '/' . $safe . '.json';
        }
        $candidates[] = self::root() . '/global/' . $safe . '.json';
        $candidates[] = self::root() . '/' . $safe . '.json';

        foreach ($candidates as $path) {
            if (! is_readable($path)) {
                continue;
            }
            $raw = file_get_contents($path);
            if (! is_string($raw) || $raw === '') {
                continue;
            }
            $data = json_decode($raw, true);
            if (! \is_array($data)) {
                continue;
            }
            $data['template_id'] = (string) ($data['template_id'] ?? $safe);
            if (! SlideTemplateScope::canReadTemplate($ctx, $data)) {
                continue;
            }

            return ['row' => $data, 'json_path' => $path];
        }

        return null;
    }

    /**
     * @param array<string, mixed> $ctx
     */
    public static function resolveThumbnailPath(string $templateId, array $ctx): ?string
    {
        $resolved = self::resolveTemplateRecordWithPath($templateId, $ctx);
        if ($resolved === null) {
            return null;
        }
        $row = $resolved['row'];
        $source = strtolower(trim((string) ($row['thumbnail_source'] ?? 'auto')));
        if ($source !== 'custom') {
            return null;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $dir = self::templateAssetDir($templateId, $part);
        foreach (['webp', 'png', 'jpg', 'jpeg'] as $ext) {
            $path = $dir . '/thumbnail.' . $ext;
            if (is_readable($path)) {
                return $path;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $ctx
     * @param array<string, mixed> $patch
     */
    public static function patchTemplateRecord(string $templateId, array $ctx, array $patch): bool
    {
        $resolved = self::resolveTemplateRecordWithPath($templateId, $ctx);
        if ($resolved === null) {
            return false;
        }
        $row = $resolved['row'];
        $scope = SlideTemplateScope::normalizeScope((string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (! SlideTemplateScope::canWriteScope($ctx, $scope)) {
            return false;
        }
        $owner = (int) ($row['owner_user_id'] ?? $row['created_by'] ?? 0);
        $uid = (int) ($ctx['user_id'] ?? 0);
        $status = trim((string) ($row['status'] ?? 'draft'));
        if ($status !== 'published' && $scope !== SlideTemplateScope::GLOBAL && $owner > 0 && $owner !== $uid) {
            $isOp = (bool) ($ctx['is_platform_operator'] ?? false);
            if (! $isOp) {
                return false;
            }
        }

        $merged = array_merge($row, $patch, ['template_id' => $row['template_id']]);
        $json = json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if (! is_string($json)) {
            return false;
        }

        return file_put_contents($resolved['json_path'], $json . "\n") !== false;
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return string|null Absolute path to slide HTML
     */
    public static function resolvePreviewHtmlPath(string $templateId, int $page, array $ctx): ?string
    {
        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return null;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $root = self::scopeBase($part);
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $rel = sprintf('slides/%02d/slide.html', max(1, $page));
        $manifestPath = $root . '/' . $safe . '/preview/preview_manifest.json';
        if (is_readable($manifestPath)) {
            $raw = file_get_contents($manifestPath);
            if (is_string($raw) && $raw !== '') {
                $manifest = json_decode($raw, true);
                if (\is_array($manifest) && \is_array($manifest['pages'] ?? null)) {
                    foreach ($manifest['pages'] as $p) {
                        if (! \is_array($p) || (int) ($p['index'] ?? 0) !== $page) {
                            continue;
                        }
                        if (isset($p['html_path']) && is_string($p['html_path'])) {
                            $rel = ltrim(str_replace(['..', '\\'], '', trim($p['html_path'])), '/');
                        }
                        break;
                    }
                }
            }
        }

        $path = $root . '/' . $safe . '/preview/' . $rel;
        if (! is_readable($path)) {
            return null;
        }

        return $path;
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return string|null Absolute path to positioned master HTML (masters/NN.html)
     */
    public static function resolveMasterHtmlPath(string $templateId, int $page, array $ctx): ?string
    {
        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return null;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $page = max(1, $page);
        $rel = sprintf('masters/%02d.html', $page);

        foreach (['preview_pages', 'pages'] as $key) {
            $pages = $row[$key] ?? null;
            if (! \is_array($pages)) {
                continue;
            }
            foreach ($pages as $p) {
                if (! \is_array($p) || (int) ($p['index'] ?? 0) !== $page) {
                    continue;
                }
                $master = trim((string) ($p['master_path'] ?? ''));
                if ($master !== '') {
                    $rel = ltrim(str_replace(['..', '\\'], '', $master), '/');
                }
                break;
            }
        }

        $path = self::scopeBase($part) . '/' . $safe . '/' . $rel;
        if (is_readable($path)) {
            return $path;
        }

        $resolved = self::resolveTemplateRecordWithPath($templateId, $ctx);
        if ($resolved !== null) {
            $jsonDir = dirname($resolved['json_path']);
            $besideJson = $jsonDir . '/' . $safe . '/' . $rel;
            if (is_readable($besideJson)) {
                return $besideJson;
            }
        }

        foreach ([self::root(), self::legacyRoot()] as $base) {
            $personalRoot = $base . '/personal';
            if (! is_dir($personalRoot)) {
                continue;
            }
            $pattern = $personalRoot . '/*/' . $safe . '/' . $rel;
            $matches = glob($pattern) ?: [];
            foreach ($matches as $candidate) {
                if (is_readable($candidate)) {
                    return $candidate;
                }
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return string|null Absolute path to rendered slide PNG (LibreOffice pipeline)
     */
    public static function resolveRenderSlidePath(string $templateId, int $page, array $ctx): ?string
    {
        $row = self::resolveTemplateRecord($templateId, $ctx);
        if ($row === null) {
            return null;
        }

        $part = self::partitionFromScope($ctx, (string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
        if (isset($row['tenant_id'])) {
            $part['tenant_id'] = (int) $row['tenant_id'];
        }
        if (isset($row['owner_user_id'])) {
            $part['owner_user_id'] = (int) $row['owner_user_id'];
        }

        $root = self::scopeBase($part);
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        $page = max(1, $page);
        $rel = sprintf('render/%02d.png', $page);
        $manifestPath = $root . '/' . $safe . '/preview/preview_manifest.json';
        if (is_readable($manifestPath)) {
            $raw = file_get_contents($manifestPath);
            if (is_string($raw) && $raw !== '') {
                $manifest = json_decode($raw, true);
                if (\is_array($manifest) && \is_array($manifest['pages'] ?? null)) {
                    foreach ($manifest['pages'] as $p) {
                        if (! \is_array($p) || (int) ($p['index'] ?? 0) !== $page) {
                            continue;
                        }
                        if (isset($p['render_path']) && is_string($p['render_path'])) {
                            $rel = ltrim(str_replace(['..', '\\'], '', trim($p['render_path'])), '/');
                        }
                        break;
                    }
                }
            }
        }

        $path = $root . '/' . $safe . '/' . $rel;
        if (is_readable($path)) {
            return $path;
        }

        $resolved = self::resolveTemplateRecordWithPath($templateId, $ctx);
        if ($resolved !== null) {
            $jsonDir = dirname($resolved['json_path']);
            $besideJson = $jsonDir . '/' . $safe . '/' . $rel;
            if (is_readable($besideJson)) {
                return $besideJson;
            }
        }

        foreach ([self::root(), self::legacyRoot()] as $base) {
            $personalRoot = $base . '/personal';
            if (! is_dir($personalRoot)) {
                continue;
            }
            $pattern = $personalRoot . '/*/' . $safe . '/' . $rel;
            $matches = glob($pattern) ?: [];
            foreach ($matches as $candidate) {
                if (is_readable($candidate)) {
                    return $candidate;
                }
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $ctx
     *
     * @return array<string, mixed>|null
     */
    public static function resolveTemplateRecord(string $templateId, array $ctx): ?array
    {
        $safe = preg_replace('/[^a-z0-9_]/', '', strtolower(trim($templateId)));
        if ($safe === '') {
            return null;
        }

        $candidates = [];
        $uid = (int) ($ctx['user_id'] ?? 0);
        $tid = isset($ctx['tenant_id']) ? (int) $ctx['tenant_id'] : 0;
        if ($uid > 0) {
            $candidates[] = self::root() . '/personal/' . $uid . '/' . $safe . '.json';
        }
        if ($tid > 0) {
            $candidates[] = self::root() . '/tenant/' . $tid . '/' . $safe . '.json';
        }
        $candidates[] = self::root() . '/global/' . $safe . '.json';
        $candidates[] = self::root() . '/' . $safe . '.json';

        foreach ($candidates as $path) {
            if (! is_readable($path)) {
                continue;
            }
            $raw = file_get_contents($path);
            if (! is_string($raw) || $raw === '') {
                continue;
            }
            $data = json_decode($raw, true);
            if (! \is_array($data)) {
                continue;
            }
            $data['template_id'] = (string) ($data['template_id'] ?? $safe);
            if (! SlideTemplateScope::canReadTemplate($ctx, $data)) {
                continue;
            }

            return $data;
        }

        return null;
    }

    /**
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $scopeCtx
     *
     * @return array<string, mixed>
     */
    public static function enrichCustomTemplateList(array $payload, array $scopeCtx = []): array
    {
        $rows = $payload['custom_templates'] ?? null;
        if (! \is_array($rows)) {
            return $payload;
        }
        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $tid = trim((string) ($row['template_id'] ?? ''));
            if ($tid === '') {
                $out[] = $row;
                continue;
            }
            $mode = strtolower(trim((string) ($row['preview_mode'] ?? '')));
            $thumb = strtolower(trim((string) ($row['thumbnail_source'] ?? 'auto')));
            $useRender = $mode === 'pptx_render' || $thumb === 'pptx_render';
            if (isset($row['preview_pages']) && \is_array($row['preview_pages'])) {
                $pages = [];
                foreach ($row['preview_pages'] as $p) {
                    if (! \is_array($p)) {
                        continue;
                    }
                    $idx = (int) ($p['index'] ?? 0);
                    if ($idx > 0) {
                        $layout = strtolower(trim((string) ($p['layout'] ?? '')));
                        $suggested = strtolower(trim((string) ($p['suggested_layout'] ?? '')));
                        $isMaster = $layout === 'pptx_master' || $suggested === 'pptx_master';
                        if ($isMaster && self::resolveMasterHtmlPath($tid, $idx, $scopeCtx) !== null) {
                            $p['master_preview_url'] = self::masterHtmlUrl($tid, $idx);
                        }
                        $p['preview_url'] = ($useRender || $layout === 'pptx_render')
                            ? self::renderSlideApiUrl($tid, $idx)
                            : self::previewHtmlUrl($tid, $idx);
                    }
                    $pages[] = $p;
                }
                $row['preview_pages'] = $pages;
            }
            $out[] = $row;
        }
        $payload['custom_templates'] = $out;

        return $payload;
    }

    /**
     * @param array<string, mixed> $payload
     * @param array<string, mixed> $scopeCtx
     *
     * @return array<string, mixed>
     */
    private static function scopeCtxFromPayload(array $payload, array $scopeCtx): array
    {
        if ($scopeCtx !== []) {
            return $scopeCtx;
        }
        $ts = $payload['template_scope'] ?? null;
        if (\is_array($ts)) {
            return [
                'user_id'   => (int) ($ts['owner_user_id'] ?? $ts['user_id'] ?? 0),
                'tenant_id' => isset($ts['tenant_id']) ? (int) $ts['tenant_id'] : null,
            ];
        }
        $tpl = $payload['template'] ?? null;
        if (\is_array($tpl)) {
            return [
                'user_id'   => (int) ($tpl['owner_user_id'] ?? 0),
                'tenant_id' => isset($tpl['tenant_id']) ? (int) $tpl['tenant_id'] : null,
            ];
        }

        return [];
    }

    /**
     * @param array<string, mixed>|null $payload
     *
     * @return array<string, mixed>|null
     */
    public static function enrichPreviewPayload(?array $payload, string $templateId, array $scopeCtx = []): ?array
    {
        if ($payload === null || $templateId === '') {
            return $payload;
        }

        $tid = trim($templateId);
        $ctx = self::scopeCtxFromPayload($payload, $scopeCtx);
        $previewMode = '';
        if (isset($payload['preview_mode']) && is_string($payload['preview_mode'])) {
            $previewMode = strtolower(trim($payload['preview_mode']));
        }
        if ($previewMode === '' && isset($payload['template']) && \is_array($payload['template'])) {
            $tplMode = $payload['template']['preview_mode'] ?? '';
            if (is_string($tplMode)) {
                $previewMode = strtolower(trim($tplMode));
            }
        }
        $useRender = $previewMode === 'pptx_render';

        $enrichPages = static function (mixed $pages) use ($tid, $useRender, $ctx): mixed {
            if (! \is_array($pages)) {
                return $pages;
            }
            $out = [];
            foreach ($pages as $p) {
                if (! \is_array($p)) {
                    continue;
                }
                $row = $p;
                $idx = (int) ($row['index'] ?? 0);
                if ($idx > 0) {
                    $layout = strtolower(trim((string) ($row['layout'] ?? '')));
                    $suggested = strtolower(trim((string) ($row['suggested_layout'] ?? '')));
                    $isMaster = $layout === 'pptx_master' || $suggested === 'pptx_master';
                    if ($isMaster && self::resolveMasterHtmlPath($tid, $idx, $ctx) !== null) {
                        $row['master_preview_url'] = self::masterHtmlUrl($tid, $idx);
                    }
                    $row['preview_url'] = ($useRender || $layout === 'pptx_render')
                        ? self::renderSlideApiUrl($tid, $idx)
                        : self::previewHtmlUrl($tid, $idx);
                }
                $out[] = $row;
            }

            return $out;
        };

        if (isset($payload['pages']) && \is_array($payload['pages'])) {
            $payload['pages'] = $enrichPages($payload['pages']);
        }
        if (isset($payload['preview_pages']) && \is_array($payload['preview_pages'])) {
            $payload['preview_pages'] = $enrichPages($payload['preview_pages']);
        }
        if (isset($payload['template']) && \is_array($payload['template'])) {
            $tpl = $payload['template'];
            if (isset($tpl['preview_pages'])) {
                $tpl['preview_pages'] = $enrichPages($tpl['preview_pages']);
            }
            $payload['template'] = $tpl;
        }

        return $payload;
    }
}
