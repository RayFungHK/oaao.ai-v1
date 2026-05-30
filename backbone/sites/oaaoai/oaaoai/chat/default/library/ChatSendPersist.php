<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\endpoints\ChatInferencePurposeConfig;
use oaaoai\user\UserModelParams;

/**
 * Adjunct SQLite TX for chat send ({@code chat.send.persist} boundary + conversation/messages).
 */
final class ChatSendPersist
{
    /**
     * @param array<string, int|float|null>|null $inputModelParamsNorm
     * @param list<int> $attachmentIds
     *
     * @throws ChatSendAbort On validation failures inside the TX (rolled back).
     */
    public static function execute(
        ChatSendPipeline $pipeline,
        ChatSendContext $ctx,
        object $chatController,
        \Razy\Database $splitDb,
        \PDO $pdo,
        ?\Razy\Database $canonDb,
        int $uid,
        ?int $wid,
        bool $isBubbleChat,
        bool $bubbleThread,
        ?int $conversationId,
        string $content,
        bool $appendAssistantTurn,
        int $continueAssistantId,
        string $inputPlannerMode,
        string $inputInferenceMode,
        ?array $inputModelParamsNorm,
        int $chatEndpointId,
        bool $orchReady,
        string $assistantInsertContent,
        array $attachmentIds,
        bool $hasPublishedSlideTemplate,
        string $slideTemplateLabel,
    ): ChatSendPersistResult {
        $pdo->beginTransaction();
        $pipeline->run(ChatSendPhase::PERSIST, $ctx, [
            'split_db' => $splitDb,
            'pdo'      => $pdo,
        ]);

        $conversationCreated = false;
        $conversationModeId = 'default';
        $plannerModeId = 'default';
        /** @var array<string, mixed>|null $paramsDec */
        $paramsDec = null;

        if ($conversationId !== null && $conversationId > 0) {
            $own = ChatConversationScope::findForUser($splitDb, $uid, (int) $conversationId, $wid, 'id, params_json');
            if ($own === null) {
                self::abort($pdo, 404, ['success' => false, 'message' => 'Conversation not found']);
            }
            if (ChatBubbleConversation::isBubbleRow($own)) {
                $bubbleThread = true;
                if (ChatBubbleConversation::isExpiredParams(ChatBubbleConversation::paramsFromRow($own))) {
                    $pdo->rollBack();
                    try {
                        $splitDb->delete('message', ['conversation_id' => (int) $conversationId])->query();
                        $splitDb->delete('conversation', ['id' => (int) $conversationId, 'user_id' => $uid])->query();
                    } catch (\Throwable) {
                    }
                    throw new ChatSendAbort(410, [
                        'success' => false,
                        'message' => 'Bubble chat expired',
                        'code'    => 'bubble_expired',
                    ]);
                }
                ChatBubbleConversation::touchExpiry($splitDb, (int) $conversationId, $uid);
            }
            $paramsRaw = trim((string) ($own['params_json'] ?? ''));
            if ($paramsRaw !== '') {
                try {
                    $paramsDec = json_decode($paramsRaw, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($paramsDec)) {
                        if (strtolower(trim((string) ($paramsDec['mode'] ?? ''))) === 'desk') {
                            $conversationModeId = 'desk';
                        }
                        $pm = strtolower(trim((string) ($paramsDec['planner_mode_id'] ?? '')));
                        if (\in_array($pm, ['default', 'tot', 'ddtree'], true)) {
                            $plannerModeId = $pm;
                        }
                    } else {
                        $paramsDec = null;
                    }
                } catch (\JsonException) {
                    $paramsDec = null;
                }
            }
            if ($inputPlannerMode !== '') {
                $plannerModeId = $inputPlannerMode;
            }
        } else {
            $title = $isBubbleChat ? 'Bubble' : 'New chat';
            if (! $isBubbleChat && $hasPublishedSlideTemplate && $slideTemplateLabel !== '') {
                $title = mb_substr($slideTemplateLabel, 0, 80);
            }
            $nowConv = date('Y-m-d H:i:s');
            $insertCols = ['user_id', 'workspace_id', 'title', 'created_at', 'updated_at'];
            $insertAssign = [
                'user_id'      => $uid,
                'workspace_id' => $wid,
                'title'        => $title,
                'created_at'   => $nowConv,
                'updated_at'   => $nowConv,
            ];
            if ($isBubbleChat) {
                $insertCols[] = 'params_json';
                $insertAssign['params_json'] = ChatBubbleConversation::initialParamsJson();
            }
            $splitDb->insert('conversation', $insertCols)
                ->assign($insertAssign)
                ->query();
            $conversationId = (int) $splitDb->lastID();
            $conversationCreated = true;
            if ($conversationId < 1) {
                self::abort($pdo, 500, ['success' => false, 'message' => 'Could not create conversation']);
            }
            if ($inputPlannerMode !== '') {
                $plannerModeId = $inputPlannerMode;
            }
        }

        if ($conversationId > 0 && $inputPlannerMode !== '' && $inputPlannerMode !== 'default') {
            $params = [];
            $paramsRow = $splitDb->prepare()
                ->select('params_json')
                ->from('conversation')
                ->where('id=?,user_id=?')
                ->assign(['id' => $conversationId, 'user_id' => $uid])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($paramsRow)) {
                $paramsRawPersist = trim((string) ($paramsRow['params_json'] ?? ''));
                if ($paramsRawPersist !== '') {
                    try {
                        $paramsDecPersist = json_decode($paramsRawPersist, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($paramsDecPersist)) {
                            $params = $paramsDecPersist;
                        }
                    } catch (\JsonException) {
                    }
                }
            }
            if ($conversationModeId === 'desk') {
                $params['mode'] = 'desk';
            }
            $params['planner_mode_id'] = $plannerModeId;
            $splitDb->update('conversation', ['params_json', 'updated_at'])
                ->where('id=?,user_id=?')
                ->assign([
                    'params_json' => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'updated_at'  => date('Y-m-d H:i:s'),
                    'id'          => $conversationId,
                    'user_id'     => $uid,
                ])
                ->query();
        }

