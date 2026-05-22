<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\slide_designer\SlideProjectRegistry;
use oaaoai\slide_designer\SlideProjectStorage;

/**
 * GET /slide-designer/api/download?project_id=&file=&conversation_id=
 */
return function (): void {
    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $projectId = isset($_GET['project_id']) && is_string($_GET['project_id'])
        ? trim($_GET['project_id'])
        : '';
    $file = isset($_GET['file']) && is_string($_GET['file']) ? trim($_GET['file']) : '';
    $cid = (int) ($_GET['conversation_id'] ?? 0);

    if ($projectId === '' || $file === '' || str_contains($file, '..') || str_contains($file, '/')) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'project_id and file required']);

        return;
    }

    if (SlideProjectRegistry::resolveProjectAccess($pdo, $projectId, $uid, $cid) === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Not found']);

        return;
    }

    $base = SlideProjectStorage::projectDir($projectId);
    $path = $base . '/' . $file;
    $real = realpath($path);
    $baseReal = realpath($base);
    if ($real === false || $baseReal === false || ! str_starts_with($real, $baseReal) || ! is_file($real)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'File not found']);

        return;
    }

    $name = basename($real);
    $mime = 'application/octet-stream';
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    $map = [
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'md'   => 'text/markdown; charset=UTF-8',
        'html' => 'text/html; charset=UTF-8',
        'txt'  => 'text/plain; charset=UTF-8',
        'log'  => 'text/plain; charset=UTF-8',
    ];
    if (isset($map[$ext])) {
        $mime = $map[$ext];
    }

    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $name) . '"');
    header('Content-Length: ' . (string) filesize($real));
    readfile($real);
};
