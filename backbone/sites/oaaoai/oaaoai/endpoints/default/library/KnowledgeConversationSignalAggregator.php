<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

use Oaaoai\Core\AdjunctSqlite;

/**
 * Batch topic/keyword importance from conversation tables (adjunct SQLite primary, PG fallback).
 */
final class KnowledgeConversationSignalAggregator
{
    private const int MAX_MESSAGES = 8000;

    private const int MAX_TOPICS = 48;

    /** @var list<string> */
    private const array STOPWORDS = [
        'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'your', 'you', 'are', 'was', 'were',
        'what', 'when', 'where', 'which', 'about', 'into', 'than', 'then', 'them', 'they', 'their', 'there',
        'can', 'could', 'would', 'should', 'will', 'just', 'also', 'more', 'some', 'any', 'all', 'not', 'but',
        'how', 'why', 'who', 'our', 'out', 'its', 'his', 'her', 'she', 'him', 'has', 'had', 'been', 'being',
        '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到',
        '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '吗', '什么', '怎么', '可以',
        '请', '帮', '帮忙', '谢谢', '你好', '嗯', '啊', '哦', '呢', '吧', '吗',
    ];

    /**
     * @return array{
     *   topics: list<array{topic_key: string, label: string, conversation_mentions: int, keyword_hits: int, importance_score: float}>,
     *   lookback_days: int,
     *   sources: array{sqlite_messages: int, pg_messages: int}
     * }
     */
    public static function aggregate(?\PDO $canonicalPdo = null): array
    {
        $days = self::lookbackDays();
        $since = gmdate('Y-m-d H:i:s', time() - ($days * 86400));

        /** @var array<string, array{label: string, hits: int, conv_ids: array<int, true>}> $buckets */
        $buckets = [];
        $sqliteCount = 0;
        $pgCount = 0;

        $adjunct = AdjunctSqlite::openPdo();
        if ($adjunct instanceof \PDO) {
            $sqliteCount = self::scanMessages($adjunct, $since, $buckets, true);
        }

        if ($sqliteCount < 1 && $canonicalPdo instanceof \PDO && $canonicalPdo->getAttribute(\PDO::ATTR_DRIVER_NAME) === 'pgsql') {
            $pgCount = self::scanMessages($canonicalPdo, $since, $buckets, false);
        }

        $topics = self::rankBuckets($buckets);

        return [
            'topics'          => $topics,
            'lookback_days'   => $days,
            'sources'         => [
                'sqlite_messages' => $sqliteCount,
                'pg_messages'     => $pgCount,
            ],
        ];
    }

    public static function lookbackDays(): int
    {
        $raw = getenv('OAAO_KNOWLEDGE_SIGNALS_LOOKBACK_DAYS');
        if ($raw !== false && is_numeric($raw)) {
            return max(1, min(90, (int) $raw));
        }

        return 7;
    }

    /**
     * @param array<string, array{label: string, hits: int, conv_ids: array<int, true>}> $buckets
     */
    private static function scanMessages(\PDO $pdo, string $since, array &$buckets, bool $sqlite): int
    {
        $count = 0;
        $sql = $sqlite
            ? 'SELECT m.conversation_id, m.content, c.title AS conv_title
               FROM oaao_message m
               INNER JOIN oaao_conversation c ON c.id = m.conversation_id
               WHERE m.role = \'user\' AND m.content IS NOT NULL AND m.content != \'\'
                 AND datetime(m.created_at) >= datetime(:since)
               ORDER BY m.id DESC
               LIMIT ' . self::MAX_MESSAGES
            : 'SELECT m.conversation_id, m.content, c.title AS conv_title
               FROM oaao_message m
               INNER JOIN oaao_conversation c ON c.id = m.conversation_id
               WHERE m.role = \'user\' AND m.content IS NOT NULL AND btrim(m.content) <> \'\'
                 AND m.created_at >= :since::timestamptz
               ORDER BY m.id DESC
               LIMIT ' . self::MAX_MESSAGES;

        try {
            $st = $pdo->prepare($sql);
            $st->execute(['since' => $since]);
            while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
                if (! \is_array($row)) {
                    continue;
                }
                ++$count;
                $cid = (int) ($row['conversation_id'] ?? 0);
                $content = (string) ($row['content'] ?? '');
                $title = trim((string) ($row['conv_title'] ?? ''));
                if ($title !== '') {
                    self::ingestPhrase($title, $cid, $buckets, weight: 3);
                }
                self::ingestContent($content, $cid, $buckets);
            }
        } catch (\Throwable $e) {
            error_log('KnowledgeConversationSignalAggregator: scan failed: ' . $e->getMessage());
        }

