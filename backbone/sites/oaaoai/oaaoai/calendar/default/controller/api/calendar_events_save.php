<?php

declare(strict_types=1);

/**
 * POST /calendar/api/calendar_events_save — create or update event.
 */
return function (): void {
    require_once __DIR__ . '/_calendar_api_bootstrap.php';

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        header('Content-Type: application/json; charset=UTF-8');
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $ctx = oaao_calendar_require_pg($this);
    if ($ctx === null) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON']);

        return;
    }

    $tenantId = (int) $ctx['tenant_id'];
    $uid = (int) $ctx['uid'];
    $eventId = isset($input['event_id']) ? (int) $input['event_id'] : 0;
    $title = trim((string) ($input['title'] ?? ''));
    $startAt = trim((string) ($input['start_at'] ?? ''));
    $endAt = trim((string) ($input['end_at'] ?? ''));

    if ($title === '' || $startAt === '' || $endAt === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'title, start_at, end_at required']);

        return;
    }

    $widRaw = $input['workspace_id'] ?? null;
    $workspaceId = $widRaw !== null && $widRaw !== '' && (int) $widRaw > 0 ? (int) $widRaw : null;
    $allDay = ! empty($input['all_day']);
    $timezone = trim((string) ($input['timezone'] ?? 'UTC')) ?: 'UTC';
    $location = trim((string) ($input['location'] ?? ''));
    $notes = trim((string) ($input['notes'] ?? ''));
    $status = trim((string) ($input['status'] ?? 'confirmed'));
    if (! \in_array($status, ['confirmed', 'cancelled'], true)) {
        $status = 'confirmed';
    }
    $conversationId = isset($input['conversation_id']) && (int) $input['conversation_id'] > 0
        ? (int) $input['conversation_id']
        : null;
    $messageId = isset($input['message_id']) && (int) $input['message_id'] > 0
        ? (int) $input['message_id']
        : null;

    $pdo = $ctx['pdo'];
    $now = date('Y-m-d H:i:s');

    if ($eventId > 0) {
        $st = $pdo->prepare(
            'UPDATE oaao_calendar_event
             SET title = ?, start_at = ?, end_at = ?, all_day = ?, timezone = ?,
                 location = ?, notes = ?, status = ?, updated_at = ?
             WHERE event_id = ? AND tenant_id = ? AND created_by = ?',
        );
        $st->execute([
            $title,
            $startAt,
            $endAt,
            $allDay ? 1 : 0,
            $timezone,
            $location !== '' ? $location : null,
            $notes !== '' ? $notes : null,
            $status,
            $now,
            $eventId,
            $tenantId,
            $uid,
        ]);
        if ($st->rowCount() < 1) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Event not found']);

            return;
        }
    } else {
        $st = $pdo->prepare(
            'INSERT INTO oaao_calendar_event (
                tenant_id, workspace_id, title, start_at, end_at, all_day, timezone,
                location, notes, status, conversation_id, message_id, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING event_id',
        );
        $st->execute([
            $tenantId,
            $workspaceId,
            $title,
            $startAt,
            $endAt,
            $allDay ? 1 : 0,
            $timezone,
            $location !== '' ? $location : null,
            $notes !== '' ? $notes : null,
            $status,
            $conversationId,
            $messageId,
            $uid,
            $now,
            $now,
        ]);
        $eventId = (int) $st->fetchColumn();
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'event_id' => $eventId,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
