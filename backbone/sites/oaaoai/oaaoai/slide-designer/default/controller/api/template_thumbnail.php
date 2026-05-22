<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * GET — custom thumbnail image.
 * POST multipart field {@code thumbnail} — save custom cover; optional {@code thumbnail_source}, {@code thumbnail_page}.
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user) {
        return;
    }

    $auth = $this->api('auth');
    $scopeCtx = SlideTemplateScope::contextFromAuthModule($user, $auth);

    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if ($method === 'GET') {
        $templateId = isset($_GET['template_id']) && is_string($_GET['template_id'])
            ? trim($_GET['template_id'])
            : '';
        if ($templateId === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'template_id required']);

            return;
        }

        $path = SlideTemplateStorage::resolveThumbnailPath($templateId, $scopeCtx);
        if ($path === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Thumbnail not found']);

            return;
        }

        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'png'  => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            default => 'application/octet-stream',
        };
        header('Content-Type: ' . $mime);
        header('Cache-Control: private, max-age=300');
        readfile($path);

        return;
    }

    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $templateId = '';
    if (isset($_POST['template_id']) && is_string($_POST['template_id'])) {
        $templateId = trim($_POST['template_id']);
    }
    if ($templateId === '') {
        $raw = file_get_contents('php://input');
        if (is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (\is_array($decoded) && isset($decoded['template_id'])) {
                $templateId = trim((string) $decoded['template_id']);
            }
        }
    }

    if ($templateId === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'template_id required']);

        return;
    }

    $resolved = SlideTemplateStorage::resolveTemplateRecordWithPath($templateId, $scopeCtx);
    if ($resolved === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Template not found']);

        return;
    }

    $row = $resolved['row'];
    $scope = SlideTemplateScope::normalizeScope((string) ($row['scope'] ?? SlideTemplateScope::PERSONAL));
    if (! SlideTemplateScope::canWriteScope($scopeCtx, $scope)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Not allowed to edit this template']);

        return;
    }

    $part = SlideTemplateStorage::partitionFromScope($scopeCtx, $scope);
    if (isset($row['tenant_id'])) {
        $part['tenant_id'] = (int) $row['tenant_id'];
    }
    if (isset($row['owner_user_id'])) {
        $part['owner_user_id'] = (int) $row['owner_user_id'];
    }

    $patch = [];
    if (isset($_POST['thumbnail_source']) && is_string($_POST['thumbnail_source'])) {
        $src = strtolower(trim($_POST['thumbnail_source']));
        $patch['thumbnail_source'] = $src === 'custom' ? 'custom' : 'auto';
    }
    if (isset($_POST['thumbnail_page'])) {
        $patch['thumbnail_page'] = max(1, (int) $_POST['thumbnail_page']);
    }

    $upload = $_FILES['thumbnail'] ?? null;
    if (\is_array($upload) && ($upload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_OK) {
        $tmp = (string) ($upload['tmp_name'] ?? '');
        if ($tmp === '' || ! is_uploaded_file($tmp)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Invalid upload']);

            return;
        }

        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($tmp) ?: '';
        $ext = match ($mime) {
            'image/png'  => 'png',
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            default      => null,
        };
        if ($ext === null) {
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Use PNG, JPEG, or WebP']);

            return;
        }

        $dir = SlideTemplateStorage::templateAssetDir($templateId, $part);
        if (! is_dir($dir) && ! mkdir($dir, 0755, true)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not create template directory']);

            return;
        }

        foreach (['webp', 'png', 'jpg', 'jpeg'] as $old) {
            $oldPath = $dir . '/thumbnail.' . $old;
            if (is_file($oldPath)) {
                @unlink($oldPath);
            }
        }

        $dest = $dir . '/thumbnail.' . $ext;
        if (! move_uploaded_file($tmp, $dest)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not save thumbnail']);

            return;
        }

        $patch['thumbnail_source'] = 'custom';
    }

    if ($patch === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Nothing to update']);

        return;
    }

    if (! SlideTemplateStorage::patchTemplateRecord($templateId, $scopeCtx, $patch)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Could not update template']);

        return;
    }

    $updated = SlideTemplateStorage::resolveTemplateRecord($templateId, $scopeCtx);
    echo json_encode([
        'success'  => true,
        'template' => $updated,
        'thumbnail_url' => SlideTemplateStorage::thumbnailApiUrl($templateId),
    ], JSON_UNESCAPED_UNICODE);
};
