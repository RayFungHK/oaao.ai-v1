<?php

declare(strict_types=1);

/**
 * GET /vault/api/vault_status — bulk per-vault embed/graph status snapshot.
 *
 * Replaces the N+1 polling pattern of `document_status` (capped at 64 ids per
 * call) with a single per-vault query. Designed for poll loops that watch
 * an entire vault/folder for ingest progress.
 *
 * Query:
 * - {@code vault_id} (required, int) — the vault to scan.
 * - {@code workspace_id} (optional, int) — workspace scoping; falls back to
 *   the personal shell when omitted.
 * - {@code transient_only=1} (optional) — only return documents in
 *   non-terminal states (pending/embedding for embed, pending/building for
 *   graph). Cuts payload for steady-state polling.
 *
 * Response shape mirrors {@code document_status} per-row plus a top-level
 * {@code counts} aggregation for one-shot UI badges.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $ctx = $this->oaao_vault_require_pg_api_context(null);
    if ($ctx === null) {
        return;
    }

    $vaultId = isset($_GET['vault_id']) && is_numeric($_GET['vault_id']) ? (int) $_GET['vault_id'] : 0;
    if ($vaultId < 1) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'vault_id required',
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $transientOnly = isset($_GET['transient_only']) && (string) $_GET['transient_only'] === '1';

    $q = $db->prepare()
        ->select('id, vault_id, container_id, file_name, embed_status, embed_error, embed_attempts, graph_status, graph_error, byte_size, (CASE WHEN source_text IS NOT NULL AND BTRIM(source_text) <> \'\' THEN 1 ELSE 0 END) AS has_transcript')
        ->from('vault_document')
        ->where('vault_id=:vid')
        ->assign(['vid' => $vaultId]);

    if ($transientOnly) {
        // Non-terminal: embed in {pending, embedding} OR graph in {pending, building}
        $q->where('embed_status|=:est OR graph_status|=:gst')
            ->assign([
                'est' => ['pending', 'embedding'],
                'gst' => ['pending', 'building'],
            ]);
    }

    $rows = $q->order('+id')->query()->fetchAll();
    if (! \is_array($rows)) {
        $rows = [];
    }

    /** @var list<array<string, mixed>> $out */
    $out = [];
    $counts = [
        'embed_pending'    => 0,
        'embed_embedding'  => 0,
        'embed_embedded'   => 0,
        'embed_failed'     => 0,
        'embed_held'       => 0,
        'graph_pending'    => 0,
        'graph_building'   => 0,
        'graph_indexed'    => 0,
        'graph_failed'     => 0,
        'total'            => 0,
    ];

    foreach ($rows as $row) {
        if (! \is_array($row)) {
            continue;
        }
        $did = (int) ($row['id'] ?? 0);
        if ($did < 1) {
            continue;
        }
        $embedStatus = (string) ($row['embed_status'] ?? '');
        $graphStatus = isset($row['graph_status']) && \is_string($row['graph_status'])
            ? trim($row['graph_status'])
            : '';

        $out[] = [
            'id'             => $did,
            'vault_id'       => (int) ($row['vault_id'] ?? 0),
            'container_id'   => isset($row['container_id']) && $row['container_id'] !== null
                ? (int) $row['container_id']
                : null,
            'file_name'      => (string) ($row['file_name'] ?? ''),
            'embed_status'   => $embedStatus,
            'embed_error'    => isset($row['embed_error']) && \is_string($row['embed_error'])
                ? trim($row['embed_error'])
                : null,
            'embed_attempts' => (int) ($row['embed_attempts'] ?? 0),
            'graph_status'   => $graphStatus !== '' ? $graphStatus : null,
            'graph_error'    => isset($row['graph_error']) && \is_string($row['graph_error'])
                ? trim($row['graph_error'])
                : null,
            'byte_size'      => isset($row['byte_size']) && $row['byte_size'] !== null
                ? (int) $row['byte_size']
                : null,
            'has_transcript' => ! empty($row['has_transcript']),
        ];

        $counts['total']++;
        $ek = 'embed_' . $embedStatus;
        if (isset($counts[$ek])) {
            $counts[$ek]++;
        }
        $gk = 'graph_' . $graphStatus;
        if ($graphStatus !== '' && isset($counts[$gk])) {
            $counts[$gk]++;
        }
    }

    header('Cache-Control: private, no-store, max-age=0');
    header('Pragma: no-cache');

    echo json_encode([
        'success' => true,
        'data'    => [
            'vault_id'       => $vaultId,
            'transient_only' => $transientOnly,
            'counts'         => $counts,
            'documents'      => $out,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
