<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

use oaaoai\chat\ChatConversationMaterial;
use oaaoai\chat\ChatSendContext;

/**
 * Slide-designer orchestrator payload for chat send ({@code slide_designer}, materials, grounding).
 */
final class SlideSendOrchestratorPayload
{
    /**
     * @param object|null $slideDesignerApi {@see \\Module\\oaao\\slide_designer::orchestratorSlideDesignerBase}
     * @return array<string, mixed>
     */
    public static function buildFragment(
        ?object $slideDesignerApi,
        ChatSendContext $ctx,
        \PDO $splitPdo,
        int $conversationId,
        bool $bubbleThread,
        string $activeMaterialId,
        int $reuseGroundingMid,
        ?\PDO $canonPdoGround,
        int $tenantIdGround,
    ): array {
        if ($bubbleThread || $conversationId < 1) {
            return [
                'slide_designer' => self::basePayload($slideDesignerApi, []),
            ];
        }

        /** @var array<string, mixed> $slideExtras */
        $slideExtras = [];
        if ($ctx->hasPublishedSlideTemplate) {
            $slideExtras['template_id'] = $ctx->slideTemplateId;
            $slideExtras['start_new_deck'] = true;
        }

        $slideDesignerPayload = self::basePayload($slideDesignerApi, $slideExtras);

        /** @var array<string, mixed> $fragment */
        $fragment = [];

        if ($activeMaterialId !== '') {
            $slideDesignerPayload['active_material_id'] = $activeMaterialId;
            $resolved = ChatConversationMaterial::resolveSlideProjectMaterial(
                $splitPdo,
                $conversationId,
                $ctx->userId,
                $activeMaterialId,
                $slideDesignerApi,
            );
            if ($resolved !== null) {
                $slideDesignerPayload['resume_project_id'] = $resolved['project_id'];
                unset($slideDesignerPayload['start_new_deck']);
            }
        }

        $fragment['conversation_materials'] = ChatConversationMaterial::catalogForPlanner(
            $splitPdo,
            $conversationId,
            $ctx->userId,
            16,
            $slideDesignerApi,
        );

        $grounding = ChatConversationMaterial::groundingContextForOrchestrator(
            $splitPdo,
            $conversationId,
            $ctx->userId,
            $activeMaterialId !== '' ? $activeMaterialId : null,
            $reuseGroundingMid,
            $slideDesignerApi,
            $canonPdoGround,
            $tenantIdGround,
        );
        if ($grounding !== []) {
            $fragment['conversation_material_grounding'] = $grounding;
        }
        if ($reuseGroundingMid > 0) {
            $fragment['reuse_grounding_message_id'] = $reuseGroundingMid;
        }

        $fragment['slide_designer'] = $slideDesignerPayload;

        return $fragment;
    }

    /**
     * @param array<string, mixed> $extras
     * @return array<string, mixed>
     */
    private static function basePayload(?object $slideDesignerApi, array $extras): array
    {
        if ($slideDesignerApi !== null && method_exists($slideDesignerApi, 'orchestratorSlideDesignerBase')) {
            return $slideDesignerApi->orchestratorSlideDesignerBase($extras);
        }

        return ['storage_root' => ''];
    }
}
