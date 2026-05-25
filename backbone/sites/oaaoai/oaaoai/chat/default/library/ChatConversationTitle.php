<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Auto-title for new threads — only replaces placeholder titles ({@code New chat}).
 */
final class ChatConversationTitle
{
    /** @var list<string> */
    private const PLACEHOLDER_TITLES = ['', 'New chat', 'New conversation'];

    public static function normalize(string $raw): string
    {
        $t = trim(preg_replace('/\s+/u', ' ', $raw) ?? '');
        if ($t === '') {
            return '';
        }
        $t = trim($t, "\"'`");
        if (mb_strlen($t) > 80) {
            $t = mb_substr($t, 0, 80);
        }

        return $t;
    }

    public static function isPlaceholder(string $title): bool
    {
        $t = self::normalize($title);

        return \in_array($t, self::PLACEHOLDER_TITLES, true)
            || strcasecmp($t, 'new chat') === 0;
    }

    /**
     * Sidebar title before planner / LLM naming — first words of the user message, else attachment stem.
     *
     * @param list<array<string, mixed>> $attachmentRows
     */
    public static function provisionalFromSend(string $content, array $attachmentRows): string
    {
        $content = self::normalize($content);
        $generic = [
            'please read the attached file(s) and respond helpfully.',
            'create a slide presentation using my selected template.',
            'create a slide presentation using the selected template.',
        ];
        if ($content !== '' && ! \in_array(strtolower($content), $generic, true)) {
            if (preg_match_all('/\S+/u', $content, $m) && isset($m[0]) && \is_array($m[0])) {
                $words = \array_slice($m[0], 0, 8);

                return self::normalize(implode(' ', $words));
            }
        }
        foreach ($attachmentRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $name = trim((string) ($row['file_name'] ?? ''));
            if ($name === '') {
                continue;
            }
            $stem = pathinfo($name, PATHINFO_FILENAME);
            if (\is_string($stem) && trim($stem) !== '') {
                $t = self::normalize($stem);
                if ($t !== '') {
                    return $t;
                }
            }
        }

        return '';
    }

    /**
     * @return bool true when title was updated
     */
    public static function maybeUpdateFromMeta(\Razy\Database $splitDb, int $conversationId, int $userId, array $meta): bool
    {
        $raw = $meta['conversation_title'] ?? null;
        if (! \is_string($raw) && ! \is_numeric($raw)) {
            return false;
        }
        $next = self::normalize((string) $raw);
        if ($next === '' || self::isPlaceholder($next)) {
            return false;
        }

        $row = $splitDb->prepare()
            ->select('title')
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $conversationId, 'user_id' => $userId])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row)) {
            return false;
        }
        $cur = self::normalize((string) ($row['title'] ?? ''));
        if (! self::isPlaceholder($cur)) {
            return false;
        }

        $splitDb->update('conversation', ['title', 'updated_at'])
            ->where('id=?,user_id=?')
            ->assign([
                'title'      => $next,
                'updated_at' => date('Y-m-d H:i:s'),
                'id'         => $conversationId,
                'user_id'    => $userId,
            ])
            ->query();

        return true;
    }
}
