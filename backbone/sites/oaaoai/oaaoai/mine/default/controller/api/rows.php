<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;
use oaaoai\mine\MineStorage;

/**
 * GET /mine/api/rows — paginated SQLite rows for DataTable.
 *
 * Query: mine_id, table?, page, pageSize, run_id?, sortColumn?, sortDirection?
 */
return function (): void {
    $ctx = $this->oaao_mine_require_pg();
    if ($ctx === null) {
        return;
    }

    $mineId = isset($_GET['mine_id']) ? (int) $_GET['mine_id'] : 0;
    if ($mineId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'mine_id required']);

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
        echo json_encode([
            'success' => true,
            'data'    => [],
            'total'   => 0,
            'columns' => [],
        ], JSON_UNESCAPED_UNICODE);

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

    $page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
    $pageSize = isset($_GET['pageSize']) ? max(1, min(200, (int) $_GET['pageSize'])) : 50;
    $runId = isset($_GET['run_id']) && is_numeric($_GET['run_id']) ? (int) $_GET['run_id'] : null;
    $sortColumn = isset($_GET['sortColumn']) ? trim((string) $_GET['sortColumn']) : null;
    $sortDirection = isset($_GET['sortDirection']) ? trim((string) $_GET['sortDirection']) : 'asc';

    $result = MineStorage::fetchRows(
        $sqliteRel,
        $table,
        $page,
        $pageSize,
        $runId,
        $sortColumn !== '' ? $sortColumn : null,
        $sortDirection,
    );

    if ($result === null) {
        echo json_encode([
            'success' => true,
            'data'    => [],
            'total'   => 0,
            'columns' => [],
            'table'   => $table,
        ], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode([
        'success' => true,
        'data'    => $result['rows'],
        'total'   => $result['total'],
        'columns' => $result['columns'],
        'table'   => $table,
    ], JSON_UNESCAPED_UNICODE);
};
