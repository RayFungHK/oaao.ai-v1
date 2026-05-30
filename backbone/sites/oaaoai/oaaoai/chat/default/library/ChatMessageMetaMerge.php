<?php

declare(strict_types=1);

namespace oaaoai\chat;

/** Merge patches into assistant message {@code meta_json} without clobbering other keys. */
final class ChatMessageMetaMerge
{
    /**
     * @param array<string, mixed> $patch top-level meta keys to merge (shallow merge per key)
     */
    public static function patchAssistant(
        \Razy\Database $splitDb,
        int $conversationId,
        int $assistantMessageId,
        array $patch,
    ): bool {
        if ($conversationId < 1 || $assistantMessageId < 1 || $patch === []) {
            return false;
        }

        $row = $splitDb->prepare()
            ->select('meta_json')
            ->from('message')
            ->where('id=?,conversation_id=?,role=?')
            ->assign([
                'id'              => $assistantMessageId,
                'conversation_id' => $conversationId,
                'role'            => 'assistant',
            ])
            ->limit(1)
            ->query()
            ->fetch();

        if (! \is_array($row)) {
            return false;
        }

        /** @var array<string, mixed> $meta */
        $meta = [];
        $raw = $row['meta_json'] ?? null;
        if (\is_string($raw) && $raw !== '') {
            try {
                $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                if (\is_array($decoded)) {
                    $meta = $decoded;
                }
            } catch (\JsonException) {
                $meta = [];
            }
        }

        foreach ($patch as $key => $value) {
            if (! \is_string($key) || $key === '') {
                continue;
            }
            if ($key === 'orchestrator_prompt_debug' && isset($meta[$key]) && \is_array($meta[$key]) && \is_array($value)) {
                /** @var array<string, mixed> $existing */
                $existing = $meta[$key];
                $meta[$key] = array_merge($existing, $value);

                continue;
            }
            $meta[$key] = $value;
        }

        try {
            $encoded = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return false;
        }

        $splitDb->update('message', ['meta_json'])
            ->where('id=?,conversation_id=?')
            ->assign([
                'meta_json'       => $encoded,
                'id'              => $assistantMessageId,
                'conversation_id' => $conversationId,
            ])
            ->query();

        return true;
    }
}
