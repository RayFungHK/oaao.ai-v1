<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /chat/api/conversation_fork — branch a thread; run CIT/CMT handoff into the new conversation.
 *
 * Body JSON: { "conversation_id": int, "workspace_id"?: int|null, "seed_prompt"?: string }
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
    $parentId = (int) ($input['conversation_id'] ?? 0);
    if ($parentId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'conversation_id required']);

        return;
    }

    $wid = $this->oaao_chat_resolve_workspace_id($input);
    if (! $this->oaao_chat_gate_workspace_scope($uid, $wid)) {
        return;
    }

    try {
        $parent = $splitDb->prepare()
            ->select('id, title, params_json')
            ->from('conversation')
            ->where('id=?,user_id=?,workspace_id=?')
            ->assign(['id' => $parentId, 'user_id' => $uid, 'workspace_id' => $wid])
            ->limit(1)
            ->query()
            ->fetch();
        if (! \is_array($parent) || ! isset($parent['id'])) {
            http_response_code(404);
            echo json_encode(['success' => false, 'message' => 'Conversation not found']);

            return;
        }

        $baseTitle = trim((string) ($parent['title'] ?? ''));
        if ($baseTitle === '') {
            $baseTitle = 'Chat';
        }
        $title = mb_substr($baseTitle . ' · new mode', 0, 120);

        $seedPrompt = isset($input['seed_prompt']) ? trim((string) $input['seed_prompt']) : '';

        $params = [
            'mode'        => 'default',
            'forked_from' => $parentId,
        ];
        if ($seedPrompt !== '') {
            $params['fork_seed_prompt'] = mb_substr($seedPrompt, 0, 4000);
        }
        $paramsJson = json_encode($params, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        $now = date('Y-m-d H:i:s');
        $splitDb->insert('conversation', ['user_id', 'workspace_id', 'title', 'params_json', 'created_at', 'updated_at'])
            ->assign([
                'user_id'      => $uid,
                'workspace_id' => $wid,
                'title'        => $title,
                'params_json'  => $paramsJson,
                'created_at'   => $now,
                'updated_at'   => $now,
            ])
            ->query();

        $newId = (int) $splitDb->lastID();
        if ($newId < 1) {
            http_response_code(500);
            echo json_encode(['success' => false, 'message' => 'Could not fork conversation']);

            return;
        }

        $handoffMessageId = 0;
        $handoffSource = 'none';
        $compactedPreview = '';

        $rawMessages = $splitDb->prepare()
            ->select('id, role, content')
            ->from('message')
            ->where('conversation_id=?')
            ->assign(['conversation_id' => $parentId])
            ->order('+id')
            ->limit(500)
            ->query()
            ->fetchAll();

        /** @var list<array{role: string, content: string}> $recentMessages */
        $recentMessages = [];
        $localeHint = $seedPrompt;
        if (\is_array($rawMessages)) {
            foreach ($rawMessages as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $role = strtolower(trim((string) ($row['role'] ?? '')));
                if ($role !== 'user' && $role !== 'assistant') {
                    continue;
                }
                $content = (string) ($row['content'] ?? '');
                $recentMessages[] = ['role' => $role, 'content' => $content];
                if ($role === 'user' && trim($content) !== '') {
                    $localeHint = $content;
                }
            }
        }

        if ($recentMessages !== [] && ChatOrchestratorApi::internalBase() !== '') {
            $coachEndpoint = null;
            $endpointsApi = $this->api('endpoints');
            if ($endpointsApi && \method_exists($endpointsApi, 'resolveOrchestratorUiqePayload')) {
                $coachEndpoint = $endpointsApi->resolveOrchestratorUiqePayload();
            }

            $resp = ChatOrchestratorApi::postInternalJson(
                '/v1/conversation/fork_handoff',
                [
                    'parent_conversation_id' => $parentId,
                    'recent_messages'        => $recentMessages,
                    'seed_prompt'            => $seedPrompt,
                    'locale_hint'            => $localeHint,
                    'coach_endpoint'         => $coachEndpoint,
                ],
                60,
            );

            if (\is_array($resp) && ($resp['ok'] ?? false) === true) {
                $compacted = trim((string) ($resp['compacted_content'] ?? ''));
                $handoffSource = (string) ($resp['source'] ?? 'heuristic');
                if ($compacted !== '') {
                    $handoffMeta = json_encode([
                        'fork_cit_cmt'             => true,
                        'parent_conversation_id'   => $parentId,
                        'handoff_source'           => $handoffSource,
                        'tail_count'               => (int) ($resp['tail_count'] ?? 0),
                    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

                    $splitDb->insert('message', ['conversation_id', 'role', 'content', 'meta_json', 'created_at'])
                        ->assign([
                            'conversation_id' => $newId,
                            'role'            => 'assistant',
                            'content'         => $compacted,
                            'meta_json'       => $handoffMeta,
                            'created_at'      => $now,
                        ])
                        ->query();
                    $handoffMessageId = (int) $splitDb->lastID();
                    $compactedPreview = mb_substr($compacted, 0, 240);
                }
            }
        }

        $splitDb->update('conversation', ['updated_at'])
            ->where('id=?')
            ->assign([
                'updated_at' => date('Y-m-d H:i:s'),
                'id'         => $newId,
            ])
            ->query();

        echo json_encode([
            'success'                => true,
            'conversation_id'        => $newId,
            'parent_conversation_id' => $parentId,
            'handoff_message_id'     => $handoffMessageId > 0 ? $handoffMessageId : null,
            'handoff_source'         => $handoffSource,
            'compacted_preview'      => $compactedPreview,
            'seed_prompt'            => $seedPrompt !== '' ? $seedPrompt : null,
        ], JSON_UNESCAPED_UNICODE);
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Could not fork conversation']);
    }
};
