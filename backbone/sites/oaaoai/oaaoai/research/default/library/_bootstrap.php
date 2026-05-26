<?php

declare(strict_types=1);

require_once __DIR__ . '/ResearchRepository.php';
require_once __DIR__ . '/ResearchVaultGuard.php';
require_once __DIR__ . '/ResearchItemPurge.php';

use oaaoai\research\ResearchRepository;

function oaao_research_vault_storage_root(): string
{
    $env = getenv('OAAO_VAULT_STORAGE');
    if ($env !== false && trim((string) $env) !== '') {
        return rtrim(trim((string) $env), '/');
    }

    return dirname(__DIR__, 6) . '/storage/vault';
}

function oaao_research_unlink_storage_file(string $storageRoot, ?string $relativePath): void
{
    if ($relativePath === null || $relativePath === '' || $storageRoot === '') {
        return;
    }
    $abs = $storageRoot . '/' . ltrim(str_replace('\\', '/', $relativePath), '/');
    if (is_file($abs)) {
        @unlink($abs);
    }
}

/**
 * @return list<int>
 */
function oaao_research_allowed_interval_minutes(): array
{
    return [60, 240, 480, 720, 1440];
}

function oaao_research_normalize_start_time(?string $hm): string
{
    $hm = trim((string) $hm);
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $hm, $m)) {
        $h = max(0, min(23, (int) $m[1]));
        $min = max(0, min(59, (int) $m[2]));

        return sprintf('%02d:%02d', $h, $min);
    }

    return '09:00';
}

function oaao_research_normalize_timezone(?string $tz): string
{
    $tz = trim((string) ($tz ?? ''));
    if ($tz !== '') {
        try {
            new \DateTimeZone($tz);

            return $tz;
        } catch (\Exception) {
        }
    }

    return 'UTC';
}

function oaao_research_compute_next_run_at(
    ?int $intervalMinutes,
    ?string $startTimeHm = null,
    ?string $timezone = null,
    ?\DateTimeInterface $from = null,
): ?string {
    if ($intervalMinutes === null || $intervalMinutes < 1) {
        return null;
    }

    $tzName = oaao_research_normalize_timezone($timezone);
    $tz = new \DateTimeZone($tzName);
    if ($from instanceof \DateTimeInterface) {
        $now = \DateTimeImmutable::createFromInterface($from)->setTimezone($tz);
    } else {
        $now = new \DateTimeImmutable('now', $tz);
    }

    [$sh, $sm] = array_map('intval', explode(':', oaao_research_normalize_start_time($startTimeHm)));
    $anchor = $now->setTime($sh, $sm, 0);
    while ($anchor <= $now) {
        $anchor = $anchor->modify('+' . $intervalMinutes . ' minutes');
    }

    return $anchor->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
}

/**
 * @param array<string, mixed> $watch
 *
 * @return array<string, mixed>
 */
function oaao_research_schedule_patch_after_run(array $watch): array
{
    $interval = isset($watch['interval_minutes']) && is_numeric($watch['interval_minutes'])
        ? (int) $watch['interval_minutes']
        : 0;
    $patch = [
        'last_run_at' => gmdate('Y-m-d H:i:s'),
        'updated_at'  => gmdate('Y-m-d H:i:s'),
    ];
    if ($interval > 0 && (int) ($watch['is_enabled'] ?? 0) === 1) {
        $patch['next_run_at'] = oaao_research_compute_next_run_at(
            $interval,
            isset($watch['schedule_start_time']) ? (string) $watch['schedule_start_time'] : null,
            isset($watch['schedule_timezone']) ? (string) $watch['schedule_timezone'] : null,
        );
    }

    return $patch;
}

/**
 * @param array<string, mixed> $input
 *
 * @return array{interval_minutes: ?int, schedule_start_time: string, schedule_timezone: string, next_run_at: ?string}|null
 */
