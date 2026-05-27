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
    public static function distributorDataDir()
    {
        return SlideTemplateStoragePaths::distributorDataDir();
    }
    public static function defaultRoot()
    {
        return SlideTemplateStoragePaths::defaultRoot();
    }
    /** @deprecated Legacy path before templates moved under {@code data/}. */
    public static function legacyRoot()
    {
        return SlideTemplateStoragePaths::legacyRoot();
    }
    public static function root()
    {
        return SlideTemplateStoragePaths::root();
    }
    public static function incomingDir()
    {
        return SlideTemplateStoragePaths::incomingDir();
    }
    /**
     * @return array{scope: string, tenant_id: int|null, owner_user_id: int|null}
     */
    public static function partitionFromScope(array $ctx, string $scope)
    {
        return SlideTemplateStoragePaths::partitionFromScope($ctx, $scope);
    }
    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function scopeBase(array $part)
    {
        return SlideTemplateStoragePaths::scopeBase($part);
    }
    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function templateJsonPath(string $templateId, array $part)
    {
        return SlideTemplateStoragePaths::templateJsonPath($templateId, $part);
    }
    public static function previewHtmlUrl(string $templateId, int $page)
    {
        return SlideTemplateStoragePaths::previewHtmlUrl($templateId, $page);
    }
    public static function masterHtmlUrl(string $templateId, int $page)
    {
        return SlideTemplateStoragePaths::masterHtmlUrl($templateId, $page);
    }
    public static function thumbnailApiUrl(string $templateId)
    {
        return SlideTemplateStoragePaths::thumbnailApiUrl($templateId);
    }
    public static function renderSlideApiUrl(string $templateId, int $page)
    {
        return SlideTemplateStoragePaths::renderSlideApiUrl($templateId, $page);
    }

    public static function enrichMasterHtmlWithRenderBackground(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
    ): string {
        return SlideTemplateStorageHtml::enrichMasterHtmlWithRenderBackground($html, $templateId, $page, $ctx);
    }

    public static function stripPptxDecorLayer(string $html): string
    {
        return SlideTemplateStorageHtml::stripPptxDecorLayer($html);
    }

    /**
     * @return array<string, string>
     */
    public static function loadSlideSlotsFromPath(string $slotsPath): array
    {
        return SlideTemplateStorageHtml::loadSlideSlotsFromPath($slotsPath);
    }

    /**
     * @param array<string, string> $slots
     */
    public static function applyPptxSlotsToSlideHtml(string $html, array $slots): string
    {
        return SlideTemplateStorageHtml::applyPptxSlotsToSlideHtml($html, $slots);
    }

    public static function enrichProjectSlideHtmlForPreview(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
        bool $skipDecor = false,
    ): string {
        return SlideTemplateStorageHtml::enrichProjectSlideHtmlForPreview($html, $templateId, $page, $ctx, $skipDecor);
    }

    public static function materialApiUrl(string $templateId, string $relPath): string
    {
        return SlideTemplateStorageHtml::materialApiUrl($templateId, $relPath);
    }

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
    public static function enrichMasterHtmlWithSlideMaterials(
        string $html,
        string $templateId,
        int $page,
        array $ctx,
    ): string {
        return SlideTemplateStorageHtml::enrichMasterHtmlWithSlideMaterials($html, $templateId, $page, $ctx);
    }

    public static function resolveFontFilePath(string $templateId, string $relPath, array $ctx): ?string
    {
        return SlideTemplateStorageHtml::resolveFontFilePath($templateId, $relPath, $ctx);
    }

    public static function sanitizeSlideHtmlFontFaces(string $html, array $ctx): string
    {
        return SlideTemplateStorageHtml::sanitizeSlideHtmlFontFaces($html, $ctx);
    }

    public static function enrichMasterHtmlWithTemplateFonts(
        string $html,
        string $templateId,
        array $ctx,
    ): string {
        return SlideTemplateStorageHtml::enrichMasterHtmlWithTemplateFonts($html, $templateId, $ctx);
    }

    /**
     * @param array{scope: string, tenant_id: int|null, owner_user_id: int|null} $part
     */
    public static function templateAssetDir(string $templateId, array $part)
    {
        return SlideTemplateStoragePaths::templateAssetDir($templateId, $part);
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
