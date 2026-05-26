<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\research\ResearchRepository;
use oaaoai\research\ResearchVaultGuard;

/**
 * POST /research/api/watch_save — create or update watch + sources.
 */
return function (): void {
    $ctx = $this->oaao_research_require_pg();
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
    $vaultId = isset($input['vault_id']) ? (int) $input['vault_id'] : 0;
    $containerId = isset($input['container_id']) && $input['container_id'] !== '' && $input['container_id'] !== null
        ? (int) $input['container_id']
        : null;
    $parentContainerId = isset($input['parent_container_id']) && $input['parent_container_id'] !== '' && $input['parent_container_id'] !== null
        ? (int) $input['parent_container_id']
        : null;
    $folderName = trim((string) ($input['folder_name'] ?? ''));
    $workspaceId = isset($input['workspace_id']) && is_numeric($input['workspace_id'])
        ? (int) $input['workspace_id']
        : null;
    $summaryLang = trim((string) ($input['summary_language'] ?? 'zh-TW'));
    if ($summaryLang === '') {
        $summaryLang = 'zh-TW';
    }

    if ($label === '' || $vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'label and vault_id required']);

        return;
    }

    $isEnabled = ! empty($input['is_enabled']) ? 1 : 0;
    $schedule = oaao_research_parse_schedule_input($input, $isEnabled);
    if ($schedule === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid auto fetch interval']);

        return;
    }

    $watchId = isset($input['watch_id']) ? (int) $input['watch_id'] : 0;
    if ($watchId < 1 && empty($input['discover_confirmed'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Analyze sources and confirm before creating a watch']);

        return;
    }

    $repo = new ResearchRepository($ctx['db']);
    $now = gmdate('Y-m-d H:i:s');
    $existing = null;

    if ($watchId > 0) {
        $existing = $repo->getWatch($watchId, $ctx['tenant_id'], $ctx['uid']);
        if ($existing === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Watch not found']);

            return;
        }
        if ($containerId === null && isset($existing['container_id']) && $existing['container_id'] !== null) {
            $containerId = (int) $existing['container_id'];
        }
    }

    $watchConfig = oaao_research_encode_watch_config(
        oaao_research_merge_watch_config_for_save(
            $watchId > 0 && $existing !== null
                ? oaao_research_decode_watch_config(
                    isset($existing['config_json']) && \is_string($existing['config_json']) ? $existing['config_json'] : null,
                )
                : [],
            $input,
        ),
    );

    if ($containerId === null || $containerId < 1) {
        $containerId = ResearchVaultGuard::createResearchFolder(
            $ctx['db'],
            $vaultId,
            $label,
            $ctx['uid'],
            $parentContainerId !== null && $parentContainerId > 0 ? $parentContainerId : null,
            $folderName !== '' ? $folderName : null,
        );
        if ($containerId < 1) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not create Research folder in vault']);

            return;
        }
    }

    if ($watchId > 0) {
        $repo->updateWatch($watchId, [
            'label'                => $label,
            'vault_id'             => $vaultId,
            'container_id'         => $containerId,
            'workspace_id'         => $workspaceId,
            'summary_language'     => $summaryLang,
            'is_enabled'           => $isEnabled,
            'interval_minutes'     => $schedule['interval_minutes'],
            'schedule_start_time'  => $schedule['schedule_start_time'],
            'schedule_timezone'    => $schedule['schedule_timezone'],
            'next_run_at'          => $schedule['next_run_at'],
            'config_json'          => $watchConfig,
            'updated_at'           => $now,
        ]);
        $repo->deleteSourcesForWatch($watchId);
    } else {
        $watchId = $repo->insertWatch([
            'tenant_id'           => $ctx['tenant_id'],
            'owner_user_id'       => $ctx['uid'],
            'workspace_id'        => $workspaceId,
            'label'               => $label,
            'vault_id'            => $vaultId,
            'container_id'        => $containerId,
            'summary_language'    => $summaryLang,
            'is_enabled'          => $isEnabled,
            'interval_minutes'    => $schedule['interval_minutes'],
            'schedule_start_time' => $schedule['schedule_start_time'],
            'schedule_timezone'   => $schedule['schedule_timezone'],
            'next_run_at'         => $schedule['next_run_at'],
            'config_json'         => $watchConfig,
            'created_at'          => $now,
        ]);
    }

    $sources = isset($input['sources']) && \is_array($input['sources']) ? $input['sources'] : [];
    $sort = 0;
    foreach ($sources as $src) {
        if (! \is_array($src)) {
            continue;
        }
        $kind = strtolower(trim((string) ($src['kind'] ?? 'url')));
        if (! \in_array($kind, ['url', 'rss', 'arxiv', 'blog', 'index', 'static', 'auto'], true)) {
            $kind = 'url';
        }
        $url = trim((string) ($src['url'] ?? $src['feed_url'] ?? ''));
        if ($url === '') {
            continue;
        }
        $resolvedKind = trim((string) ($src['resolved_kind'] ?? ''));
        if ($resolvedKind !== '' && \in_array($resolvedKind, ['index', 'static', 'rss', 'arxiv', 'blog', 'url'], true)) {
            $kind = $resolvedKind;
        } elseif ($kind === 'auto' || $kind === 'url') {
            $kind = 'static';
        }
        $cfgData = ['url' => $url];
        if (isset($src['discovered_mode']) && \is_string($src['discovered_mode']) && $src['discovered_mode'] !== '') {
            $cfgData['discovered_mode'] = $src['discovered_mode'];
            $cfgData['source_mode'] = $src['discovered_mode'];
        }
        if (isset($src['html_hash']) && \is_string($src['html_hash']) && $src['html_hash'] !== '') {
            $cfgData['last_index_hash'] = $src['html_hash'];
        }
        if (! empty($src['link_pattern'])) {
            $cfgData['item_url_pattern'] = (string) $src['link_pattern'];
        } elseif (! empty($src['item_url_pattern'])) {
            $cfgData['item_url_pattern'] = (string) $src['item_url_pattern'];
            $cfgData['link_pattern'] = (string) $src['item_url_pattern'];
        }
        if (isset($src['discover_path']) && \is_array($src['discover_path'])) {
            $cfgData['discover_path'] = $src['discover_path'];
        }
        if (isset($src['confirmed_sample_urls']) && \is_array($src['confirmed_sample_urls'])) {
            $cfgData['confirmed_sample_urls'] = array_values(array_filter(
                array_map(static fn ($u) => trim((string) $u), $src['confirmed_sample_urls']),
                static fn ($u) => $u !== '',
            ));
        }
        $cfgData['discover_confirmed'] = true;
        try {
            $cfg = json_encode($cfgData, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            $cfg = null;
        }
        $repo->insertSource([
            'watch_id'    => $watchId,
            'kind'        => $kind,
            'config_json' => $cfg,
            'sort_order'  => $sort++,
            'created_at'  => $now,
        ]);
    }

    echo json_encode([
        'success'  => true,
        'watch_id' => $watchId,
    ], JSON_UNESCAPED_UNICODE);
};
