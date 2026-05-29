<?php

declare(strict_types=1);

use oaaoai\chat\ChatConversationScope;
use oaaoai\chat\ChatInferenceControl;
use oaaoai\endpoints\ChatInferencePurposeConfig;
use oaaoai\user\UserModelParams;

/**
 * POST /chat/api/conversation_mode — persist thread UI mode (desk vs default) and planner mode in params_json.
 *
 * Body JSON: {
 *   "conversation_id": int,
 *   "mode"?: "desk"|"default",
 *   "planner_mode_id"?: "default"|"tot"|"ddtree",
 *   "model_params"?: object|null — manual mode overrides (null clears),
 *   "inference_mode"?: "off"|"manual"|"auto_tune",
 *   "inference_control"?: { mode?, model_params?, auto_state? },
 *   "chat_endpoint_id"?: int — seed auto_tune from purpose defaults,
 *   "workspace_id"?: int|null
 * }
 */
return function (): void {
    [$splitDb, $user] = $this->oaao_chat_require_user();
    if (! $user || ! $splitDb instanceof \Razy\Database) {
        return;
    }

    $uid = (int) ($user->user_id ?? 0);
    if ($uid < 1) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Invalid session']);

        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $cid = (int) ($input['conversation_id'] ?? 0);
    $mode = isset($input['mode']) && is_string($input['mode']) ? strtolower(trim($input['mode'])) : '';
    $plannerMode = isset($input['planner_mode_id']) && is_string($input['planner_mode_id'])
        ? strtolower(trim($input['planner_mode_id']))
        : '';
    if ($cid < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }
    if ($mode !== '' && ! \in_array($mode, ['desk', 'default'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'mode must be desk or default']);

        return;
    }
    if ($plannerMode !== '' && ! \in_array($plannerMode, ['default', 'tot', 'ddtree'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'planner_mode_id must be default, tot, or ddtree']);

        return;
    }
    $hasModelParams = \array_key_exists('model_params', $input);
    $hasInferenceMode = isset($input['inference_mode']) && \is_string($input['inference_mode']);
    $hasInferenceControl = isset($input['inference_control']) && \is_array($input['inference_control']);
    if ($mode === '' && $plannerMode === '' && ! $hasModelParams && ! $hasInferenceMode && ! $hasInferenceControl) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'mode, planner_mode_id, model_params, or inference_mode required',
        ]);

        return;
    }
    $scopeWid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $scopeWid)) {
        return;
    }

    try {
        $row = ChatConversationScope::findOwnedByUser($splitDb, $uid, $cid, 'id, workspace_id, params_json');
        if ($row === null) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }
        $wid = ChatConversationScope::normalizeWorkspaceId($row['workspace_id'] ?? null);
        if (
            $scopeWid !== null
            && ! ChatConversationScope::matchesScope($wid, $scopeWid)
        ) {
            http_response_code(403);
            echo json_encode(['success' => false, 'message' => 'Conversation is outside this workspace scope']);

            return;
        }

        $params = [];
        $raw = $row['params_json'] ?? null;
        if (\is_string($raw) && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (\is_array($decoded)) {
                $params = $decoded;
            }
        }
        if ($mode !== '') {
            $params['mode'] = $mode;
        }
        if ($plannerMode !== '') {
            $params['planner_mode_id'] = $plannerMode;
        }
        $inferencePatch = [];
        if ($hasInferenceMode) {
            $inferencePatch['mode'] = ChatInferenceControl::normalizeMode($input['inference_mode']);
        }
        if ($hasInferenceControl) {
            $icIn = $input['inference_control'];
            if (isset($icIn['mode'])) {
                $inferencePatch['mode'] = ChatInferenceControl::normalizeMode($icIn['mode']);
            }
            if (\array_key_exists('model_params', $icIn)) {
                $inferencePatch['model_params'] = $icIn['model_params'];
            }
            if (isset($icIn['auto_state']) && \is_array($icIn['auto_state'])) {
                $inferencePatch['auto_state'] = $icIn['auto_state'];
            }
        }
        if ($hasModelParams) {
            $mpRaw = $input['model_params'];
            if ($mpRaw === null) {
                $inferencePatch['model_params'] = null;
            } elseif (\is_array($mpRaw)) {
                $inferencePatch['model_params'] = $mpRaw;
            }
            if (! isset($inferencePatch['mode']) && ! $hasInferenceMode && ! $hasInferenceControl) {
                $inferencePatch['mode'] = ChatInferenceControl::MODE_MANUAL;
            }
        }
        if ($inferencePatch !== []) {
            $nextMode = isset($inferencePatch['mode'])
                ? ChatInferenceControl::normalizeMode($inferencePatch['mode'])
                : ChatInferenceControl::modeFromConversation($params);
            if (
                $nextMode === ChatInferenceControl::MODE_AUTO_TUNE
                && ChatInferenceControl::modeFromConversation($params) !== ChatInferenceControl::MODE_AUTO_TUNE
                && ! isset($inferencePatch['auto_state'])
            ) {
                $purposeMp = [];
                $canonDb = $this->api('auth')?->getDB();
                if ($canonDb instanceof \Razy\Database) {
                    $eid = (int) ($input['chat_endpoint_id'] ?? 0);
                    $purposeMp = ChatInferencePurposeConfig::resolveDefaultsForChatEndpoint($canonDb, $eid);
                }
                $userMp = [];
                $canonPdo = $this->oaao_chat_canonical_pdo();
                if ($canonPdo instanceof \PDO) {
                    $userMp = UserModelParams::activeOverrides(
                        UserModelParams::loadForUser($canonPdo, $uid),
                    );
                }
                $inferencePatch['auto_state'] = ChatInferenceControl::initialAutoState($purposeMp, $userMp);
            }
            $params = ChatInferenceControl::mergeIntoParams($params, $inferencePatch);
        }

        // Scope already validated via findOwnedByUser — do not filter UPDATE by workspace_id (NULL ≠ ? in SQL).
        $splitDb->update('conversation', ['params_json', 'updated_at'])
            ->where('id=?,user_id=?')
            ->assign([
                'params_json' => json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'updated_at'  => date('Y-m-d H:i:s'),
                'id'          => $cid,
                'user_id'     => $uid,
            ])
            ->query();

        $icBlock = ChatInferenceControl::blockFromConversation($params);
        echo json_encode([
            'success'            => true,
            'conversation_id'    => $cid,
            'mode'               => (string) ($params['mode'] ?? 'default'),
            'planner_mode_id'    => (string) ($params['planner_mode_id'] ?? 'default'),
            'inference_mode'     => $icBlock['mode'],
            'model_params'       => $icBlock['mode'] === ChatInferenceControl::MODE_MANUAL
                ? UserModelParams::activeOverrides($icBlock['model_params'])
                : [],
            'inference_control'  => [
                'mode'         => $icBlock['mode'],
                'model_params' => UserModelParams::activeOverrides($icBlock['model_params']),
                'auto_state'   => $icBlock['auto_state'],
            ],
        ]);
    } catch (\Throwable $e) {
        error_log('[oaao conversation_mode] ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not update conversation mode']);
    }
};
