<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;
use oaaoai\mine\MineStorage;

/**
 * POST /mine/api/export_vault — export mined rows as CSV document in Vault.
 *
 * JSON: mine_id, vault_id, container_id?, table?, run_id?, max_rows?
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $mineId = isset($input['mine_id']) ? (int) $input['mine_id'] : 0;
    $vaultId = isset($input['vault_id']) ? (int) $input['vault_id'] : 0;
    if ($mineId < 1 || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'mine_id and vault_id required']);

        return;
    }

    $repo = new MineRepository($ctx['db']);
    $mine = $repo->getMine($mineId, $ctx['tenant_id'], $ctx['uid']);
    if ($mine === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Mine not found']);

        return;
    }

    $sqliteRel = isset($mine['sqlite_path']) && \is_string($mine['sqlite_path']) ? trim($mine['sqlite_path']) : '';
    if ($sqliteRel === '') {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'No data file']);

        return;
    }

    $table = isset($input['table']) ? trim((string) $input['table']) : '';
    if ($table === '') {
        $schema = null;
        if (isset($mine['schema_json']) && \is_string($mine['schema_json']) && $mine['schema_json'] !== '') {
            try {
                $schema = json_decode($mine['schema_json'], true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $schema = null;
            }
        }
        if (\is_array($schema) && isset($schema['table_name'])) {
            $table = (string) $schema['table_name'];
        }
        if ($table === '') {
            $tables = MineStorage::listTables($sqliteRel);
            $table = $tables[0] ?? 'data';
        }
    }

    $runId = isset($input['run_id']) && is_numeric($input['run_id']) ? (int) $input['run_id'] : null;
    $maxRows = isset($input['max_rows']) && is_numeric($input['max_rows']) ? (int) $input['max_rows'] : 10000;
    $result = MineStorage::exportCsv($sqliteRel, $table, $runId, $maxRows);
    if ($result === null) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Export failed']);

        return;
    }

    $containerId = isset($input['container_id']) && is_numeric($input['container_id'])
        ? (int) $input['container_id']
        : null;
    $workspaceId = isset($mine['workspace_id']) && is_numeric($mine['workspace_id'])
        ? (int) $mine['workspace_id']
        : null;

    $label = trim((string) ($mine['label'] ?? 'Mine'));
    $filename = preg_replace('/[^a-zA-Z0-9._-]+/', '_', $label) . '_' . $table . '.csv';
    $header = "# Data Mining export — {$label}\n\n";
    $content = $header . $result['csv'];

    $vault = $this->api('vault');
    if (! $vault || ! method_exists($vault, 'oaao_vault_internal_token_ok')) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Vault unavailable']);

        return;
    }

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : 'oaao_dev_shared_secret';

    $vaultJobBase = getenv('OAAO_VAULT_JOB_POLL_BASE_URL');
    if (! \is_string($vaultJobBase) || trim($vaultJobBase) === '') {
        $vaultJobBase = (getenv('OAAO_DOCKER') === '1' || @is_readable('/.dockerenv'))
            ? 'http://web/vault/api'
            : 'http://127.0.0.1/vault/api';
    }
    $uploadUrl = rtrim(trim($vaultJobBase), '/') . '/document_upload_text';

    $payload = [
        'user_id'    => $ctx['uid'],
        'vault_id'   => $vaultId,
        'filename'   => $filename,
        'content'    => $content,
        'mime_type'  => 'text/csv',
        'watch_id'   => null,
    ];
    if ($containerId !== null && $containerId > 0) {
        $payload['container_id'] = $containerId;
    }
    if ($workspaceId !== null && $workspaceId > 0) {
        $payload['workspace_id'] = $workspaceId;
    }

    $ch = curl_init($uploadUrl);
    if ($ch === false) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Upload request failed']);

        return;
    }
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-OAAO-Internal-Token: ' . $secret,
            'Accept: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 120,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (! \is_string($raw) || $raw === '' || $code >= 400) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Vault upload failed', 'http' => $code]);

        return;
    }

    try {
        $resp = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Invalid vault response']);

        return;
    }

    echo json_encode([
        'success'     => ! empty($resp['success']),
        'document_id' => $resp['document_id'] ?? null,
        'row_count'   => $result['row_count'],
        'truncated'   => $result['truncated'],
    ], JSON_UNESCAPED_UNICODE);
};
