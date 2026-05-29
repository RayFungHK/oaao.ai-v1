<?php

use oaaoai\chat\ChatInferenceControl;
use oaaoai\chat\ChatSendAbort;
use oaaoai\chat\ChatSendContext;
use oaaoai\chat\ChatSendHttp;
use oaaoai\chat\ChatSendOrchestratorStage;
use oaaoai\chat\ChatSendPersist;
use oaaoai\chat\ChatSendPhase;
use oaaoai\chat\ChatSendPipeline;
use oaaoai\chat\ChatSendRespondInput;
use oaaoai\chat\ChatSendResponder;
use oaaoai\chat\ChatSendRunStarter;
use oaaoai\chat\ChatSendValidator;
use oaaoai\user\UserModelParams;

/**
 * POST /chat/api/send — append user message + assistant row; when orchestrator + binding exist, start Python stream run.
 *
 * Body JSON: { "conversation_id": number|null, "content": string, "chat_endpoint_id"?: number|null, "workspace_id"?: number,
 *             "vault_source_ids"?: number[], "vault_source_refs"?: { kind: "vault"|"folder"|"document", id: number, vault_id: number, name?: string }[],
 *             "vault_auto_rag"?: bool — when true and no explicit vault picks, expand to all vaults in the current workspace / personal scope,
 *             "enable_web_search"?: bool — when true, allow {@code web_search} agent for this turn (if enabled in Task planner settings),
 *             "attachment_ids"?: number[] — ephemeral conversation attachments (this turn only),
 *             "active_material_id"?: string — continue a slide deck ({@code slide-{project_id}}),
 *             "reuse_grounding_message_id"?: int — retry/regenerate: load material container from this assistant turn,
 *             "continue_assistant_message_id"?: int — append to an existing truncated assistant reply (same message row),
 *             "slide_template_id"?: string — published custom template for a new deck,
 *             "planner_mode_id"?: "default"|"tot"|"ddtree" — thread planner mode (persisted on new chats),
 *             "corpus_id"?: number — Corpus Studio style injection (CS-1-S10); programmatic only, not chat composer,
 *             "bubble"?: bool — ephemeral Bubble Chat dialog thread (excluded from sidebar; TTL in params_json) }
 */
