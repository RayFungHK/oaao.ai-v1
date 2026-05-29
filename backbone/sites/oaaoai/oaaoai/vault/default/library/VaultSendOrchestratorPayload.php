<?php

declare(strict_types=1);

namespace oaaoai\vault;

use oaaoai\chat\ChatVaultScope;

/**
 * Vault-owned orchestrator payload fragments for chat send ({@code vault_retrieval_profiles}, glossary, …).
 */
final class VaultSendOrchestratorPayload
{
    /**
     * @param list<int> $vaultSourceIds
     * @param list<array{kind: string, id: int, vault_id: int, name: string}> $vaultSourceRefs
     * @param object|null $chatApi exposes {@code vaultRetrievalProfilesForVaultIds}
     * @param object|null $vaultApi exposes {@code getWorkspaceGlossary}
     * @return array<string, mixed>
     */
    public static function buildFragment(
        int $uid,
        ?int $workspaceId,
        array $vaultSourceIds,
        array $vaultSourceRefs,
        \Razy\Database $canonDb,
        ?object $chatApi,
        ?object $vaultApi,
    ): array {
        $fragment = [];

        if ($vaultSourceIds !== [] && $chatApi !== null && method_exists($chatApi, 'vaultRetrievalProfilesForVaultIds')) {
            $fragment['vault_retrieval_profiles'] = $chatApi->vaultRetrievalProfilesForVaultIds(
                $uid,
                $workspaceId,
                $vaultSourceIds,
            );
            $docCatalog = ChatVaultScope::documentCitationCatalog($canonDb, $vaultSourceIds);
            if ($docCatalog !== []) {
                $fragment['vault_document_catalog'] = $docCatalog;
            }
            if ($vaultSourceRefs !== []) {
                $scopeDocs = ChatVaultScope::scopedDocumentIdsByVault($canonDb, $vaultSourceRefs);
                if ($scopeDocs !== []) {
                    /** @var array<string, list<int>> $encoded */
                    $encoded = [];
                    foreach ($scopeDocs as $vid => $docIds) {
                        $encoded[(string) $vid] = $docIds;
                    }
                    $fragment['vault_scope_documents'] = $encoded;
                }
            }
        }

        if ($workspaceId !== null && $workspaceId > 0 && $vaultApi !== null && method_exists($vaultApi, 'getWorkspaceGlossary')) {
            $glossary = $vaultApi->getWorkspaceGlossary($workspaceId);
            if ($glossary !== []) {
                $fragment['glossary'] = $glossary;
            }
        }

        return $fragment;
    }
}
