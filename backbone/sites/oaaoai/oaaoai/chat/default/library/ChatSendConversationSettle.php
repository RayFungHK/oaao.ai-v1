<?php

declare(strict_types=1);

namespace oaaoai\chat;

use oaaoai\endpoints\ChatInferencePurposeConfig;
use oaaoai\user\UserModelParams;

/**
 * Conversation settle helpers — provisional title, inference snapshot, user message meta.
 */
final class ChatSendConversationSettle
{
    /**
     * @param list<array<string, mixed>> $attachmentRows
     */
    public static function applyProvisionalTitle(
        \Razy\Database $splitDb,
        int $conversationId,
        int $userId,
        string $orchestratorUserContent,
        array $attachmentRows,
        string $nowMsg,
    ): ?string {
        $titleRow = $splitDb->prepare()
            ->select('title')
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $conversationId, 'user_id' => $userId])
            ->limit(1)
            ->query()
            ->fetch();
        $curTitle = \is_array($titleRow)
            ? ChatConversationTitle::normalize((string) ($titleRow['title'] ?? ''))
            : '';
        if (! ChatConversationTitle::isPlaceholder($curTitle)) {
            return null;
        }

        $provisional = ChatConversationTitle::provisionalFromSend($orchestratorUserContent, $attachmentRows);
        if ($provisional === '') {
            return null;
        }

        $splitDb->update('conversation', ['title', 'updated_at'])
            ->where('id=?,user_id=?')
            ->assign([
                'title'      => $provisional,
                'updated_at' => $nowMsg,
                'id'         => $conversationId,
                'user_id'    => $userId,
            ])
            ->query();

        return $provisional;
    }

    /**
     * @param array<string, mixed>|null $paramsDec
     * @return array{snapshot: array<string, mixed>, params: array<string, int|float>}
     */
    public static function resolveInferenceForSend(
        ?\Razy\Database $canonDb,
        int $chatEndpointId,
        int $userId,
        ?array $paramsDec,
        ?\PDO $canonPdo,
    ): array {
        /** @var array<string, mixed> $snapshot */
        $snapshot = [
            'mode'           => ChatInferenceControl::MODE_OFF,
            'params_applied' => [],
            'source'         => 'endpoint_defaults',
        ];
        /** @var array<string, int|float> $params */
        $params = [];

        if (! $canonDb instanceof \Razy\Database) {
            return ['snapshot' => $snapshot, 'params' => $params];
        }

        $purposeMpPre = ChatInferencePurposeConfig::resolveDefaultsForChatEndpoint(
            $canonDb,
            $chatEndpointId > 0 ? $chatEndpointId : 0,
        );
        $userMpPre = [];
        if ($canonPdo instanceof \PDO) {
            $userMpPre = UserModelParams::activeOverrides(
                UserModelParams::loadForUser($canonPdo, $userId),
            );
        }
        $resolvedPre = ChatInferenceControl::resolveForSend(
            $paramsDec,
            $purposeMpPre,
            $userMpPre,
        );

        return [
            'snapshot' => $resolvedPre['snapshot'],
            'params'   => $resolvedPre['params'],
        ];
    }

    /**
     * @param array<string, mixed> $userMetaArr
     * @return array<string, mixed>
     */
    public static function appendContinueTurnMeta(
        array $userMetaArr,
        bool $appendAssistantTurn,
        int $continueAssistantId,
    ): array {
        if (! $appendAssistantTurn) {
            return $userMetaArr;
        }
        $userMetaArr['continue_turn'] = true;
        $userMetaArr['continues_assistant_message_id'] = $continueAssistantId;

        return $userMetaArr;
    }

    /**
     * @param array<string, mixed> $userMetaArr
     */
    public static function encodeUserMeta(array $userMetaArr): ?string
    {
        if ($userMetaArr === []) {
            return null;
        }
        try {
            return json_encode($userMetaArr, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
    }

    /**
     * @param array<string, mixed> $inferenceSnapshot
     */
    public static function encodeAssistantInferenceMeta(array $inferenceSnapshot): ?string
    {
        if ($inferenceSnapshot === []) {
            return null;
        }
        try {
            return json_encode(
                ['inference' => $inferenceSnapshot],
                JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
            );
        } catch (\JsonException) {
            return null;
        }
    }
}
