<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Chat-owned orchestrator payload core — vault scope flags, bubble, skills, attachments.
 */
final class ChatSendOrchestratorCore
{
    /**
     * @param list<int> $attachmentIds
     * @return array<string, mixed>
     */
    public static function buildFragment(
        ChatSendContext $ctx,
        ?int $workspaceId,
        bool $bubbleThread,
        bool $conversationCreated,
        \Razy\Database $splitDb,
        int $conversationId,
        object $user,
        ?object $authApi,
        ?object $endpointsApi,
        ?object $slideDesignerApi,
        object $chatController,
        array $attachmentIds,
    ): array {
        $fragment = [];

        if ($ctx->vaultSourceIds !== []) {
            $fragment['vault_source_ids'] = $ctx->vaultSourceIds;
        }
        if ($ctx->vaultSourceRefs !== []) {
            $fragment['vault_source_refs'] = $ctx->vaultSourceRefs;
        }
        $fragment['vault_auto_rag'] = $ctx->vaultAutoRag;

        if ($workspaceId !== null) {
            $fragment['workspace_id'] = $workspaceId;
        }
        if ($conversationCreated && ! $bubbleThread) {
            $fragment['is_new_conversation'] = true;
        }
        if ($bubbleThread) {
            $fragment['conversation_kind'] = ChatBubbleConversation::KIND;
            $fragment['skip_persistent_agent_hooks'] = true;
        }

        $splitPdo = $splitDb->getDBAdapter();
        if ($splitPdo instanceof \PDO) {
            $fragment['skills_catalog'] = MicroSkillCatalog::forPlanner(
                $splitPdo,
                $user,
                $authApi,
                $ctx->userId,
                $workspaceId,
                (! $bubbleThread && $ctx->hasPublishedSlideTemplate) ? $ctx->slideTemplateId : null,
                $chatController,
                $slideDesignerApi,
            );
            $attachmentFragment = self::chatAttachmentsFragment(
                $splitDb,
                $ctx->userId,
                $conversationId,
                $attachmentIds,
                $chatController,
            );
            if ($attachmentFragment !== []) {
                $fragment['chat_attachments'] = $attachmentFragment;
            }
        }

        if ($endpointsApi !== null && method_exists($endpointsApi, 'getToolServerRegistry')) {
            $fragment['tool_servers'] = $endpointsApi->getToolServerRegistry();
        }
        $fragment['hot_plug_skills'] = SkillsManifestStorage::enabledForPurpose('chat');

        return $fragment;
    }

    /**
     * @param list<int> $attachmentIds
     * @return list<array<string, mixed>>
     */
    public static function chatAttachmentsFragment(
        \Razy\Database $splitDb,
        int $uid,
        int $conversationId,
        array $attachmentIds,
        object $chatController,
    ): array {
        if ($attachmentIds === []) {
            return [];
        }

        ChatAttachmentStorage::claimDraftAttachments($splitDb, $uid, $conversationId, $attachmentIds);
        $canonPdoForAtt = method_exists($chatController, 'oaao_chat_canonical_pdo')
            ? $chatController->oaao_chat_canonical_pdo()
            : null;
        $tenantIdForAtt = 0;
        if ($canonPdoForAtt instanceof \PDO && method_exists($chatController, 'api')) {
            $coreApiAtt = $chatController->api('core');
            $tenantIdForAtt = $coreApiAtt ? $coreApiAtt->bootstrapTenantContext($canonPdoForAtt) : 0;
        }

        /** @var list<array<string, mixed>> $chatAttachments */
        $chatAttachments = [];
        foreach ($attachmentIds as $aid) {
            $ar = $splitDb->prepare()
                ->select('id, conversation_id, file_name, mime_type, storage_path, storage_locator_json, byte_size')
                ->from('conversation_attachment')
                ->where('id=?,conversation_id=?,user_id=?')
                ->assign(['id' => $aid, 'conversation_id' => $conversationId, 'user_id' => $uid])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($ar)) {
                continue;
            }
            $rel = trim((string) ($ar['storage_path'] ?? ''));
            if ($rel === '') {
                continue;
            }
            $locatorJson = isset($ar['storage_locator_json']) ? (string) $ar['storage_locator_json'] : null;
            $relKey = ChatAttachmentStorage::relativeKey($conversationId, $uid, $rel, false);
            $abs = ChatAttachmentStorage::conversationDir($conversationId) . '/' . $rel;
            if ($tenantIdForAtt > 0 && $canonPdoForAtt instanceof \PDO && $locatorJson !== null && trim($locatorJson) !== '') {
                try {
                    $blob = ChatAttachmentStorage::blobStorage($canonPdoForAtt, $tenantIdForAtt);
                    $abs = $blob->resolveAbsolutePath($locatorJson, $relKey, ChatAttachmentStorage::root());
                } catch (\Throwable) {
                }
            }
            $chatAttachments[] = [
                'id'              => (int) ($ar['id'] ?? 0),
                'file_name'       => (string) ($ar['file_name'] ?? ''),
                'mime_type'       => (string) ($ar['mime_type'] ?? ''),
                'absolute_path'   => $abs,
                'byte_size'       => (int) ($ar['byte_size'] ?? 0),
                'storage_locator' => $locatorJson !== null && trim($locatorJson) !== ''
                    ? json_decode($locatorJson, true)
                    : null,
            ];
        }

        return $chatAttachments;
    }

    /**
     * @return array<string, mixed>
     */
    public static function tenantIdFragment(?\Razy\Database $canonDb, object $user, ?object $coreApi): array
    {
        if (! $canonDb instanceof \Razy\Database) {
            return [];
        }
        $canonPdo = $canonDb->getDBAdapter();
        if (! $canonPdo instanceof \PDO) {
            return [];
        }
        $userTenantId = isset($user->tenant_id) ? (int) $user->tenant_id : 0;
        if ($userTenantId > 0) {
            return ['tenant_id' => $userTenantId];
        }
        if ($coreApi !== null && method_exists($coreApi, 'bootstrapTenantContext')) {
            $ctxTid = (int) $coreApi->bootstrapTenantContext($canonPdo);
            if ($ctxTid > 0) {
                return ['tenant_id' => $ctxTid];
            }
        }

        return [];
    }
}
