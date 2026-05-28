<?php

declare(strict_types=1);

/**
 * POST /calendar/api/calendar_event_delete
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

    $eventId = (int) ($input['event_id'] ?? 0);
    if ($eventId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'event_id required']);

        return;
    }

    $st = $ctx['pdo']->prepare(
        'DELETE FROM oaao_calendar_event
         WHERE event_id = ? AND tenant_id = ? AND created_by = ?',
    );
    $st->execute([$eventId, (int) $ctx['tenant_id'], (int) $ctx['uid']]);

    if ($st->rowCount() < 1) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Event not found']);

        return;
    }

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
