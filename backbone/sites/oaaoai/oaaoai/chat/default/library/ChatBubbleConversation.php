<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Short-lived chat threads — excluded from sidebar list; purged after {@code expires_at}.
 */
final class ChatBubbleConversation
{
    public const KIND = 'bubble';

    public static function ttlSeconds(): int
    {
        $raw = getenv('OAAO_BUBBLE_CHAT_TTL_SECONDS');
        if ($raw !== false && is_numeric($raw)) {
            $n = (int) $raw;

            return max(300, min(86400, $n));
        }

        return 5400;
    }

    /**
     * @param array<string, mixed> $row conversation row with optional {@code params_json}
     */
    public static function paramsFromRow(array $row): array
    {
        $raw = trim((string) ($row['params_json'] ?? ''));
        if ($raw === '') {
            return [];
        }
        try {
            $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

            return \is_array($dec) ? $dec : [];
        } catch (\JsonException) {
            return [];
        }
    }

    /**
     * @param array<string, mixed> $row
     */
    public static function isBubbleRow(array $row): bool
    {
        $p = self::paramsFromRow($row);

        return ($p['kind'] ?? '') === self::KIND;
    }

    /**
     * @param array<string, mixed> $params
     */
    public static function isExpiredParams(array $params): bool
    {
        $exp = trim((string) ($params['expires_at'] ?? ''));
        if ($exp === '') {
            return true;
        }
        $ts = strtotime($exp);

        return $ts === false || $ts < time();
    }

    public static function initialParamsJson(): string
    {
        $params = [
            'kind'        => self::KIND,
            'expires_at'  => date('Y-m-d H:i:s', time() + self::ttlSeconds()),
        ];

        return json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @return array<string, mixed>
     */
    public static function touchParams(array $existing): array
    {
        $params = $existing;
        $params['kind'] = self::KIND;
        $params['expires_at'] = date('Y-m-d H:i:s', time() + self::ttlSeconds());

        return $params;
    }

    /**
     * Keep bubble thread after productivity confirm — sidebar + Open chat links.
     */
    public static function promoteToPersistent(\Razy\Database $splitDb, int $conversationId, int $uid): bool
    {
        if ($conversationId < 1 || $uid < 1) {
            return false;
        }
        $row = $splitDb->prepare()
            ->select('params_json')
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $conversationId, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row) || ! self::isBubbleRow($row)) {
            return false;
        }
        $params = self::paramsFromRow($row);
        unset($params['kind'], $params['expires_at']);
        $params['promoted_from_bubble_at'] = date('c');
        $splitDb->update('conversation', ['params_json', 'updated_at'])
            ->where('id=?,user_id=?')
            ->assign([
                'params_json' => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'updated_at'  => date('Y-m-d H:i:s'),
                'id'          => $conversationId,
                'user_id'     => $uid,
            ])
            ->query();

        return true;
    }

    public static function touchExpiry(\Razy\Database $splitDb, int $conversationId, int $uid): void
    {
        if ($conversationId < 1 || $uid < 1) {
            return;
        }
        $row = $splitDb->prepare()
            ->select('params_json')
            ->from('conversation')
            ->where('id=?,user_id=?')
            ->assign(['id' => $conversationId, 'user_id' => $uid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($row) || ! self::isBubbleRow($row)) {
            return;
        }
        $params = self::touchParams(self::paramsFromRow($row));
        $splitDb->update('conversation', ['params_json', 'updated_at'])
            ->where('id=?,user_id=?')
            ->assign([
                'params_json'  => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'updated_at'   => date('Y-m-d H:i:s'),
                'id'           => $conversationId,
                'user_id'      => $uid,
            ])
            ->query();
    }

    /**
     * Delete expired bubble threads for the user (all scopes).
     */
    public static function purgeExpiredForUser(\Razy\Database $splitDb, int $uid): void
    {
        if ($uid < 1) {
            return;
        }
        $pdo = $splitDb->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return;
        }
        $rows = $splitDb->prepare()
            ->select('id, params_json')
            ->from('conversation')
            ->where('user_id=?')
            ->assign(['user_id' => $uid])
            ->query()
            ->fetchAll();
        if (! \is_array($rows)) {
            return;
        }
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            if (! self::isBubbleRow($row)) {
                continue;
            }
            if (! self::isExpiredParams(self::paramsFromRow($row))) {
                continue;
            }
            $cid = (int) ($row['id'] ?? 0);
            if ($cid < 1) {
                continue;
            }
            try {
                $pdo->beginTransaction();
                $splitDb->delete('message', ['conversation_id' => $cid])->query();
                $splitDb->delete('conversation', ['id' => $cid, 'user_id' => $uid])->query();
                $pdo->commit();
            } catch (\Throwable) {
                try {
                    $pdo->rollBack();
                } catch (\Throwable) {
                }
            }
        }
    }
}
