<?php

namespace Module\oaao\slide_designer;

use Razy\Agent;
use Razy\Controller;
use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideProjectMaterial;
use oaaoai\slide_designer\SlideProjectStorage;
use oaaoai\slide_designer\SlideTemplateScope;
use oaaoai\slide_designer\SlideTemplateStorage;

/**
 * Slide designer — planner hooks, project file APIs, preview pipeline (SD-0–SD-4).
 */
return new class extends Controller {
    /**
     * @param bool $jsonResponse When false (slide HTML), omit JSON Content-Type on errors.
     *
     * @return array{0: object|null, 1: \PDO|null}
     */
    protected function oaao_slide_require_user(bool $jsonResponse = true): array
    {
        if ($jsonResponse) {
            header('Content-Type: application/json; charset=UTF-8');
        }

        $auth = $this->api('auth');
        if (! $auth) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Authentication unavailable']);

            return [null, null];
        }

        $auth->restrict(true);
        $user = $auth->getUser();
        $uid = (int) ($user->user_id ?? 0);
        if ($uid < 1) {
            http_response_code(401);
            echo json_encode(['success' => false, 'message' => 'Invalid session']);

            return [null, null];
        }

        $splitDb = $auth->getDBSplit();
        if (! $splitDb || ! $splitDb->getDBAdapter() instanceof \PDO) {
            $auth->ensureAdjunctSqliteLoaded();
            $splitDb = $auth->getDBSplit();
        }

        $pdo = $splitDb?->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Split database unavailable']);

            return [$user, null];
        }

        return [$user, $pdo];
    }

    public function __onInit(Agent $agent): bool
    {
        $coreApi = $this->api('core');
        if ($coreApi && method_exists($coreApi, 'registerSpaPage')) {
            $coreApi->registerSpaPage(
                'workspace/templates',
                'Templates',
                'Import and publish slide deck templates',
                'square-dashed-kanban',
                [
                    'shell_panel_url' => '/slide-designer/workspace-templates-panel',
                    'shell_js_module'  => '/webassets/slide-designer/default/js/template-gallery-sidebar.js',
                ],
            );
        }

        if ($coreApi && method_exists($coreApi, 'registerFeatureScope')) {
            $coreApi->registerFeatureScope(
                'slide_templates',
                'Slide templates',
                'Imported PPTX templates — platform-global, tenant-wide, or personal.',
                ['tenant', 'personal'],
                45,
                ['notes' => 'Platform-global templates use scope=global (platform_admin only).'],
            );
        }

        $agent->listen('oaaoai/endpoints:collect_feature_registries', 'event/collect_feature_registries');

        $agent->addAPICommand([
            'resolvePublishedTemplate'           => 'resolvePublishedTemplate',
            'orchestratorSlideDesignerBase'      => 'orchestratorSlideDesignerBase',
            'listBoundTemplateSkillsForPlanner'  => 'listBoundTemplateSkillsForPlanner',
            'discoverSkillsForPlanner'            => 'discoverSkillsForPlanner',
            'resolvePublishedTemplateSkill'        => 'resolvePublishedTemplateSkill',
            'resolveSlideMaterialByProjectId'      => 'resolveSlideMaterialByProjectId',
            'listSlidePlannerRowsForConversation'    => 'listSlidePlannerRowsForConversation',
            'resolveSlideProjectDownloadPath'      => 'resolveSlideProjectDownloadPath',
            'readSlideProjectTextFile'             => 'readSlideProjectTextFile',
            'enrichAndSyncAssistantSlideMeta'      => 'enrichAndSyncAssistantSlideMeta',
        ]);

        $agent->addLazyRoute([
            'GET workspace-templates-panel' => 'panel/workspace_templates_panel',
            'api' => [
                'GET slide_html'              => 'slide_html',
                'GET download'                => 'download',
                'POST project_create'         => 'project_create',
                'GET project_resume'          => 'project_resume',
                'POST slide_regenerate'       => 'slide_regenerate',
                'POST slide_regenerate_slot'  => 'slide_regenerate_slot',
                'POST slide_slots'            => 'slide_slots',
                'POST slide_verify'           => 'slide_verify',
                'POST template_analyze'       => 'template_analyze',
                'GET template_import_job'     => 'template_import_job',
                'GET template_list'           => 'template_list',
                'POST template_preview'       => 'template_preview',
                'POST template_fix'           => 'template_fix',
                'POST template_publish'       => 'template_publish',
                'POST template_unpublish'     => 'template_unpublish',
                'POST template_delete'        => 'template_delete',
                'GET template_preview_html'   => 'template_preview_html',
                'GET template_master_html'    => 'template_master_html',
                'GET template_render'         => 'template_render',
                'GET template_material'       => 'template_material',
                'GET template_font'           => 'template_font',
                'GET template_thumbnail'      => 'template_thumbnail',
                'POST template_thumbnail'     => 'template_thumbnail',
            ],
        ]);

        return true;
    }

    /**
     * @return array{template_id: string, label: string, status: string}|null
     */
    public function resolvePublishedTemplate(string $templateId): ?array
    {
        [$user, ] = $this->oaao_slide_require_user();
        if (! $user) {
            return null;
        }
        $templateId = trim($templateId);
        if ($templateId === '') {
            return null;
        }
        $auth = $this->api('auth');
        $scope = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
        $row = SlideTemplateStorage::resolveTemplateRecord($templateId, $scope);
        if ($row === null || (string) ($row['status'] ?? '') !== 'published') {
            return null;
        }
        $label = trim((string) ($row['label'] ?? ''));
        if ($label === '') {
            $label = $templateId;
        }

        return [
            'template_id' => $templateId,
            'label'       => $label,
            'status'      => 'published',
        ];
    }

    /**
     * @param array<string, mixed> $extras
     *
     * @return array<string, mixed>
     */
    public function orchestratorSlideDesignerBase(array $extras = []): array
    {
        $payload = ['storage_root' => SlideProjectStorage::root()];

        return $extras !== [] ? array_merge($payload, $extras) : $payload;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function resolvePublishedTemplateSkill(string $templateId): ?array
    {
        [$user, ] = $this->oaao_slide_require_user();
        if (! $user) {
            return null;
        }
        $templateId = trim($templateId);
        if ($templateId === '') {
            return null;
        }
        $auth = $this->api('auth');
        $scope = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
        $tpl = SlideTemplateStorage::resolveTemplateRecord($templateId, $scope);
        if (! \is_array($tpl) || (string) ($tpl['status'] ?? '') !== 'published') {
            return null;
        }
        $micro = $tpl['micro_skills'] ?? null;
        if (! \is_array($micro)) {
            $micro = [];
        }
        $label = trim((string) ($tpl['label'] ?? $templateId));
        $brief = trim((string) ($micro['agent_brief'] ?? ''));
        $summary = $brief !== '' ? $brief : "Template «{$label}».";

        return [
            'skill_id'         => 'bound_template:' . $templateId,
            'kind'             => 'bound_template',
            'title'            => $label,
            'summary'          => mb_substr($summary, 0, 500),
            'bind_ref'         => $templateId,
            'provider_id'      => 'slide_designer.bound_template',
            'module_code'      => 'oaaoai/slide-designer',
            'payload'          => $micro,
            'status'           => 'published',
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listBoundTemplateSkillsForPlanner(int $limit = 16): array
    {
        [$user, ] = $this->oaao_slide_require_user();
        if (! $user) {
            return [];
        }
        $chat = $this->api('chat');
        if (! $chat) {
            return [];
        }
        $auth = $this->api('auth');
        $ctx = SlideTemplateScope::contextFromAuthModule($user, $auth, $this->api('core'));
        $payload = SlideOrchestrator::listTemplates($chat, $ctx, true, null);
        $rows = \is_array($payload) ? ($payload['custom_templates'] ?? []) : [];
        if (! \is_array($rows)) {
            return [];
        }
        $out = [];
        foreach (\array_slice($rows, 0, max(1, min($limit, 48))) as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $tid = trim((string) ($row['template_id'] ?? ''));
            if ($tid === '' || (string) ($row['status'] ?? '') !== 'published') {
                continue;
            }
            $micro = $row['micro_skills'] ?? null;
            if (! \is_array($micro)) {
                $micro = [];
            }
            $label = trim((string) ($row['label'] ?? $tid));
            $brief = trim((string) ($micro['agent_brief'] ?? ''));
            $summary = $brief !== '' ? $brief : "Template «{$label}».";
            $out[] = [
                'skill_id'         => 'bound_template:' . $tid,
                'kind'             => 'bound_template',
                'title'            => $label,
                'summary'          => mb_substr($summary, 0, 500),
                'bind_ref'         => $tid,
                'provider_id'      => 'slide_designer.bound_template',
                'module_code'      => 'oaaoai/slide-designer',
                'payload'          => $micro,
                'status'           => 'published',
            ];
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $skillsCatalog
     * @param array{profile: array<string, mixed>, endpoint: array<string, mixed>} $binding
     *
     * @return array<string, mixed>|null
     */
    public function discoverSkillsForPlanner(
        string $userMessage,
        array $skillsCatalog,
        string $conversationExcerpt,
        array $binding,
    ): ?array {
        $chat = $this->api('chat');
        if (! $chat) {
            return null;
        }
        return SlideOrchestrator::discoverSkills(
            $chat,
            $userMessage,
            $skillsCatalog,
            $conversationExcerpt,
            $binding,
        );
    }

    /**
     * @return array{project_id: string, material: array<string, mixed>}|null
     */
    public function resolveSlideMaterialByProjectId(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        string $projectId,
    ): ?array {
        return SlideProjectMaterial::resolveByProjectId(
            $pdo,
            $conversationId,
            $userId,
            $projectId,
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listSlidePlannerRowsForConversation(
        \PDO $pdo,
        int $conversationId,
        int $userId,
        int $limit = 12,
    ): array {
        return SlideProjectMaterial::listPlannerRowsForConversation(
            $pdo,
            $conversationId,
            $userId,
            $limit,
        );
    }

    /**
     * @return array{path: string, name: string}|null
     */
    public function resolveSlideProjectDownloadPath(
        \PDO $pdo,
        int $userId,
        int $conversationId,
        string $uri,
    ): ?array {
        return SlideProjectMaterial::resolveDownloadPath(
            $pdo,
            $userId,
            $conversationId,
            $uri,
        );
    }

    public function readSlideProjectTextFile(string $projectId, string $fileName, int $maxChars): string
    {
        return SlideProjectMaterial::readProjectTextFile($projectId, $fileName, $maxChars);
    }

    /**
     * @param array<string, mixed> $meta
     *
     * @return array<string, mixed>
     */
    public function enrichAndSyncAssistantSlideMeta(
        \PDO $pdo,
        int $conversationId,
        int $messageId,
        int $userId,
        ?int $workspaceId,
        array $meta,
    ): array {
        return SlideProjectMaterial::enrichAndSyncAssistantMeta(
            $pdo,
            $conversationId,
            $messageId,
            $userId,
            $workspaceId,
            $meta,
        );
    }

    /**
     * {@inheritDoc}
     */
    public function __onAPICall(\Razy\ModuleInfo $module, string $method, string $fqdn = ''): bool
    {
        $code = $module->getCode();
        if (! str_starts_with($code, 'oaaoai/')) {
            return false;
        }

        return \in_array($method, [
            'resolvePublishedTemplate',
            'orchestratorSlideDesignerBase',
            'listBoundTemplateSkillsForPlanner',
            'discoverSkillsForPlanner',
            'resolvePublishedTemplateSkill',
            'resolveSlideMaterialByProjectId',
            'listSlidePlannerRowsForConversation',
            'resolveSlideProjectDownloadPath',
            'readSlideProjectTextFile',
            'enrichAndSyncAssistantSlideMeta',
        ], true);
    }
};