function oaao_research_parse_schedule_input(array $input, int $isEnabled): ?array
{
    $allowed = oaao_research_allowed_interval_minutes();
    $intervalMinutes = isset($input['interval_minutes']) && is_numeric($input['interval_minutes'])
        ? (int) $input['interval_minutes']
        : null;
    if ($intervalMinutes !== null && $intervalMinutes < 1) {
        $intervalMinutes = null;
    }
    if ($intervalMinutes !== null && ! \in_array($intervalMinutes, $allowed, true)) {
        return null;
    }

    $startTime = oaao_research_normalize_start_time($input['schedule_start_time'] ?? null);
    $timezone = oaao_research_normalize_timezone($input['schedule_timezone'] ?? null);
    $nextRunAt = ($isEnabled === 1 && $intervalMinutes !== null)
        ? oaao_research_compute_next_run_at($intervalMinutes, $startTime, $timezone)
        : null;

    return [
        'interval_minutes'     => $intervalMinutes,
        'schedule_start_time'  => $startTime,
        'schedule_timezone'    => $timezone,
        'next_run_at'          => $nextRunAt,
    ];
}

/**
 * @param array<string, mixed> $input
 *
 * @return array<string, mixed>
 */
function oaao_research_parse_watch_config_input(array $input): array
{
    $out = [];
    if (isset($input['max_new_per_run']) && is_numeric($input['max_new_per_run'])) {
        $out['max_new_per_run'] = max(1, min(100, (int) $input['max_new_per_run']));
    }
    $out['backfill_enabled'] = ! empty($input['backfill_enabled']);
    if (isset($input['backfill_max_days']) && is_numeric($input['backfill_max_days'])) {
        $out['backfill_max_days'] = max(1, min(3650, (int) $input['backfill_max_days']));
    } elseif ($out['backfill_enabled']) {
        $out['backfill_max_days'] = 30;
    }

    $matchPrompt = trim((string) ($input['match_prompt'] ?? ''));
    if ($matchPrompt !== '') {
        $out['match_prompt'] = $matchPrompt;
    }
    if (isset($input['match_prompt_normalized']) && is_string($input['match_prompt_normalized'])) {
        $norm = trim($input['match_prompt_normalized']);
        if ($norm !== '') {
            $out['match_prompt_normalized'] = $norm;
        }
    }
    if (isset($input['match_min_confidence']) && is_numeric($input['match_min_confidence'])) {
        $out['match_min_confidence'] = max(0.0, min(1.0, (float) $input['match_min_confidence']));
    } elseif ($matchPrompt !== '') {
        $out['match_min_confidence'] = 0.7;
    }
    if (array_key_exists('notify_in_app', $input)) {
        $out['notify_in_app'] = ! empty($input['notify_in_app']);
    } elseif ($matchPrompt !== '') {
        $out['notify_in_app'] = true;
    }

    return $out;
}

/**
 * Merge watch config on save (preserve worker-written normalized prompt unless user edits criteria).
 *
 * @param array<string, mixed> $existing
 * @param array<string, mixed> $input
 *
 * @return array<string, mixed>
 */
function oaao_research_merge_watch_config_for_save(array $existing, array $input): array
{
    if (array_key_exists('match_prompt', $input)) {
        $mp = trim((string) $input['match_prompt']);
        if ($mp === '') {
            unset($existing['match_prompt'], $existing['match_prompt_normalized'], $existing['match_min_confidence']);
        } elseif (($existing['match_prompt'] ?? '') !== $mp) {
            unset($existing['match_prompt_normalized']);
        }
    }

    $parsed = oaao_research_parse_watch_config_input($input);

    return array_merge($existing, $parsed);
}

/**
 * @return array<string, mixed>
 */
function oaao_research_decode_watch_config(?string $raw): array
{
    if ($raw === null || trim($raw) === '') {
        return [];
    }
    try {
        $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

        return \is_array($dec) ? $dec : [];
    } catch (\JsonException) {
        return [];
    }
}