        return $count;
    }

    /**
     * @param array<string, array{label: string, hits: int, conv_ids: array<int, true>}> $buckets
     */
    private static function ingestContent(string $content, int $conversationId, array &$buckets): void
    {
        $content = trim($content);
        if ($content === '') {
            return;
        }
        $chunks = preg_split('/[\n。！？.!?]+/u', $content) ?: [];
        foreach ($chunks as $chunk) {
            $chunk = trim((string) $chunk);
            if (mb_strlen($chunk) >= 12 && mb_strlen($chunk) <= 160) {
                self::ingestPhrase($chunk, $conversationId, $buckets, weight: 2);
            }
        }
        if (preg_match_all('/[\p{L}\p{N}]{4,32}/u', $content, $matches)) {
            foreach ($matches[0] as $token) {
                $token = mb_strtolower((string) $token);
                if (self::isStopword($token)) {
                    continue;
                }
                self::ingestToken($token, $conversationId, $buckets);
            }
        }
    }

    /**
     * @param array<string, array{label: string, hits: int, conv_ids: array<int, true>}> $buckets
     */
    private static function ingestPhrase(string $phrase, int $conversationId, array &$buckets, int $weight = 1): void
    {
        $phrase = trim($phrase);
        if ($phrase === '' || mb_strlen($phrase) < 4) {
            return;
        }
        $key = self::topicKey($phrase);
        if ($key === '') {
            return;
        }
        if (! isset($buckets[$key])) {
            $buckets[$key] = [
                'label'    => mb_substr($phrase, 0, 200),
                'hits'     => 0,
                'conv_ids' => [],
            ];
        }
        $buckets[$key]['hits'] += max(1, $weight);
        if ($conversationId > 0) {
            $buckets[$key]['conv_ids'][$conversationId] = true;
        }
    }

    /**
     * @param array<string, array{label: string, hits: int, conv_ids: array<int, true>}> $buckets
     */
    private static function ingestToken(string $token, int $conversationId, array &$buckets): void
    {
        $key = self::topicKey($token);
        if ($key === '' || self::isStopword($token)) {
            return;
        }
        if (! isset($buckets[$key])) {
            $buckets[$key] = [
                'label'    => $token,
                'hits'     => 0,
                'conv_ids' => [],
            ];
        }
        ++$buckets[$key]['hits'];
        if ($conversationId > 0) {
            $buckets[$key]['conv_ids'][$conversationId] = true;
        }
    }

    private static function isStopword(string $token): bool
    {
        return \in_array($token, self::STOPWORDS, true);
    }

    private static function topicKey(string $label): string
    {
        $t = mb_strtolower(trim($label));
        if ($t === '') {
            return '';
        }
        $t = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $t) ?? $t;
        $parts = preg_split('/\s+/u', trim($t)) ?: [];
        $parts = array_values(array_filter($parts, static fn (string $p): bool => $p !== ''));
        if ($parts === []) {
            return mb_substr($t, 0, 120);
        }

        return implode('-', \array_slice($parts, 0, 8));
    }

    /**
     * @param array<string, array{label: string, hits: int, conv_ids: array<int, true>}> $buckets
     *
     * @return list<array{topic_key: string, label: string, conversation_mentions: int, keyword_hits: int, importance_score: float}>
     */
    private static function rankBuckets(array $buckets): array
    {
        $scored = [];
        foreach ($buckets as $key => $row) {
            $mentions = \count($row['conv_ids']);
            $hits = (int) $row['hits'];
            if ($mentions < 1 && $hits < 2) {
                continue;
            }
            $score = min(
                1.0,
                0.15
                + (log(1.0 + $mentions) * 0.22)
                + (log(1.0 + $hits) * 0.12),
            );
            $scored[] = [
                'topic_key'              => $key,
                'label'                  => $row['label'],
                'conversation_mentions'  => $mentions,
                'keyword_hits'           => $hits,
                'importance_score'       => round($score, 4),
                '_sort'                  => $score,
            ];
        }
        usort(
            $scored,
            static fn (array $a, array $b): int => ($b['_sort'] <=> $a['_sort']) ?: strcmp($a['topic_key'], $b['topic_key']),
        );
        $out = [];
        foreach (\array_slice($scored, 0, self::MAX_TOPICS) as $row) {
            unset($row['_sort']);
            $out[] = $row;
        }

        return $out;
    }
}
