<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/_bootstrap.php';

use oaaoai\chat\ChatOrchestratorBootstrap;
use oaaoai\slide_designer\SlideOrchestrator;
use oaaoai\slide_designer\SlideProjectRegistry;

/**
 * POST /slide-designer/api/slide_verify
 * Code verify — sandbox tests; on failure LLM self-corrects until verified.
 * Body: { project_id, page, conversation_id, chat_endpoint_id?, auto_fix?: bool }
 */
return function (): void {
    \$chatApi = \$this->api('chat');
    if (! \$chatApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Chat orchestrator bridge unavailable']);
        return;
    }

    [$user, $pdo] = $this->oaao_slide_require_user();
    if (! $user || ! $pdo instanceof \PDO) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $projectId = trim((string) ($input['project_id'] ?? ''));
    $page = max(1, (int) ($input['page'] ?? $input['slide_index'] ?? 0));
    $cid = (int) ($input['conversation_id'] ?? 0);
    $chatEndpointId = (int) ($input['chat_endpoint_id'] ?? 0);
    $autoFix = ! isset($input['auto_fix']) || $input['auto_fix'] !== false;

    if ($projectId === '' || $cid < 1 || $page < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'project_id, page, and conversation_id required']);

        return;
    }

    if (SlideProjectRegistry::resolveProjectAccess($pdo, $projectId, $uid, $cid) === null) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Project not found']);

        return;
    }

    if ($autoFix) {
        $auth = $this->api('auth');
        $canonDb = $auth ? $auth->getDB() : null;
        if (! $canonDb instanceof \Razy\Database) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'Canonical database unavailable']);

            return;
        }

        $binding = $chatEndpointId > 0
            ? ChatOrchestratorBootstrap::resolveBindingForProfile($canonDb, $chatEndpointId)
            : ChatOrchestratorBootstrap::resolveDefaultBinding($canonDb);
        if ($binding === null) {
            http_response_code(503);
            echo json_encode(['success' => false, 'message' => 'No chat endpoint binding']);

            return;
        }

        $endpointRow = $binding['endpoint'];
        $endpointPayload = [
            'endpoint_ref' => trim((string) ($endpointRow['name'] ?? '')),
            'base_url'     => trim((string) ($endpointRow['base_url'] ?? '')),
            'model'        => trim((string) ($endpointRow['model'] ?? '')),
            'api_key_env'  => ChatOrchestratorBootstrap::inferApiKeyEnv(
                isset($endpointRow['api_key_ref']) ? (string) $endpointRow['api_key_ref'] : null
            ),
        ];

        $splitDb = $auth->getDBSplit();
        $messages = [];
        if ($splitDb instanceof \Razy\Database) {
            $raw = $splitDb->prepare()
                ->select('role, content')
                ->from('message')
                ->where('conversation_id=?')
                ->assign(['conversation_id' => $cid])
                ->order('+id')
                ->limit(80)
                ->query()
                ->fetchAll();
            if (\is_array($raw)) {
                foreach ($raw as $r) {
                    if (! \is_array($r)) {
                        continue;
                    }
                    $role = strtolower(trim((string) ($r['role'] ?? '')));
                    $content = trim((string) ($r['content'] ?? ''));
                    if ($content === '' || ! \in_array($role, ['user', 'assistant'], true)) {
                        continue;
                    }
                    $messages[] = ['role' => $role, 'content' => $content];
                }
            }
        }

        $result = SlideOrchestrator::verifyAndFixPage($chatApi, 
            $projectId,
            $page,
            $cid,
            $uid,
            $endpointPayload,
            $messages,
            true,
        );
    } else {
        $result = SlideOrchestrator::verifyPage($chatApi, $projectId, $page);
    }

    if ($result === null) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $fatal = isset($result['error']) && trim((string) $result['error']) !== '';
    $verified = (bool) ($result['verified'] ?? $result['ok'] ?? false);
    $saved = ! $fatal && trim((string) ($result['preview_url'] ?? '')) !== '';

    echo json_encode([
        'success' => $saved,
        'ok'      => $verified,
        'message' => $fatal
            ? 'Verify failed'
            : ($verified
                ? (($result['fixed'] ?? false)
                    ? 'HTML verified after correction'
                    : 'HTML verified')
                : 'Could not verify HTML'),
        'data'    => $result,
    ], JSON_UNESCAPED_UNICODE);
};
