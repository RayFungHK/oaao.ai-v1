<?php

declare(strict_types=1);

use oaaoai\vault\VaultGlossary;
use oaaoai\endpoints\CanonicalEndpointsRepository;

/**
 * POST /vault/api/glossary_import — extract glossary terms from embedded document samples via LLM.
 *
 * Body: { vault_id, document_ids?: number[], workspace_id? }
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?: [];
    $ctx = $this->oaao_vault_require_pg_api_context($body);
    if ($ctx === null) {
        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];
    $pdo = $ctx['pdo'];

    $vaultId = isset($body['vault_id']) ? (int) $body['vault_id'] : 0;
    if ($vaultId < 1 || ! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    /** @var list<int> $docIds */
    $docIds = [];
    if (isset($body['document_ids']) && \is_array($body['document_ids'])) {
        foreach ($body['document_ids'] as $d) {
            $did = (int) $d;
            if ($did > 0) {
                $docIds[] = $did;
            }
        }
    }

    $stmt = $db->prepare()
        ->select('id, source_text, file_name')
        ->from('vault_document')
        ->where('vault_id=:vid, embed_status=?')
        ->assign(['vid' => $vaultId, 'embed_status' => 'embedded']);
    if ($docIds !== []) {
        $stmt->where('id|=:ids')->assign(['ids' => $docIds]);
    }
    $rows = $stmt->limit(12)->query()->fetchAll();
    if (! \is_array($rows) || $rows === []) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'No embedded documents to sample']);

        return;
    }

    $samples = [];
    foreach ($rows as $row) {
        if (! \is_array($row)) {
            continue;
        }
        $st = trim((string) ($row['source_text'] ?? ''));
        if ($st === '') {
            continue;
        }
        $samples[] = substr($st, 0, 4000);
        if (\count($samples) >= 6) {
            break;
        }
    }
    if ($samples === []) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'No source_text on embedded documents']);

        return;
    }

    $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
    $bind = $repo->resolvePolishBinding() ?? $repo->resolveVaultGraphBinding();
    if ($bind === null) {
        http_response_code(503);
        echo json_encode(['success' => false, 'message' => 'Configure polish.* or graph.* purpose for term extraction']);

        return;
    }

    $base = rtrim($bind['base_url'], '/');
    $url = str_ends_with($base, '/chat/completions') ? $base : (str_ends_with($base, '/v1') ? $base . '/chat/completions' : $base . '/v1/chat/completions');
    $payload = [
        'model'    => $bind['model'],
        'messages' => [
            [
                'role'    => 'system',
                'content' => 'Extract domain glossary terms from document excerpts. Return JSON only: {"terms":[{"term":"...","aliases":["..."],"note":"..."}]} — max 40 terms.',
            ],
            [
                'role'    => 'user',
                'content' => implode("\n\n---\n\n", $samples),
            ],
        ],
        'temperature' => 0.2,
    ];

    $headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
    $ref = trim($bind['api_key_ref']);
    if ($ref !== '' && str_starts_with($ref, 'env:')) {
        $ev = substr($ref, 4);
        $key = getenv($ev);
        if (\is_string($key) && $key !== '') {
            $headers .= 'Authorization: Bearer ' . $key . "\r\n";
        }
    }

    $ctxHttp = stream_context_create([
        'http' => [
            'method'  => 'POST',
            'header'  => $headers,
            'content' => json_encode($payload, JSON_THROW_ON_ERROR),
            'timeout' => 90,
        ],
    ]);
    $raw = @file_get_contents($url, false, $ctxHttp);
    if ($raw === false) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'LLM request failed']);

        return;
    }

    try {
        /** @var array<string, mixed> $resp */
        $resp = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Invalid LLM response']);

        return;
    }

    $content = '';
    $choices = $resp['choices'] ?? null;
    if (\is_array($choices) && isset($choices[0]) && \is_array($choices[0])) {
        $msg = $choices[0]['message'] ?? null;
        if (\is_array($msg)) {
            $content = trim((string) ($msg['content'] ?? ''));
        }
    }
    if ($content === '') {
        http_response_code(502);
        echo json_encode(['success' => false, 'message' => 'Empty LLM response']);

        return;
    }

    if (preg_match('/\{[\s\S]*\}/', $content, $m)) {
        $content = $m[0];
    }
    $imported = VaultGlossary::parseJson($content);
    $existing = VaultGlossary::loadVaultGlossary($db, $vaultId) ?? VaultGlossary::emptyDocument();
    $merged = VaultGlossary::merge($existing, $imported);

    $db->update('vault', ['glossary_json', 'updated_at'])
        ->where('id=:vid')
        ->assign([
            'glossary_json' => VaultGlossary::encode($merged),
            'updated_at'    => date('Y-m-d H:i:s'),
            'vid'           => $vaultId,
        ])
        ->query();

    echo json_encode([
        'success' => true,
        'data'    => [
            'vault_id'      => $vaultId,
            'terms_added'   => \count($imported['terms']),
            'terms_total'   => \count($merged['terms']),
            'glossary'      => $merged,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
