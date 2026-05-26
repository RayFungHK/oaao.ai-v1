<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\mine\MineRepository;

/**
 * POST /mine/api/mine_save — create or update mine + sources.
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

    $label = trim((string) ($input['label'] ?? ''));
    if ($label === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'label required']);

        return;
    }

    $mineId = isset($input['mine_id']) ? (int) $input['mine_id'] : 0;
    if ($mineId < 1 && empty($input['discover_confirmed'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Analyze sources and confirm dataset before creating a mine']);

        return;
    }

    $repo = new MineRepository($ctx['db']);
    $now = gmdate('Y-m-d H:i:s');
    $intervalMinutes = isset($input['interval_minutes']) && is_numeric($input['interval_minutes'])
        ? max(0, (int) $input['interval_minutes'])
        : null;
    if ($intervalMinutes !== null && $intervalMinutes < 1) {
        $intervalMinutes = null;
    }

    $workspaceId = isset($input['workspace_id']) && is_numeric($input['workspace_id'])
        ? (int) $input['workspace_id']
        : null;

    $schemaJson = null;
    if (isset($input['schema_json']) && \is_array($input['schema_json'])) {
        try {
            $schemaJson = json_encode($input['schema_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $schemaJson = null;
        }
    }

    $llmHintsJson = null;
    if (isset($input['llm_hints_json']) && \is_array($input['llm_hints_json'])) {
        try {
            $llmHintsJson = json_encode($input['llm_hints_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $llmHintsJson = null;
        }
    }

    $notifyJson = null;
    if (isset($input['notify_json']) && \is_array($input['notify_json'])) {
        try {
            $notifyJson = json_encode($input['notify_json'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $notifyJson = null;
        }
    } else {
        $notifyJson = json_encode(['in_app' => true, 'min_new_rows' => 1], JSON_UNESCAPED_UNICODE);
    }

    $isEnabled = ! isset($input['is_enabled']) || ! empty($input['is_enabled']) ? 1 : 0;
    $nextRunAt = $isEnabled === 1 ? oaao_mine_compute_next_run_at($intervalMinutes) : null;

    if ($mineId > 0) {
        $existing = $repo->getMine($mineId, $ctx['tenant_id'], $ctx['uid']);
        if ($existing === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Mine not found']);

            return;
        }
        $repo->updateMine($mineId, [
            'label'             => $label,
            'description'       => trim((string) ($input['description'] ?? '')) ?: null,
            'workspace_id'      => $workspaceId,
            'interval_minutes'  => $intervalMinutes,
            'is_enabled'        => $isEnabled,
            'schema_json'       => $schemaJson,
            'llm_hints_json'    => $llmHintsJson,
            'notify_json'       => $notifyJson,
            'next_run_at'       => $nextRunAt,
            'updated_at'        => $now,
        ]);
        $repo->deleteSourcesForMine($mineId);
    } else {
        $sqlitePath = oaao_mine_relative_sqlite_path($ctx['tenant_id'], 0);
        $mineId = $repo->insertMine([
            'tenant_id'        => $ctx['tenant_id'],
            'owner_user_id'    => $ctx['uid'],
            'workspace_id'     => $workspaceId,
            'label'            => $label,
            'description'      => trim((string) ($input['description'] ?? '')) ?: null,
            'interval_minutes' => $intervalMinutes,
            'is_enabled'       => $isEnabled,
            'schema_json'      => $schemaJson,
            'llm_hints_json'   => $llmHintsJson,
            'notify_json'      => $notifyJson,
            'sqlite_path'      => null,
            'next_run_at'      => $nextRunAt,
            'created_at'       => $now,
        ]);
        $sqlitePath = oaao_mine_relative_sqlite_path($ctx['tenant_id'], $mineId);
        $repo->updateMine($mineId, ['sqlite_path' => $sqlitePath]);
    }

    $sources = isset($input['sources']) && \is_array($input['sources']) ? $input['sources'] : [];
    $sort = 0;
    foreach ($sources as $src) {
        if (! \is_array($src)) {
            continue;
        }
        $kind = strtolower(trim((string) ($src['kind'] ?? 'http_json')));
        if (! \in_array($kind, ['http_json', 'http_csv', 'http_html_table', 'http_index', 'static_url', 'auto'], true)) {
            $kind = 'http_json';
        }
        $url = trim((string) ($src['url'] ?? ''));
        if ($url === '') {
            continue;
        }
        $resolvedKind = trim((string) ($src['resolved_kind'] ?? ''));
        if ($resolvedKind !== '' && \in_array($resolvedKind, ['http_json', 'http_csv', 'http_html_table', 'http_index', 'static_url'], true)) {
            $kind = $resolvedKind;
        } elseif ($kind === 'auto') {
            $kind = 'static_url';
        }
        $fetchMode = strtolower(trim((string) ($src['fetch_mode'] ?? 'http')));
        if (! \in_array($fetchMode, ['http', 'playwright'], true)) {
            $fetchMode = 'http';
        }
        $cfg = [
            'url'             => $url,
            'json_path'       => trim((string) ($src['json_path'] ?? $src['jq_path'] ?? '')),
            'method'          => strtoupper(trim((string) ($src['method'] ?? 'GET'))) ?: 'GET',
            'table_selector'  => trim((string) ($src['table_selector'] ?? $src['selector'] ?? '')),
            'table_index'     => isset($src['table_index']) ? (int) $src['table_index'] : 0,
            'wait_ms'         => isset($src['wait_ms']) ? (int) $src['wait_ms'] : 1500,
        ];
        if (isset($src['column_map']) && \is_array($src['column_map'])) {
            $cfg['column_map'] = $src['column_map'];
        }
        $sourceMode = trim((string) ($src['source_mode'] ?? ''));
        if ($sourceMode !== '') {
            $cfg['source_mode'] = $sourceMode;
        } elseif ($kind === 'http_index') {
            $cfg['source_mode'] = 'index';
        }
        if (isset($src['html_hash']) && \is_string($src['html_hash']) && $src['html_hash'] !== '') {
            $cfg['last_index_hash'] = $src['html_hash'];
        }
        $cfg['discover_confirmed'] = true;
        if (isset($src['discovered_mode']) && \is_string($src['discovered_mode']) && $src['discovered_mode'] !== '') {
            $cfg['discovered_mode'] = $src['discovered_mode'];
        }
        try {
            $cfgStr = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $cfgStr = null;
        }
        $repo->insertSource([
            'mine_id'     => $mineId,
            'kind'        => $kind,
            'config_json' => $cfgStr,
            'fetch_mode'  => $fetchMode,
            'sort_order'  => $sort++,
            'created_at'  => $now,
        ]);
    }

    echo json_encode([
        'success' => true,
        'mine_id' => $mineId,
    ], JSON_UNESCAPED_UNICODE);
};