/**
 * @param array<string, mixed> $config
 */
function oaao_research_encode_watch_config(array $config): ?string
{
    if ($config === []) {
        return null;
    }
    try {
        return json_encode($config, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        return null;
    }
}

/**
 * @return array<string, string>
 */
function oaao_research_worker_api_urls(): array
{
    $vaultJobBase = getenv('OAAO_VAULT_JOB_POLL_BASE_URL');
    if (! \is_string($vaultJobBase) || trim($vaultJobBase) === '') {
        $vaultJobBase = (getenv('OAAO_DOCKER') === '1' || @is_readable('/.dockerenv'))
            ? 'http://web/vault/api'
            : '';
    }
    $vaultJobBase = rtrim(trim((string) $vaultJobBase), '/');
    $webApiBase = preg_replace('#/vault/api$#', '', $vaultJobBase) ?? $vaultJobBase;
    $base = rtrim($webApiBase, '/') . '/research/api';

    return [
        'vault_upload_url'       => $vaultJobBase . '/document_upload_text',
        'research_item_url'      => $base . '/item_upsert',
        'fetch_job_enqueue_url'  => $base . '/fetch_job_enqueue',
        'fetch_job_claim_url'    => $base . '/fetch_job_claim',
        'fetch_job_finish_url'   => $base . '/fetch_job_finish',
        'source_state_patch_url' => $base . '/source_state_patch',
        'watch_config_patch_url' => $base . '/watch_config_patch',
        'match_notify_url'       => $base . '/match_notify',
        'fetch_job_worker_context_url' => $base . '/fetch_job_worker_context',
    ];
}

/**
 * @return \oaaoai\endpoints\CanonicalEndpointsRepository|null
 */
function oaao_research_endpoints_repo(object $controller): ?\oaaoai\endpoints\CanonicalEndpointsRepository
{
    $auth = $controller->api('auth');
    $db = $auth ? $auth->getDB() : null;
    if (! $db) {
        return null;
    }
    require_once dirname(__DIR__, 3) . '/endpoints/default/library/CanonicalEndpointsRepository.php';
    require_once dirname(__DIR__, 3) . '/endpoints/default/library/LlmOrchestratorPayload.php';

    return new \oaaoai\endpoints\CanonicalEndpointsRepository($db, $controller->api('core'));
}

/**
 * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
 */
function oaao_research_resolve_discover_llm(object $controller): ?array
{
    $repo = oaao_research_endpoints_repo($controller);
    if ($repo === null) {
        return null;
    }

    return \oaaoai\endpoints\LlmOrchestratorPayload::fromBinding(
        $repo->resolveResearchDiscoverBinding(),
        $controller->api('chat'),
    );
}

/**
 * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
 */
function oaao_research_resolve_summary_llm(object $controller): ?array
{
    $repo = oaao_research_endpoints_repo($controller);
    if ($repo === null) {
        return null;
    }

    return \oaaoai\endpoints\LlmOrchestratorPayload::fromBinding(
        $repo->resolveResearchSummaryBinding(),
        $controller->api('chat'),
    );
}

/**
 * @return array{purpose_key: string, base_url: string, model: string, api_key_env: string|null}|null
 */
function oaao_research_resolve_match_llm(object $controller): ?array
{
    $repo = oaao_research_endpoints_repo($controller);
    if ($repo === null) {
        return null;
    }

    return \oaaoai\endpoints\LlmOrchestratorPayload::fromBinding(
        $repo->resolveResearchMatchBinding(),
        $controller->api('chat'),
    );
}

/**
 * @return array{summary_llm: array<string, mixed>|null, match_llm: array<string, mixed>|null}
 */
function oaao_research_resolve_worker_llms(object $controller): array
{
    return [
        'summary_llm' => oaao_research_resolve_summary_llm($controller),
        'match_llm'   => oaao_research_resolve_match_llm($controller),
    ];
}
