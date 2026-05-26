<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;
use oaaoai\mine\MineStorage;

/**
 * GET /mine/api/export_csv — download mined rows as CSV.
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    $mineId = isset($_GET['mine_id']) ? (int) $_GET['mine_id'] : 0;
    if ($mineId < 1) {
        http_response_code(400);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'mine_id required']);

        return;
    }

    $repo = new MineRepository($ctx['db']);
    $mine = $repo->getMine($mineId, $ctx['tenant_id'], $ctx['uid']);
    if ($mine === null) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Mine not found']);

        return;
    }

    $sqliteRel = isset($mine['sqlite_path']) && \is_string($mine['sqlite_path']) ? trim($mine['sqlite_path']) : '';
    if ($sqliteRel === '') {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'No data file']);

        return;
    }

    $table = isset($_GET['table']) ? trim((string) $_GET['table']) : '';
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

    $runId = isset($_GET['run_id']) && is_numeric($_GET['run_id']) ? (int) $_GET['run_id'] : null;
    $result = MineStorage::exportCsv($sqliteRel, $table, $runId);
    if ($result === null) {
        http_response_code(404);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Export failed']);

        return;
    }

    $label = preg_replace('/[^a-zA-Z0-9_-]+/', '_', (string) ($mine['label'] ?? 'mine')) ?? 'mine';
    $filename = $label . '_' . $table . '.csv';
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    if ($result['truncated']) {
        header('X-OAAO-Mine-Export-Truncated: 1');
    }
    echo $result['csv'];
};
