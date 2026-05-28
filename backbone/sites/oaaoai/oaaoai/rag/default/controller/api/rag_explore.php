<?php

declare(strict_types=1);

use oaaoai\chat\ChatOrchestratorApi;

/**
 * POST /rag/api/rag_explore — hybrid vector + graph explore for RAG Explore SPA.
 *
 * JSON: { query: string, vault_ids?: int[], workspace_id?: int }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $auth = $this->api('auth');
    if (! $auth) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Authentication unavailable', 'error' => 'auth_unavailable']);

        return;
    }
    $auth->restrict(true);
    $user = $auth->getUser();
    if (! $user) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Not authenticated', 'error' => 'unauthenticated']);

        return;
    }

    $raw = file_get_contents('php://input');
    $body = \is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (! \is_array($body)) {
        $body = [];
    }

    $query = trim((string) ($body['query'] ?? ''));
    if ($query === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'query is required', 'error' => 'query_required']);

        return;
    }

    /** @var list<int> $vaultIds */
    $vaultIds = [];
    if (isset($body['vault_ids']) && \is_array($body['vault_ids'])) {
        foreach ($body['vault_ids'] as $vid) {
            $n = (int) $vid;
            if ($n > 0) {
                $vaultIds[] = $n;
            }
        }
    }
    $vaultIds = array_values(array_unique($vaultIds, SORT_NUMERIC));

    if ($vaultIds === []) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Select at least one vault', 'error' => 'vault_ids_required']);

        return;
    }

    $db = $auth->getDB();
    if (! $db instanceof \Razy\Database) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Database unavailable', 'error' => 'db_unavailable']);

        return;
    }

    $auth->ensurePgCoreTables($db);
    if (! \oaao_auth_database_is_pgsql($db)) {
        http_response_code(503);
        echo json_encode([
            'success' => false,
            'message' => 'Vault RAG explore requires PostgreSQL as the canonical database.',
            'error'   => 'pg_required',
        ]);

        return;
    }

    $pdo = $db->getDBAdapter();
    if ($pdo instanceof \PDO) {
        $this->api('core')?->bootstrapTenantContext($pdo);
    }

    $uid = (int) ($user->user_id ?? 0);
    $vaultApi = $this->api('vault') ?? $this->api('oaaoai/vault');
    if (! $vaultApi) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Vault module unavailable', 'error' => 'vault_api_unavailable']);

        return;
    }

    // Emitter proxies use __call — method_exists() is always false; invoke API methods directly.
    $filtered = $vaultApi->intersectAccessibleVaultIds($uid, $vaultIds);
    if (! \is_array($filtered)) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Vault module unavailable', 'error' => 'vault_api_unavailable']);

        return;
    }
    /** @var list<int> $authorizedIds */
    $authorizedIds = $filtered;

    if ($authorizedIds === []) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'message' => 'Selected vaults are not accessible for your account.',
            'error'   => 'vault_access_denied',
            'data'    => ['vault_ids' => $vaultIds],
        ]);

        return;
    }

    $wid = isset($body['workspace_id']) ? (int) $body['workspace_id'] : null;
    if ($wid !== null && $wid < 1) {
        $wid = null;
    }

    $built = $vaultApi->buildRetrievalProfilesFromVaultIds($authorizedIds);
    /** @var list<array<string, mixed>> $profiles */
    $profiles = \is_array($built) ? $built : [];

    $chatApi = $this->api('chat');
    if ($profiles === [] && $chatApi) {
        $fromChat = $chatApi->vaultRetrievalProfilesForVaultIds($uid, $wid, $authorizedIds);
        if (\is_array($fromChat) && $fromChat !== []) {
            $profiles = $fromChat;
        } elseif ($wid !== null) {
            $fromChat = $chatApi->vaultRetrievalProfilesForVaultIds($uid, null, $authorizedIds);
            if (\is_array($fromChat)) {
                $profiles = $fromChat;
            }
        }
    }

    if ($profiles === []) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'message' => 'No retrieval profiles for selected vaults.',
            'error'   => 'no_retrieval_profiles',
            'data'    => ['vault_ids' => $authorizedIds],
        ]);

        return;
    }

    /** @var array<int, string> $vaultNames */
    $vaultNames = [];
    $nameRows = $db->prepare()
        ->select('id, name')
        ->from('vault')
        ->where('id|=:ids')
        ->assign(['ids' => $authorizedIds])
        ->query()
        ->fetchAll();
    if (\is_array($nameRows)) {
        foreach ($nameRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $vid = (int) ($row['id'] ?? 0);
            if ($vid > 0) {
                $vaultNames[$vid] = trim((string) ($row['name'] ?? ''));
            }
        }
    }
    foreach ($profiles as $i => $profile) {
        if (! \is_array($profile)) {
            continue;
        }
        $vid = (int) ($profile['vault_id'] ?? 0);
        if ($vid > 0 && ($profile['vault_name'] ?? '') === '' && isset($vaultNames[$vid])) {
            $profiles[$i]['vault_name'] = $vaultNames[$vid];
        }
    }

    $endpointsApi = $this->api('endpoints');
    $embedding = $endpointsApi?->resolveOrchestratorEmbeddingPayload();
    $rerank = $endpointsApi?->resolveOrchestratorRerankPayload();
    $vaultRag = $endpointsApi?->resolveOrchestratorVaultRagConfig() ?? [];

    $knowledge = $endpointsApi?->resolveOrchestratorKnowledgePayload();
    $tenantId = 0;
    $coreApi = $this->api('core');
    if ($coreApi && method_exists($coreApi, 'tenantContextId')) {
        $tenantId = (int) ($coreApi->tenantContextId() ?? 0);
    }
    if ($tenantId < 1 && isset($user->tenant_id)) {
        $tenantId = (int) $user->tenant_id;
    }

    $payload = [
        'query'                    => $query,
        'vault_retrieval_profiles' => $profiles,
        'vault_rag'                => $vaultRag,
    ];
    if ($tenantId > 0) {
        $payload['tenant_id'] = $tenantId;
    }
    if ($knowledge !== null && $knowledge !== []) {
        if ($tenantId > 0 && ! isset($knowledge['tenant_id'])) {
            $knowledge['tenant_id'] = $tenantId;
        }
        $payload['knowledge'] = $knowledge;
    }
    if ($embedding !== null) {
        $payload['embedding'] = $embedding;
    }
    if ($rerank !== null) {
        $payload['rerank'] = $rerank;
    }

    $resp = ChatOrchestratorApi::postInternalJson('/v1/vault/rag/explore', $payload, 60);
    if ($resp === null || empty($resp['ok'])) {
        $detail = isset($resp['detail']) && \is_string($resp['detail']) ? trim($resp['detail']) : '';
        http_response_code(502);
        echo json_encode([
            'success' => false,
            'message' => $detail !== ''
                ? 'Orchestrator explore failed: ' . $detail
                : 'Orchestrator explore unavailable — check sidecar and embedding purpose.',
            'error'   => 'orchestrator_unavailable',
            'data'    => $detail !== '' ? ['detail' => $detail] : null,
        ]);

        return;
    }

    /** @var array<string, mixed> $data */
    $data = \is_array($resp['data'] ?? null) ? $resp['data'] : [];
    /** @var list<array<string, mixed>> $passages */
    $passages = \is_array($data['passages'] ?? null) ? $data['passages'] : [];
    if ($passages !== []) {
        /** @var array<int, true> $docIdSet */
        $docIdSet = [];
        /** @var array<int, true> $vaultIdSet */
        $vaultIdSet = [];
        foreach ($passages as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $did = (int) ($row['document_id'] ?? 0);
            $vid = (int) ($row['vault_id'] ?? 0);
            if ($did > 0) {
                $docIdSet[$did] = true;
            }
            if ($vid > 0) {
                $vaultIdSet[$vid] = true;
            }
        }

        if ($docIdSet !== []) {
            /** @var array<int, array<string, mixed>> $docById */
            $docById = [];
            $docRows = $db->prepare()
                ->select('id, vault_id, container_id, file_name')
                ->from('vault_document')
                ->where('id|=:ids')
                ->assign(['ids' => array_keys($docIdSet)])
                ->query()
                ->fetchAll();
            if (\is_array($docRows)) {
                foreach ($docRows as $docRow) {
                    if (! \is_array($docRow)) {
                        continue;
                    }
                    $did = (int) ($docRow['id'] ?? 0);
                    if ($did > 0) {
                        $docById[$did] = $docRow;
                    }
                }
            }

            /** @var array<int, array<string, mixed>> $containerById */
            $containerById = [];
            if ($vaultIdSet !== []) {
                $containerRows = $db->prepare()
                    ->select('id, vault_id, name, parent_container_id')
                    ->from('vault_container')
                    ->where('vault_id|=:vids')
                    ->assign(['vids' => array_keys($vaultIdSet)])
                    ->query()
                    ->fetchAll();
                if (\is_array($containerRows)) {
                    foreach ($containerRows as $containerRow) {
                        if (! \is_array($containerRow)) {
                            continue;
                        }
                        $cid = (int) ($containerRow['id'] ?? 0);
                        if ($cid > 0) {
                            $containerById[$cid] = $containerRow;
                        }
                    }
                }
            }

            $buildFolderPath = static function (?int $containerId) use ($containerById): string {
                if ($containerId === null || $containerId < 1) {
                    return '';
                }
                /** @var list<string> $parts */
                $parts = [];
                $seen = [];
                $cur = $containerId;
                while ($cur > 0 && ! isset($seen[$cur]) && isset($containerById[$cur])) {
                    $seen[$cur] = true;
                    $name = trim((string) ($containerById[$cur]['name'] ?? ''));
                    if ($name !== '') {
                        $parts[] = $name;
                    }
                    $parent = $containerById[$cur]['parent_container_id'] ?? null;
                    $cur = $parent !== null ? (int) $parent : 0;
                }

                return implode('/', array_reverse($parts));
            };

            foreach ($passages as $i => $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $did = (int) ($row['document_id'] ?? 0);
                $vid = (int) ($row['vault_id'] ?? 0);
                if ($did < 1 || ! isset($docById[$did])) {
                    continue;
                }
                $doc = $docById[$did];
                if ((int) ($doc['vault_id'] ?? 0) !== $vid) {
                    continue;
                }
                $fileName = trim((string) ($doc['file_name'] ?? ''));
                if ($fileName !== '') {
                    $passages[$i]['file_name'] = $fileName;
                }
                $containerId = isset($doc['container_id']) && $doc['container_id'] !== null
                    ? (int) $doc['container_id']
                    : null;
                $folder = $buildFolderPath($containerId);
                if ($folder !== '' && $fileName !== '') {
                    $passages[$i]['vault_path'] = $folder . '/' . $fileName;
                } elseif ($fileName !== '') {
                    $passages[$i]['vault_path'] = $fileName;
                } elseif ($folder !== '') {
                    $passages[$i]['vault_path'] = $folder;
                }
            }
            $data['passages'] = $passages;
        }
    }

    echo json_encode([
        'success' => true,
        'data'    => $data,
    ], JSON_UNESCAPED_UNICODE);
};