return function (): void {
    [$splitDb, $user, $pdo] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $authApi = $this->api('auth');
    $canonDbEarly = $authApi ? $authApi->getDB() : null;

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $wid = $this->oaao_chat_resolve_workspace_id($input);

    $content = trim((string) ($input['content'] ?? ''));
    $continueAssistantId = (int) ($input['continue_assistant_message_id'] ?? 0);
    $appendAssistantTurn = $continueAssistantId > 0;
    $conversationId = $input['conversation_id'] ?? null;
    $conversationId = ($conversationId === null || $conversationId === '') ? null : (int) $conversationId;
    $isBubbleChat = ! empty($input['bubble']);
    $bubbleThread = $isBubbleChat;

    $inputPlannerMode = '';
    if (isset($input['planner_mode_id'])) {
        $pmIn = strtolower(trim((string) $input['planner_mode_id']));
        if (\in_array($pmIn, ['default', 'tot', 'ddtree'], true)) {
            $inputPlannerMode = $pmIn;
        }
    }

    $inputInferenceMode = '';
    if (isset($input['inference_mode'])) {
        $inputInferenceMode = ChatInferenceControl::normalizeMode((string) $input['inference_mode']);
    }
    /** @var array<string, int|float|null>|null $inputModelParamsNorm */
    $inputModelParamsNorm = null;
    if (\array_key_exists('model_params', $input) && \is_array($input['model_params'])) {
        $inputModelParamsNorm = UserModelParams::normalize($input['model_params']);
    }

    $chatEndpointRaw = $input['chat_endpoint_id'] ?? null;
    $chatEndpointId = ($chatEndpointRaw === null || $chatEndpointRaw === '') ? 0 : (int) $chatEndpointRaw;

    $sendCtx = new ChatSendContext(
        userId: $uid,
        workspaceId: $wid,
        input: $input,
        chatEndpointId: $chatEndpointId,
        isBubbleChat: $isBubbleChat,
        appendAssistantTurn: $appendAssistantTurn,
        conversationId: $conversationId,
    );

    $sendPipeline = new ChatSendPipeline($this);
    $assistantStub = '*(Preview)* Connect an LLM endpoint and sidecar to stream real replies. Stored locally: your message was received.';

    try {
        ChatSendValidator::assertAuthenticatedUser($uid);
        ChatSendValidator::assertContinueConversation($conversationId, $appendAssistantTurn);

        $sendPipeline->run(ChatSendPhase::GATE, $sendCtx, [
            'user'         => $user,
            'auth_api'     => $authApi,
            'core_api'     => $this->api('core'),
            'canonical_db' => $canonDbEarly,
        ]);
        $sendPipeline->run(ChatSendPhase::PREPARE, $sendCtx);
        $sendPipeline->run(ChatSendPhase::MESSAGE, $sendCtx, ['raw_content' => $content]);

        ChatSendValidator::assertContentLength($sendCtx->content);

        $canonDb = $authApi ? $authApi->getDB() : null;
        if ($canonDb instanceof \Razy\Database) {
            $sendPipeline->run(ChatSendPhase::SCOPE, $sendCtx, [
                'canonical_db' => $canonDb,
                'auth_api'     => $authApi,
            ]);
        }

        ChatSendValidator::assertRunnableChatEndpoint(
            $canonDb instanceof \Razy\Database ? $canonDb : null,
            $chatEndpointId,
        );

        $binding = null;
        $internalBase = '';
        if ($canonDb instanceof \Razy\Database) {
            $sendPipeline->run(ChatSendPhase::ORCHESTRATOR_READY, $sendCtx, [
                'stage'        => ChatSendOrchestratorStage::BIND,
                'canonical_db' => $canonDb,
            ]);
            $binding = $sendCtx->binding;
            $internalBase = $sendCtx->internalBase;
        }

        $orchReady = $sendCtx->orchReady;
        $assistantInsertContent = $orchReady ? '' : $assistantStub;

        $persist = ChatSendPersist::execute(
            pipeline: $sendPipeline,
            ctx: $sendCtx,
            chatController: $this,
            splitDb: $splitDb,
            pdo: $pdo,
            canonDb: $canonDb instanceof \Razy\Database ? $canonDb : null,
            uid: $uid,
            wid: $wid,
            isBubbleChat: $isBubbleChat,
            bubbleThread: $bubbleThread,
            conversationId: $conversationId,
            content: $sendCtx->content,
            appendAssistantTurn: $appendAssistantTurn,
            continueAssistantId: $continueAssistantId,
            inputPlannerMode: $inputPlannerMode,
            inputInferenceMode: $inputInferenceMode,
            inputModelParamsNorm: $inputModelParamsNorm,
            chatEndpointId: $chatEndpointId,
            orchReady: $orchReady,
            assistantInsertContent: $assistantInsertContent,
            attachmentIds: $sendCtx->attachmentIds,
            hasPublishedSlideTemplate: $sendCtx->hasPublishedSlideTemplate,
            slideTemplateLabel: $sendCtx->slideTemplateLabel,
        );

        $run = ChatSendRunStarter::start(
            pipeline: $sendPipeline,
            ctx: $sendCtx,
            chatController: $this,
            splitDb: $splitDb,
            canonDb: $canonDb instanceof \Razy\Database ? $canonDb : null,
            user: $user,
            authApi: $authApi,
            uid: $uid,
            wid: $wid,
            conversationId: $persist->conversationId,
            asstMsgId: $persist->asstMsgId,
            continueAssistantId: $continueAssistantId,
            orchestratorUserContent: $sendCtx->orchestratorUserContent,
            conversationModeId: $persist->conversationModeId,
            plannerModeId: $persist->plannerModeId,
            bubbleThread: $persist->bubbleThread,
            conversationCreated: $persist->conversationCreated,
            orchReady: $orchReady,
            binding: $binding,
            internalBase: $internalBase,
            chatEndpointId: $chatEndpointId,
            attachmentIds: $sendCtx->attachmentIds,
            input: $input,
            assistantOut: $persist->assistantInsertContent,
        );

        ChatSendResponder::emit($sendPipeline, $sendCtx, new ChatSendRespondInput(
            conversationId: $persist->conversationId,
            userMsgId: $persist->userMsgId,
            asstMsgId: $persist->asstMsgId,
            assistantOut: $run->assistantOut,
            streamUrl: $run->streamUrl,
            runId: $run->runId,
            streamToken: $run->streamToken,
            orchReady: $orchReady,
            workspaceId: $wid,
            conversationTitleOut: $persist->conversationTitleOut,
            autoCompactApplied: $run->autoCompactApplied,
            inferenceSnapshot: $persist->inferenceSnapshot,
        ));
    } catch (ChatSendAbort $abort) {
        ChatSendHttp::emitAbort($abort);

        return;
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Send failed',
            'detail'  => $e->getMessage(),
        ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }
};