        if ($conversationId > 0 && $conversationCreated && $inputInferenceMode !== '') {
            $paramsInf = [];
            $paramsRowInf = $splitDb->prepare()
                ->select('params_json')
                ->from('conversation')
                ->where('id=?,user_id=?')
                ->assign(['id' => $conversationId, 'user_id' => $uid])
                ->limit(1)
                ->query()
                ->fetch();
            if (\is_array($paramsRowInf)) {
                $paramsRawInf = trim((string) ($paramsRowInf['params_json'] ?? ''));
                if ($paramsRawInf !== '') {
                    try {
                        $decodedInf = json_decode($paramsRawInf, true, 512, JSON_THROW_ON_ERROR);
                        if (\is_array($decodedInf)) {
                            $paramsInf = $decodedInf;
                        }
                    } catch (\JsonException) {
                    }
                }
            }
            $infPatch = ['mode' => $inputInferenceMode];
            if ($inputInferenceMode === ChatInferenceControl::MODE_MANUAL && $inputModelParamsNorm !== null) {
                $infPatch['model_params'] = $inputModelParamsNorm;
            }
            if (
                $inputInferenceMode === ChatInferenceControl::MODE_AUTO_TUNE
                && ChatInferenceControl::modeFromConversation($paramsInf) !== ChatInferenceControl::MODE_AUTO_TUNE
            ) {
                $purposeMpSeed = [];
                if ($canonDb instanceof \Razy\Database) {
                    $purposeMpSeed = ChatInferencePurposeConfig::resolveDefaultsForChatEndpoint(
                        $canonDb,
                        $chatEndpointId > 0 ? $chatEndpointId : 0,
                    );
                }
                $userMpSeed = [];
                $canonPdoSeed = ChatSendCanonicalPdo::fromCanonDb($canonDb);
                if ($canonPdoSeed instanceof \PDO) {
                    $userMpSeed = UserModelParams::activeOverrides(
                        UserModelParams::loadForUser($canonPdoSeed, $uid),
                    );
                }
                $infPatch['auto_state'] = ChatInferenceControl::initialAutoState($purposeMpSeed, $userMpSeed);
            }
            $paramsInf = ChatInferenceControl::mergeIntoParams($paramsInf, $infPatch);
            $splitDb->update('conversation', ['params_json', 'updated_at'])
                ->where('id=?,user_id=?')
                ->assign([
                    'params_json' => json_encode($paramsInf, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    'updated_at'  => date('Y-m-d H:i:s'),
                    'id'          => $conversationId,
                    'user_id'     => $uid,
                ])
                ->query();
            $paramsDec = $paramsInf;
        }

        $nowMsg = date('Y-m-d H:i:s');
        /** @var list<array<string, mixed>> $attRows */
        $attRows = [];
        if ($attachmentIds !== []) {
            ChatAttachmentStorage::claimDraftAttachments($splitDb, $uid, (int) $conversationId, $attachmentIds);
            $attRows = ChatAttachmentStorage::loadRowsForIds($splitDb, (int) $conversationId, $uid, $attachmentIds);
        }

        $canonicalPdo = ChatSendCanonicalPdo::fromCanonDb($canonDb);

        try {
            $pipeline->run(ChatSendPhase::CONVERSATION_SETTLE, $ctx, [
                'split_db'              => $splitDb,
                'conversation_id'       => (int) $conversationId,
                'canonical_db'          => $canonDb,
                'canonical_pdo'         => $canonicalPdo,
                'attachment_rows'       => $attRows,
                'now_msg'               => $nowMsg,
                'params_dec'            => $paramsDec,
                'continue_assistant_id' => $continueAssistantId,
            ]);
        } catch (ChatSendAbort $abort) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $abort;
        }

