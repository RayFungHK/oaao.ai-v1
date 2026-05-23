<?php

declare(strict_types=1);

use oaaoai\vault\VaultSpeakerProfiles;

/**
 * GET /vault/api/speaker_profiles?vault_id= — list enrolled speaker voiceprints for a vault.
 */
return function (): void {
    header('Content-Type: application/json; charset=UTF-8');

    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        http_response_code(405);
        echo json_encode(['success' => false, 'message' => 'Method not allowed']);

        return;
    }

    /** @var array<string, mixed> $query */
    $query = [];
    if (isset($_GET['workspace_id']) && (is_string($_GET['workspace_id']) || is_numeric($_GET['workspace_id']))) {
        $query['workspace_id'] = $_GET['workspace_id'];
    }

    $ctx = $this->oaao_vault_require_pg_api_context($query);
    if ($ctx === null) {
        return;
    }

    $vaultId = isset($_GET['vault_id']) ? (int) $_GET['vault_id'] : 0;
    if ($vaultId < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid vault_id']);

        return;
    }

    $db = $ctx['db'];
    $uid = $ctx['uid'];
    $wid = $ctx['wid'];
    $pdo = $ctx['pdo'];

    if (! $this->oaao_vault_user_can_touch_vault($db, $vaultId, $uid, $wid)) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);

        return;
    }

    $profiles = VaultSpeakerProfiles::loadProfilesForVault($pdo, $vaultId);
    /** @var list<array<string, mixed>> $out */
    $out = [];
    foreach ($profiles as $p) {
        $out[] = [
            'profile_id'   => $p['profile_id'],
            'vault_id'     => $p['vault_id'],
            'display_name' => $p['display_name'],
            'sample_count' => $p['sample_count'],
            'embedding_dim'=> \count($p['embedding']),
        ];
    }

    echo json_encode([
        'success' => true,
        'data'    => [
            'vault_id'  => $vaultId,
            'profiles'  => $out,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
