<?php

declare(strict_types=1);

use oaaoai\library\LibraryBlocksMarkdown;
use oaaoai\library\LibraryVaultFinalize;

/**
 * POST /library/api/library_finalize_to_vault — copy library doc blocks → vault document + embed jobs.
 *
 * Body: document_id, vault_id, container_id?, workspace_id?
 */
return function (): void {
    require_once __DIR__ . '/_library_api_bootstrap.php';
    require_once dirname(__DIR__, 2) . '/library/LibraryBlocksMarkdown.php';
    require_once dirname(__DIR__, 2) . '/library/LibraryVaultFinalize.php';

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_library_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $docId = (int) ($input['document_id'] ?? 0);
    $vaultId = (int) ($input['vault_id'] ?? 0);
    $containerId = isset($input['container_id']) && is_numeric($input['container_id'])
        ? (int) $input['container_id']
        : 0;
    $widRaw = $input['workspace_id'] ?? null;
    $workspaceId = $widRaw !== null && $widRaw !== '' && (int) $widRaw > 0 ? (int) $widRaw : null;

    if ($docId < 1 || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'document_id and vault_id required']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $uid = (int) $ctx['uid'];
    $pdo = $ctx['pdo'];

    $st = $pdo->prepare(
        'SELECT d.document_id, d.title, d.workspace_id,
                r.blocks_json, r.markdown_mirror
         FROM oaao_library_document d
         LEFT JOIN LATERAL (
             SELECT blocks_json, markdown_mirror
             FROM oaao_library_revision
             WHERE document_id = d.document_id
             ORDER BY version DESC, revision_id DESC
             LIMIT 1
         ) r ON true
         WHERE d.document_id = ? AND d.tenant_id = ?
         LIMIT 1',
    );
    $st->execute([$docId, $tenantId]);
    $row = $st->fetch(\PDO::FETCH_ASSOC);
    if (! \is_array($row)) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Document not found']);

        return;
    }

    $title = trim((string) ($row['title'] ?? 'Untitled'));
    if ($title === '') {
        $title = 'Untitled';
    }

    $markdown = trim((string) ($row['markdown_mirror'] ?? ''));
    if ($markdown === '') {
        $blocks = [];
        $rawBlocks = $row['blocks_json'] ?? '';
        if (\is_string($rawBlocks) && trim($rawBlocks) !== '') {
            try {
                $dec = json_decode($rawBlocks, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($dec)) {
                    /** @var list<array<string, mixed>> $blocks */
                    $blocks = $dec;
                }
            } catch (\JsonException) {
                $blocks = [];
            }
        }
        $markdown = LibraryBlocksMarkdown::blocksToMarkdown($blocks, $title);
    }

    if ($markdown === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Document has no content to finalize']);

        return;
    }

    if ($workspaceId === null) {
        $docWid = $row['workspace_id'] ?? null;
        if ($docWid !== null && (int) $docWid > 0) {
            $workspaceId = (int) $docWid;
        }
    }

    $safeName = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $title) ?? 'library_doc';
    $filename = $safeName . '.md';

    try {
        $upload = LibraryVaultFinalize::uploadMarkdown(
            $uid,
            $vaultId,
            $containerId > 0 ? $containerId : null,
            $workspaceId,
            $filename,
            $markdown,
            'library',
        );
    } catch (\Throwable $e) {
        error_log('library_finalize_to_vault: ' . $e->getMessage());
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Vault upload unavailable']);

        return;
    }

    if (($upload['success'] ?? false) !== true) {
        http_response_code((int) ($upload['http'] ?? 502) >= 400 ? (int) $upload['http'] : 502);
        echo json_encode([
            'success' => false,
            'message' => (string) ($upload['message'] ?? 'Vault upload failed'),
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'library_document_id' => $docId,
            'vault_document_id'   => (int) ($upload['document_id'] ?? 0),
            'vault_id'            => $vaultId,
            'container_id'        => $containerId > 0 ? $containerId : null,
            'job_ids'             => $upload['job_ids'] ?? [],
            'filename'            => $filename,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