        $conversationTitleOut = $ctx->conversationTitleOut;
        $inferenceSnapshot = $ctx->inferenceSnapshot;
        $userMeta = ChatSendConversationSettle::encodeUserMeta($ctx->userMetaArr);
        $userCols = ['conversation_id', 'role', 'content', 'created_at'];
        $userAssign = [
            'conversation_id' => $conversationId,
            'role'            => 'user',
            'content'         => $content,
            'created_at'      => $nowMsg,
        ];
        if ($userMeta !== null) {
            $userCols[] = 'meta_json';
            $userAssign['meta_json'] = $userMeta;
        }
        $priorLastMessageId = 0;
        if ((int) $conversationId > 0) {
            $priorRow = $splitDb->prepare()
                ->select('id')
                ->from('message')
                ->where('conversation_id=?')
                ->assign(['conversation_id' => (int) $conversationId])
                ->order('-id')
                ->limit(1)
                ->query()
                ->fetch();
            $priorLastMessageId = \is_array($priorRow) ? (int) ($priorRow['id'] ?? 0) : 0;
        }
        $splitDb->insert('message', $userCols)->assign($userAssign)->query();
        $userMsgId = (int) $splitDb->lastID();

        $asstMetaJson = ChatSendConversationSettle::encodeAssistantInferenceMeta($inferenceSnapshot);
        if ($appendAssistantTurn) {
            $asstExisting = $splitDb->prepare()
                ->select('id, content')
                ->from('message')
                ->where('id=?,conversation_id=?,role=?')
                ->assign([
                    'id'              => $continueAssistantId,
                    'conversation_id' => $conversationId,
                    'role'            => 'assistant',
                ])
                ->limit(1)
                ->query()
                ->fetch();
            if (! \is_array($asstExisting) || ! isset($asstExisting['id'])) {
                self::abort($pdo, 404, ['success' => false, 'message' => 'Assistant message not found']);
            }
            $asstMsgId = $continueAssistantId;
            $assistantInsertContent = (string) ($asstExisting['content'] ?? '');
        } else {
            $asstCols = ['conversation_id', 'role', 'content', 'created_at'];
            $asstAssign = [
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
                'content'         => $assistantInsertContent,
                'created_at'      => $nowMsg,
            ];
            if ($asstMetaJson !== null) {
                $asstCols[] = 'meta_json';
                $asstAssign['meta_json'] = $asstMetaJson;
            }
            $splitDb->insert('message', $asstCols)->assign($asstAssign)->query();
            $asstMsgId = (int) $splitDb->lastID();
        }

        $splitDb->update('conversation', ['updated_at'])
            ->where('id=?')
            ->assign([
                'updated_at' => date('Y-m-d H:i:s'),
                'id'         => $conversationId,
            ])
            ->query();

        $pdo->commit();

        return new ChatSendPersistResult(
            conversationId: (int) $conversationId,
            conversationCreated: $conversationCreated,
            bubbleThread: $bubbleThread,
            conversationModeId: $conversationModeId,
            plannerModeId: $plannerModeId,
            userMsgId: $userMsgId,
            asstMsgId: $asstMsgId,
            assistantInsertContent: $assistantInsertContent,
            conversationTitleOut: $conversationTitleOut,
            inferenceSnapshot: $inferenceSnapshot,
            priorLastMessageId: $priorLastMessageId,
        );
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @throws ChatSendAbort
     */
    private static function abort(\PDO $pdo, int $httpStatus, array $payload): never
    {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw new ChatSendAbort($httpStatus, $payload);
    }
}
