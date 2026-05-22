<?php

declare(strict_types=1);

/**
 * GET /chat/api/workspace_glossary?workspace_id=
 * POST /chat/api/workspace_glossary — { workspace_id, glossary: { terms: [...] } }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    [$authApi, $authUser] = $this->oaao_chat_require_authenticated_only();
    if (! $authApi || ! $authUser) {
        return;
    }

    $uid = (int) ($authUser->user_id ?? 0);
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    $input = $method === 'GET' ? $_GET : (json_decode(file_get_contents('php://input'), true) ?: []);
    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }
    if ($wid === null || $wid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'workspace_id required']);

        return;
    }

    $vaultApi = $this->api('vault');
    if (! $vaultApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Vault module unavailable']);

        return;
    }

    if ($method === 'GET') {
        $glossary = $vaultApi->getWorkspaceGlossary($wid);
        echo json_encode(['success' => true, 'data' => ['workspace_id' => $wid, 'glossary' => $glossary]], JSON_UNESCAPED_UNICODE);

        return;
    }

    if ($method !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $rawG = $input['glossary'] ?? null;
    if (! \is_array($rawG)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'glossary required']);

        return;
    }

    $terms = $rawG['terms'] ?? [];
    if (! \is_array($terms)) {
        $terms = [];
    }
    if (! $vaultApi->saveWorkspaceGlossary($wid, ['terms' => $terms])) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Could not save glossary']);

        return;
    }

    echo json_encode(['success' => true, 'data' => ['workspace_id' => $wid]], JSON_UNESCAPED_UNICODE);
};
