<?php

declare(strict_types=1);

use oaaoai\chat\ChatBubbleConversation;

/**
 * GET /calendar/api/calendar_events_list?workspace_id=&from=&to=
 */
return function (): void {
    require_once __DIR__ . '/_calendar_api_bootstrap.php';

    $ctx = oaao_calendar_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    if ($tenantId < 1) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Tenant context required']);

        return;
    }

    $widRaw = $_GET['workspace_id'] ?? null;
    $workspaceId = null;
    if ($widRaw !== null && $widRaw !== '' && (int) $widRaw > 0) {
        $workspaceId = (int) $widRaw;
    }

    $from = trim((string) ($_GET['from'] ?? ''));
    $to = trim((string) ($_GET['to'] ?? ''));

    $sql = 'SELECT event_id, title, start_at, end_at, all_day, timezone, location, notes, status,
                   conversation_id, message_id, updated_at
            FROM oaao_calendar_event
            WHERE tenant_id = ?';
    $params = [$tenantId];

    if ($workspaceId !== null) {
        $sql .= ' AND workspace_id = ?';
        $params[] = $workspaceId;
    } else {
        $sql .= ' AND workspace_id IS NULL';
    }

    if ($from !== '') {
        $sql .= ' AND end_at >= ?';
        $params[] = $from;
    }
    if ($to !== '') {
        $sql .= ' AND start_at <= ?';
        $params[] = $to;
    }

    $sql .= ' ORDER BY start_at ASC, event_id ASC LIMIT 500';

    $st = $ctx['pdo']->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(\PDO::FETCH_ASSOC);

    $uid = (int) $ctx['uid'];
    $splitDb = $ctx['auth']->getDBSplit();
    if (\is_array($rows)) {
        foreach ($rows as $i => $row) {
            if (! \is_array($row)) {
                continue;
            }
            $rows[$i] = ChatBubbleConversation::stripEphemeralChatLinkageFromRow($row, $splitDb, $uid);
        }
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'events' => \is_array($rows) ? $rows : [],
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
