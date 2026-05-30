<?php

declare(strict_types=1);

use oaaoai\chat\ChatInferenceControl;
use oaaoai\chat\ChatInternalPrincipalGate;

/**
 * POST /chat/api/inference_turn_apply — orchestrator internal: persist per-turn applied sampling.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $secret = getenv('OAAO_ORCH_SHARED_SECRET');
    $secret = ($secret !== false && trim((string) $secret) !== '')
        ? trim((string) $secret)
        : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    $hdr = $_SERVER['HTTP_X_OAAO_INTERNAL_TOKEN'] ?? '';
    if (! \is_string($hdr) || $hdr === '' || ! hash_equals($secret, $hdr)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $cid = (int) ($input['conversation_id'] ?? 0);
    $mid = (int) ($input['assistant_message_id'] ?? 0);
    if ($cid < 1 || $mid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id and assistant_message_id required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    if (! ChatInternalPrincipalGate::verifyOptional($input, $cid, $mid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Invalid run_principal'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $snapshot = $input['inference'] ?? null;
    if (! \is_array($snapshot)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'inference snapshot required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }
    if (method_exists($auth, 'ensureAdjunctSqliteLoaded')) {
        $auth->ensureAdjunctSqliteLoaded();
    }
    $splitDb = $auth->getDBSplit();
    if (! $splitDb instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Split database unavailable'], JSON_UNESCAPED_UNICODE);

        return;
    }

    try {
        $convRow = $splitDb->prepare()
            ->select('params_json')
            ->from('conversation')
            ->where('id=?')
            ->assign(['id' => $cid])
            ->limit(1)
            ->query()
            ->fetch();
        $paramsDec = [];
        if (\is_array($convRow)) {
            $raw = trim((string) ($convRow['params_json'] ?? ''));
            if ($raw !== '') {
                $decoded = json_decode($raw, true);
                if (\is_array($decoded)) {
                    $paramsDec = $decoded;
                }
            }
        }

        if (ChatInferenceControl::modeFromConversation($paramsDec) !== ChatInferenceControl::MODE_AUTO_TUNE) {
            echo json_encode(['success' => true, 'skipped' => true], JSON_UNESCAPED_UNICODE);

            return;
        }

        $applied = \is_array($snapshot['params_applied'] ?? null) ? $snapshot['params_applied'] : [];
        $paramsDec = ChatInferenceControl::recordAutoTuneTurn($paramsDec, $applied, $snapshot);

        $splitDb->update('conversation', ['params_json', 'updated_at'])
            ->where('id=?')
            ->assign([
                'params_json'  => json_encode($paramsDec, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'updated_at'   => date('Y-m-d H:i:s'),
                'id'           => $cid,
            ])
            ->query();

        $metaJson = json_encode(['inference' => $snapshot], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $splitDb->update('message', ['meta_json'])
            ->where('id=?,conversation_id=?')
            ->assign([
                'meta_json'        => $metaJson,
                'id'               => $mid,
                'conversation_id'  => $cid,
            ])
            ->query();
    } catch (\Throwable $e) {
        error_log('inference_turn_apply failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Persist failed'], JSON_UNESCAPED_UNICODE);

        return;
    }

    echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
};
