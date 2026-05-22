<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Slide page regenerate / verify via Python sidecar (HTML sandbox + layout checks).
 *
 * All orchestrator HTTP goes through {@code api('chat')} — pass {@code $chatApi} into each method.
 */
final class SlideOrchestrator
{
    /**
     * @param array<string, mixed>|null $payload
     *
     * @return array<string, mixed>|null
     */
    private static function orchPost(object $chatApi, string $path, ?array $payload, int $timeoutSec): ?array
    {
        return $chatApi->postOrchestratorInternalJson($path, $payload, $timeoutSec);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function orchGet(object $chatApi, string $path, int $timeoutSec): ?array
    {
        return $chatApi->getOrchestratorInternalJson($path, $timeoutSec);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function listSlideSlots(object $chatApi, string $projectId, int $slideIndex): ?array
    {
        return self::orchPost(
            $chatApi,
            '/v1/slides/slide_slots',
            [
                'project_id'     => $projectId,
                'slide_index'    => max(1, $slideIndex),
                'slide_designer' => ['storage_root' => SlideProjectStorage::root()],
            ],
            30,
        );
    }

    /**
     * @param list<array{role: string, content: string}> $messages
     * @param array<string, mixed> $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function regenerateSlot(object $chatApi, 
        string $projectId,
        int $slideIndex,
        string $slotId,
        int $conversationId,
        int $userId,
        array $endpointPayload,
        array $messages,
    ): ?array {
        if (trim($slotId) === '') {
            return null;
        }

        return self::orchPost(
            $chatApi,
            '/v1/slides/regenerate_slot',
            [
                'project_id'      => $projectId,
                'slide_index'     => max(1, $slideIndex),
                'slot_id'         => trim($slotId),
                'conversation_id' => (string) $conversationId,
                'user_id'         => (string) $userId,
                'endpoint'        => $endpointPayload,
                'messages'        => $messages,
                'slide_designer'  => ['storage_root' => SlideProjectStorage::root()],
            ],
            180,
        );
    }

    /**
     * @param list<array{role: string, content: string}> $messages
     * @param array<string, mixed> $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function regeneratePage(object $chatApi, 
        string $projectId,
        int $slideIndex,
        int $conversationId,
        int $userId,
        array $endpointPayload,
        array $messages,
        bool $regenMarkdown = true,
    ): ?array {
        return self::orchPost(
            $chatApi,
            '/v1/slides/regenerate_page',
            [
                'project_id'      => $projectId,
                'slide_index'     => max(1, $slideIndex),
                'conversation_id' => (string) $conversationId,
                'user_id'         => (string) $userId,
                'endpoint'        => $endpointPayload,
                'messages'        => $messages,
                'slide_designer'  => ['storage_root' => SlideProjectStorage::root()],
                'regen_markdown'  => $regenMarkdown,
            ],
            180,
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function verifyPage(object $chatApi, string $projectId, int $slideIndex): ?array
    {
        return self::orchPost(
            $chatApi,
            '/v1/slides/verify_page',
            [
                'project_id'     => $projectId,
                'slide_index'    => max(1, $slideIndex),
                'slide_designer' => ['storage_root' => SlideProjectStorage::root()],
                'auto_fix'       => false,
            ],
            30,
        );
    }

    /**
     * Code verify + self-correct loop (validation errors → LLM → re-test until pass).
     *
     * @param list<array{role: string, content: string}> $messages
     * @param array<string, mixed> $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function verifyAndFixPage(object $chatApi, 
        string $projectId,
        int $slideIndex,
        int $conversationId,
        int $userId,
        array $endpointPayload,
        array $messages,
        bool $autoFix = true,
    ): ?array {
        return self::orchPost(
            $chatApi,
            '/v1/slides/verify_page',
            [
                'project_id'      => $projectId,
                'slide_index'     => max(1, $slideIndex),
                'conversation_id' => (string) $conversationId,
                'user_id'         => (string) $userId,
                'endpoint'        => $endpointPayload,
                'messages'        => $messages,
                'slide_designer'  => ['storage_root' => SlideProjectStorage::root()],
                'auto_fix'        => $autoFix,
            ],
            180,
        );
    }

    /**
     * @param array<string, mixed>|null $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function analyzeTemplate(object $chatApi, 
        string $pptxPath,
        ?array $endpointPayload,
        array $templateScope,
        string $writeScope,
        ?string $label = null,
        ?string $notes = null,
        bool $generatePreview = true,
    ): ?array {
        $body = self::analyzeTemplateRequestBody(
            $pptxPath,
            $endpointPayload,
            $templateScope,
            $writeScope,
            $label,
            $notes,
            $generatePreview,
        );
        if ($body === null) {
            return null;
        }
        $body['background'] = false;

        $result = self::orchPost(
            $chatApi,
            '/v1/slides/template_analyze',
            $body,
            300,
        );
        if ($result === null) {
            return null;
        }

        return self::enrichAnalyzeOrchestratorResult($result, $templateScope);
    }

    /**
     * Kick off background PPTX analyze (orchestrator returns quickly with job_id).
     *
     * @return array<string, mixed>|null
     */
    public static function startAnalyzeTemplate(object $chatApi, 
        string $pptxPath,
        ?array $endpointPayload,
        array $templateScope,
        string $writeScope,
        ?string $label = null,
        ?string $notes = null,
        bool $generatePreview = true,
    ): ?array {
        $body = self::analyzeTemplateRequestBody(
            $pptxPath,
            $endpointPayload,
            $templateScope,
            $writeScope,
            $label,
            $notes,
            $generatePreview,
        );
        if ($body === null) {
            return null;
        }
        $body['background'] = true;

        return self::orchPost(
            $chatApi,
            '/v1/slides/template_analyze',
            $body,
            30,
        );
    }

    /**
     * Poll orchestrator template import job status.
     *
     * @return array<string, mixed>|null
     */
    public static function getTemplateImportJob(object $chatApi, string $jobId, array $templateScope): ?array
    {
        $jobId = trim($jobId);
        if ($jobId === '') {
            return null;
        }

        $result = self::orchGet(
            $chatApi,
            '/v1/slides/template_import_job/' . rawurlencode($jobId),
            30,
        );
        if ($result === null) {
            return null;
        }

        if (($result['status'] ?? '') === 'done') {
            return self::enrichAnalyzeOrchestratorResult($result, $templateScope);
        }

        return $result;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function analyzeTemplateRequestBody(
        string $pptxPath,
        ?array $endpointPayload,
        array $templateScope,
        string $writeScope,
        ?string $label,
        ?string $notes,
        bool $generatePreview,
    ): ?array {
        if (! is_file($pptxPath)) {
            return null;
        }

        $body = [
            'pptx_path'         => $pptxPath,
            'label'             => $label,
            'notes'             => $notes,
            'persist'           => true,
            'generate_preview'  => $generatePreview,
            'write_scope'       => SlideTemplateScope::normalizeScope($writeScope),
            'template_scope'    => SlideTemplateScope::orchestratorPayload($templateScope),
            'slide_designer'    => ['storage_root' => SlideProjectStorage::root()],
        ];
        if (is_array($endpointPayload)) {
            $body['endpoint'] = $endpointPayload;
        }

        return $body;
    }

    /**
     * @param array<string, mixed> $result
     *
     * @return array<string, mixed>
     */
    private static function enrichAnalyzeOrchestratorResult(array $result, array $templateScope): array
    {
        $tid = '';
        if (isset($result['template']) && \is_array($result['template'])) {
            $tid = trim((string) ($result['template']['template_id'] ?? ''));
        }
        if ($tid === '' && isset($result['template_id'])) {
            $tid = trim((string) $result['template_id']);
        }

        return $tid !== ''
            ? (SlideTemplateStorage::enrichPreviewPayload($result, $tid, $templateScope) ?? $result)
            : $result;
    }

    /**
     * @param array<string, mixed>|null $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function generateTemplatePreview(object $chatApi, 
        string $templateId,
        ?array $endpointPayload,
        array $templateScope,
    ): ?array {
        return self::postTemplateWorkflow($chatApi, '/v1/slides/template_preview', $templateId, $endpointPayload, $templateScope, null, 300);
    }

    /**
     * @param array<string, mixed>|null $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function fixTemplatePreview(object $chatApi, 
        string $templateId,
        ?array $endpointPayload,
        array $templateScope,
        ?int $slideIndex = null,
    ): ?array {
        return self::postTemplateWorkflow(
            $chatApi,
            '/v1/slides/template_fix',
            $templateId,
            $endpointPayload,
            $templateScope,
            $slideIndex,
            180,
        );
    }

    /**
     * @param array<string, mixed>|null $endpointPayload
     *
     * @return array<string, mixed>|null
     */
    public static function publishTemplate(object $chatApi, 
        string $templateId,
        ?array $endpointPayload,
        array $templateScope,
        bool $autoFix = true,
    ): ?array {
        if (trim($templateId) === '') {
            return null;
        }

        $body = [
            'template_id'    => trim($templateId),
            'auto_fix'       => $autoFix,
            'template_scope' => SlideTemplateScope::orchestratorPayload($templateScope),
            'slide_designer' => ['storage_root' => SlideProjectStorage::root()],
        ];
        if (is_array($endpointPayload)) {
            $body['endpoint'] = $endpointPayload;
        }

        $result = self::orchPost(
            $chatApi,
            '/v1/slides/template_publish',
            $body,
            180,
        );

        return $result !== null
            ? SlideTemplateStorage::enrichPreviewPayload($result, trim($templateId), $templateScope)
            : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function unpublishTemplate(object $chatApi, string $templateId, array $templateScope): ?array
    {
        if (trim($templateId) === '') {
            return null;
        }

        $body = [
            'template_id'    => trim($templateId),
            'template_scope' => SlideTemplateScope::orchestratorPayload($templateScope),
            'slide_designer' => ['storage_root' => SlideProjectStorage::root()],
        ];

        $result = self::orchPost(
            $chatApi,
            '/v1/slides/template_unpublish',
            $body,
            60,
        );

        return $result !== null
            ? SlideTemplateStorage::enrichPreviewPayload($result, trim($templateId), $templateScope)
            : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function deleteTemplate(object $chatApi, string $templateId, array $templateScope): ?array
    {
        if (trim($templateId) === '') {
            return null;
        }

        $body = [
            'template_id'    => trim($templateId),
            'template_scope' => SlideTemplateScope::orchestratorPayload($templateScope),
            'slide_designer' => ['storage_root' => SlideProjectStorage::root()],
        ];

        return self::orchPost(
            $chatApi,
            '/v1/slides/template_delete',
            $body,
            60,
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function listTemplates(object $chatApi, 
        array $templateScope,
        bool $publishedOnly = false,
        ?string $scopeFilter = null,
    ): ?array {
        $body = [
            'published_only' => $publishedOnly,
            'template_scope' => SlideTemplateScope::orchestratorPayload($templateScope),
        ];
        if ($scopeFilter !== null && $scopeFilter !== '') {
            $body['scope_filter'] = SlideTemplateScope::normalizeScope($scopeFilter);
        }

        return self::orchPost(
            $chatApi,
            '/v1/slides/templates/list',
            $body,
            30,
        );
    }

    /**
     * @param array<string, mixed>|null $endpointPayload
     * @param array<string, mixed> $templateScope
     *
     * @return array<string, mixed>|null
     */
    private static function postTemplateWorkflow(
        object $chatApi,
        string $path,
        string $templateId,
        ?array $endpointPayload,
        array $templateScope,
        ?int $slideIndex,
        int $timeoutSec,
    ): ?array {
        $tid = trim($templateId);
        if ($tid === '') {
            return null;
        }

        $body = [
            'template_id'    => $tid,
            'template_scope' => SlideTemplateScope::orchestratorPayload($templateScope),
            'slide_designer' => ['storage_root' => SlideProjectStorage::root()],
        ];
        if (is_array($endpointPayload)) {
            $body['endpoint'] = $endpointPayload;
        }
        if ($slideIndex !== null && $slideIndex > 0) {
            $body['slide_index'] = $slideIndex;
        }

        $result = self::orchPost($chatApi, $path, $body, $timeoutSec);

        return $result !== null ? SlideTemplateStorage::enrichPreviewPayload($result, $tid, $templateScope) : null;
    }

    /**
     * @param list<array<string, mixed>> $skillsCatalog
     * @param array{profile: array<string, mixed>, endpoint: array<string, mixed>} $binding
     *
     * @return array<string, mixed>|null
     */
    public static function discoverSkills(object $chatApi, 
        string $userMessage,
        array $skillsCatalog,
        string $conversationExcerpt,
        array $binding,
    ): ?array {
        $endpointRow = $binding['endpoint'] ?? [];
        if (! \is_array($endpointRow)) {
            $endpointRow = [];
        }
        $apiKeyRef = isset($endpointRow['api_key_ref']) ? (string) $endpointRow['api_key_ref'] : '';
        $endpointPayload = [
            'endpoint_ref' => trim((string) ($endpointRow['name'] ?? '')),
            'base_url'     => trim((string) ($endpointRow['base_url'] ?? '')),
            'model'        => trim((string) ($endpointRow['model'] ?? '')),
            'api_key_env'  => $apiKeyRef !== '' ? $chatApi->inferOrchestratorApiKeyEnv($apiKeyRef) : null,
        ];

        return self::orchPost(
            $chatApi,
            '/v1/skills/discover',
            [
                'user_message'          => $userMessage,
                'conversation_excerpt'  => $conversationExcerpt,
                'skills_catalog'        => $skillsCatalog,
                'endpoint'              => $endpointPayload,
            ],
            60,
        );
    }
}
