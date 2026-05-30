<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;
use oaaoai\chat\MicroSkillsRegister;
use oaaoai\chat\SkillsManifestStorage;
use oaaoai\endpoints\ToolServerRegister;
use oaaoai\endpoints\ToolServerStorage;

/**
 * GET /chat/api/skills_admin — administrator: micro-skill providers + tool servers registry.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if ($this->oaao_chat_require_admin() === null) {
        return;
    }

    require_once dirname(__DIR__, 4) . '/endpoints/default/library/ToolServerStorage.php';
    require_once dirname(__DIR__, 4) . '/endpoints/default/library/ToolServerRegister.php';
    require_once __DIR__ . '/../../library/SkillsManifestStorage.php';

    ToolServerStorage::bootstrapPersisted();

    $persisted = ToolServerStorage::loadPersisted();
    $registered = ToolServerRegister::allSorted();

    $skillCounts = ['total' => 0, 'published' => 0, 'draft' => 0];
    $auth = $this->api('auth');
    $splitDb = $auth ? $auth->getDBSplit() : null;
    $pdo = $splitDb?->getDBAdapter();
    if ($pdo instanceof \PDO) {
        try {
            $this->ensureMicroSkillSchema($pdo);
            $row = $pdo->query(
                'SELECT COUNT(*) AS total,
                        SUM(CASE WHEN status = \'published\' THEN 1 ELSE 0 END) AS published,
                        SUM(CASE WHEN status = \'draft\' THEN 1 ELSE 0 END) AS draft
                 FROM oaao_micro_skill',
            )->fetch(\PDO::FETCH_ASSOC);
            if (\is_array($row)) {
                $skillCounts['total'] = (int) ($row['total'] ?? 0);
                $skillCounts['published'] = (int) ($row['published'] ?? 0);
                $skillCounts['draft'] = (int) ($row['draft'] ?? 0);
            }
        } catch (\Throwable $e) {
            error_log('skills_admin counts failed: ' . $e->getMessage());
        }
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'providers'           => MicroSkillsRegister::allSorted(),
            'kinds'               => MicroSkillsRegister::kinds(),
            'tool_servers'        => $registered,
            'tool_servers_file'   => ToolServerStorage::configPath(),
            'tool_servers_persisted_count' => \count($persisted),
            'hot_plug_skills'     => SkillsManifestStorage::loadPersisted(),
            'skills_manifest_file' => SkillsManifestStorage::configPath(),
            'hot_plug_skills_count' => \count(SkillsManifestStorage::loadPersisted()),
            'micro_skill_counts'  => $skillCounts,
            'crystallization_stats' => (function () {
                $resp = ChatOrchestratorApi::getInternalJson('/v1/admin/crystallization/stats', 15);

                return \is_array($resp) ? $resp : [];
            })(),
            'iqs_action_distribution' => (function () {
                $resp = ChatOrchestratorApi::getInternalJson('/v1/admin/evolution/metrics/iqs_actions', 15);

                return \is_array($resp['distribution'] ?? null) ? $resp['distribution'] : [];
            })(),
            'env_hints'           => [
                'OAAO_SEARXNG_URL'          => (string) (getenv('OAAO_SEARXNG_URL') ?: ''),
                'OAAO_SKILLS_MANIFEST_PATH' => (string) (getenv('OAAO_SKILLS_MANIFEST_PATH') ?: SkillsManifestStorage::configPath()),
                'OAAO_TOOL_SERVERS_PATH'    => (string) (getenv('OAAO_TOOL_SERVERS_PATH') ?: ToolServerStorage::configPath()),
            ],
        ],
    ], JSON_UNESCAPED_UNICODE);
};
