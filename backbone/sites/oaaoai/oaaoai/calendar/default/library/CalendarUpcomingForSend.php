<?php

declare(strict_types=1);

namespace oaaoai\calendar;

/**
 * Upcoming workspace calendar rows for chat orchestrator payload (conflict-aware main LLM + post_turn).
 */
final class CalendarUpcomingForSend
{
    /**
     * @return list<array{event_id: int, title: string, start_at: string, end_at: string, location: string}>
     */
    public static function listForSend(
        \PDO $pdo,
        int $tenantId,
        ?int $workspaceId,
        int $daysAhead = 14,
        int $limit = 40,
    ): array {
        if ($tenantId < 1 || $daysAhead < 1 || $limit < 1) {
            return [];
        }

        $from = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
        $to = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))
            ->modify('+' . $daysAhead . ' days')
            ->format('Y-m-d\TH:i:s\Z');

        $sql = 'SELECT event_id, title, start_at, end_at, location
                FROM oaao_calendar_event
                WHERE tenant_id = ? AND end_at >= ? AND start_at <= ?';
        $params = [$tenantId, $from, $to];

        if ($workspaceId !== null && $workspaceId > 0) {
            $sql .= ' AND workspace_id = ?';
            $params[] = $workspaceId;
        } else {
            $sql .= ' AND workspace_id IS NULL';
        }

        $sql .= ' ORDER BY start_at ASC, event_id ASC LIMIT ' . (int) min($limit, 80);

        $st = $pdo->prepare($sql);
        $st->execute($params);
        /** @var list<array<string, mixed>> $rows */
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC);

        /** @var list<array{event_id: int, title: string, start_at: string, end_at: string, location: string}> $out */
        $out = [];
        foreach ($rows as $row) {
            $eid = (int) ($row['event_id'] ?? 0);
            if ($eid < 1) {
                continue;
            }
            $out[] = [
                'event_id'  => $eid,
                'title'     => trim((string) ($row['title'] ?? '')),
                'start_at'  => trim((string) ($row['start_at'] ?? '')),
                'end_at'    => trim((string) ($row['end_at'] ?? '')),
                'location'  => trim((string) ($row['location'] ?? '')),
            ];
        }

        return $out;
    }
}
