<?php

declare(strict_types=1);

use oaaoai\vault\VaultDocumentHookRegister;

/**
 * GET /vault/api/vault_tree — vaults / containers / documents for the current workspace or personal shell.
 *
 * Query:
 * - {@code workspace_id} optional (omit = personal shell)
 * - {@code scope=all} — personal + all workspace vaults the user may access (ignores {@code workspace_id})
 * - {@code include=full} — document nodes include {@code embed_error} / {@code graph_error}
 * - {@code include=flat} — also return top-level {@code vaults}, {@code containers}, {@code documents} arrays
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    $ctx = $this->oaao_vault_require_pg_api_context(null);
    if ($ctx === null) {
        return;
    }

    $this->api('endpoints')?->ensureFeatureRegistries();

    $includeRaw = isset($_GET['include']) ? strtolower(trim((string) $_GET['include'])) : '';
    $includeFlat = str_contains($includeRaw, 'flat');
    $fullDocs = str_contains($includeRaw, 'full');
    $scopeAll = isset($_GET['scope']) && strtolower(trim((string) $_GET['scope'])) === 'all';

    try {
        if ($scopeAll) {
            $payload = $this->oaao_vault_build_all_accessible_payload($ctx['db'], $ctx['uid'], [
                'lite_documents' => ! $fullDocs,
            ]);
        } else {
            $payload = $this->oaao_vault_build_scope_payload($ctx['db'], $ctx['uid'], $ctx['wid'], [
                'lite_documents' => ! $fullDocs,
            ]);
        }
    } catch (\Throwable $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'message' => 'Could not load vault tree.',
            'data'    => ['detail' => $e->getMessage()],
        ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return;
    }

    $docCount = \count($payload['documents']);
    $maxDocId = 0;
    foreach ($payload['documents'] as $d) {
        if (! \is_array($d)) {
            continue;
        }
        $maxDocId = max($maxDocId, (int) ($d['id'] ?? 0));
    }
    $etag = \sprintf(
        'W/"vt-%s-%d-%d"',
        $scopeAll ? 'all' : (string) (int) $ctx['wid'],
        \count($payload['documents']),
        $maxDocId,
    );
    header('ETag: ' . $etag);
    header('Cache-Control: private, no-cache');
    $ifNone = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if (\is_string($ifNone) && trim($ifNone) === $etag) {
        http_response_code(304);

        return;
    }

    /** @var array<string, mixed> $data */
    $data = [
        'scope' => $scopeAll
            ? ['all_accessible' => true, 'workspace_id' => null, 'personal' => false]
            : [
                'workspace_id' => $ctx['wid'],
                'personal'     => $ctx['wid'] === null,
            ],
        'tree'            => $payload['tree'],
        'document_hooks' => VaultDocumentHookRegister::allSorted(),
    ];
    if ($includeFlat) {
        $data['vaults'] = $payload['vaults'];
        $data['containers'] = $payload['containers'];
        $data['documents'] = $payload['documents'];
    }

    echo json_encode([
        'success' => true,
        'data'    => $data,
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
