<?php

declare(strict_types=1);

/**
 * GET /vault/api/document_status — lightweight embed/graph status for poll refresh.
 *
 * Query: {@code workspace_id} optional; {@code document_ids} comma-separated (max 64).
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $ctx = $this->oaao_vault_require_pg_api_context(null);
    if ($ctx === null) {
        return;
    }

    $rawIds = isset($_GET['document_ids']) ? trim((string) $_GET['document_ids']) : '';
    /** @var list<int> $ids */
    $ids = [];
    if ($rawIds !== '') {
        foreach (explode(',', $rawIds) as $part) {
            $part = trim($part);
            if ($part === '' || ! ctype_digit($part)) {
                continue;
            }
            $n = (int) $part;
            if ($n > 0) {
                $ids[] = $n;
            }
            if (\count($ids) >= 64) {
                break;
            }
        }
        $ids = array_values(array_unique($ids, SORT_NUMERIC));
    }

    if ($ids === []) {
        echo json_encode(['success' => true, 'data' => ['documents' => []]], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    $rows = $db->prepare()
        ->select('id, vault_id, file_name, embed_status, embed_error, embed_attempts, graph_status, byte_size, (CASE WHEN source_text IS NOT NULL AND BTRIM(source_text) <> \'\' THEN 1 ELSE 0 END) AS has_transcript')
        ->from('vault_document')
        ->where('id|=:ids')
        ->assign(['ids' => $ids])
        ->order('+id')
        ->query()
        ->fetchAll();

    if (! \is_array($rows)) {
        $rows = [];
    }

    /** @var list<array<string, mixed>> $out */
    $out = [];
    foreach ($rows as $row) {
        if (! \is_array($row)) {
            continue;
        }
        $vid = (int) ($row['vault_id'] ?? 0);
        $did = (int) ($row['id'] ?? 0);
        if ($vid < 1 || $did < 1) {
            continue;
        }
        if (! $this->oaao_vault_user_can_touch_vault($db, $vid, $uid, $wid)) {
            continue;
        }
        $out[] = [
            'id'             => $did,
            'vault_id'       => $vid,
            'file_name'      => (string) ($row['file_name'] ?? ''),
            'embed_status'   => (string) ($row['embed_status'] ?? ''),
            'embed_error'    => isset($row['embed_error']) && \is_string($row['embed_error'])
                ? trim($row['embed_error'])
                : null,
            'embed_attempts' => (int) ($row['embed_attempts'] ?? 0),
            'graph_status'   => isset($row['graph_status']) && \is_string($row['graph_status']) ? trim($row['graph_status']) : null,
            'byte_size'      => isset($row['byte_size']) && $row['byte_size'] !== null ? (int) $row['byte_size'] : null,
            'has_transcript' => ! empty($row['has_transcript']),
        ];
    }

    header('Cache-Control: private, no-store, max-age=0');
    header('Pragma: no-cache');

    echo json_encode([
        'success' => true,
        'data'    => ['documents' => $out],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
