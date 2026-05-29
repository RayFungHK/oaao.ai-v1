<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Browser JSON envelope for chat send ({@code chat.send.respond}).
 */
final class ChatSendResponder
{
    /**
     * Build payload, run {@code chat.send.respond} listeners, echo JSON.
     *
     * @throws ChatSendAbort When the response cannot be JSON-encoded.
     */
    public static function emit(
        ChatSendPipeline $pipeline,
        ChatSendContext $ctx,
        ChatSendRespondInput $input,
    ): void {
        $ctx->responsePayload = self::buildPayload($input);
        $pipeline->run(ChatSendPhase::RESPOND, $ctx);

        try {
            $json = json_encode(
                $ctx->responsePayload,
                JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR,
            );
        } catch (\JsonException) {
            throw new ChatSendAbort(500, [
                'success' => false,
                'message' => 'Send failed — response could not be encoded',
            ]);
        }

        echo $json;
    }

    /**
     * @return array<string, mixed>
     */
    public static function buildPayload(ChatSendRespondInput $input): array
    {
        $response = [
            'success'              => true,
            'conversation_id'      => $input->conversationId,
            'user_message_id'      => $input->userMsgId,
            'assistant_message_id' => $input->asstMsgId,
            'assistant_content'    => $input->assistantOut,
            'stream_url'           => $input->streamUrl,
            'run_id'               => $input->runId,
            'stream_token'         => $input->streamToken,
            'orchestrator_persist' => $input->orchReady && $input->runId !== null,
        ];
        if (\is_string($input->conversationTitleOut) && $input->conversationTitleOut !== '') {
            $response['conversation_title'] = $input->conversationTitleOut;
        }
        if ($input->workspaceId !== null && $input->workspaceId > 0) {
            $response['workspace_id'] = $input->workspaceId;
        }
        if ($input->autoCompactApplied) {
            $response['auto_compact_applied'] = true;
        }
        if ($input->inferenceSnapshot !== []) {
            $response['inference'] = $input->inferenceSnapshot;
        }

        return $response;
    }
}
