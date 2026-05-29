<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Chat-owned composer message shaping for {@code chat.send.message} (before {@code scope}).
 */
final class ChatSendMessage
{
    public const CONTINUE_ORCHESTRATOR_PROMPT =
        'Continue from where you left off in your previous assistant reply. '
        . 'Do not repeat text you already wrote; only add the next part.';

    /**
     * Default composer text when the user sends an empty body with template/attachments only.
     */
    public static function defaultEmptyComposerText(ChatSendContext $ctx): string
    {
        if ($ctx->slideTemplateId !== '') {
            return 'Create a slide presentation using the selected template.';
        }
        if ($ctx->attachmentIds !== []) {
            return 'Please read the attached file(s) and respond helpfully.';
        }

        return '';
    }

    /**
     * Sets {@see ChatSendContext::$content} and {@see ChatSendContext::$orchestratorUserContent}.
     */
    public static function apply(ChatSendContext $ctx, string $rawContent): void
    {
        $content = trim($rawContent);
        if ($content === '' && $ctx->appendAssistantTurn) {
            $content = 'Continue';
        }
        if ($content === '' && ! $ctx->appendAssistantTurn) {
            $content = self::defaultEmptyComposerText($ctx);
            if ($content === '') {
                throw new ChatSendAbort(400, [
                    'success' => false,
                    'message' => 'Message cannot be empty',
                ]);
            }
        }

        $ctx->content = $content;
        $ctx->orchestratorUserContent = $ctx->appendAssistantTurn
            ? self::CONTINUE_ORCHESTRATOR_PROMPT
            : $content;
    }
}
