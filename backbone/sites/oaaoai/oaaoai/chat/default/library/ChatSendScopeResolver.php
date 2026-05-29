<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Expands vault composer scope after user message content is known (auto-RAG / teaching intent).
 */
final class ChatSendScopeResolver
{
    /**
     * @param callable(int, ?int): list<int> $embeddedVaultIdsForUserWorkspace
     */
    public static function expand(
        ChatSendContext $ctx,
        \Razy\Database $canonDb,
        ?object $authApi,
        callable $embeddedVaultIdsForUserWorkspace,
    ): void {
        $uid = $ctx->userId;
        $wid = $ctx->workspaceId;
        $orchestratorUserContent = $ctx->orchestratorUserContent;
        $vaultAutoRag = $ctx->vaultAutoRag;
        $vaultSourceRefs = $ctx->vaultSourceRefs;
        $vaultSourceIds = $ctx->vaultSourceIds;

        $hasExplicitVaultRefs = $vaultSourceRefs !== [] || $vaultSourceIds !== [];
        /** @var list<array{kind: string, id: int, vault_id: int, name: string}> $matchedRefs */
        $matchedRefs = [];
        if (
            ChatTeachingIntent::shouldTryComposerVaultMatch(
                $vaultAutoRag,
                $hasExplicitVaultRefs,
                $orchestratorUserContent,
            )
        ) {
            $matchedRefs = ChatVaultScope::composerRefsMatchingMessage(
                $canonDb,
                $uid,
                $wid,
                $orchestratorUserContent,
            );
        }

        $expandVaultForGrounding = ChatTeachingIntent::shouldExpandVaultComposerScope(
            $vaultAutoRag,
            $hasExplicitVaultRefs,
            $matchedRefs !== [],
            $orchestratorUserContent,
        );
        if (
            $expandVaultForGrounding
            && $vaultSourceRefs === []
            && $vaultSourceIds === []
        ) {
            if (ChatTeachingIntent::impliesPersonalRecordVaultLookup($orchestratorUserContent)) {
                $audioRefs = ChatVaultScope::embeddedAudioRefsForRecordLookup(
                    $canonDb,
                    $uid,
                    $wid,
                    $orchestratorUserContent,
                );
                if ($audioRefs !== []) {
                    /** @var array<string, true> $seenRef */
                    $seenRef = [];
                    foreach ($matchedRefs as $ref) {
                        $seenRef[(int) ($ref['vault_id'] ?? 0) . ':' . (int) ($ref['id'] ?? 0)] = true;
                    }
                    foreach ($audioRefs as $ref) {
                        $key = (int) ($ref['vault_id'] ?? 0) . ':' . (int) ($ref['id'] ?? 0);
                        if (isset($seenRef[$key])) {
                            continue;
                        }
                        $seenRef[$key] = true;
                        $matchedRefs[] = $ref;
                    }
                }
            }
            if ($matchedRefs !== []) {
                $vaultSourceRefs = $matchedRefs;
                /** @var array<int, true> $seenVault */
                $seenVault = [];
                foreach ($matchedRefs as $ref) {
                    $vid = (int) ($ref['vault_id'] ?? 0);
                    if ($vid < 1 || isset($seenVault[$vid])) {
                        continue;
                    }
                    $seenVault[$vid] = true;
                    $vaultSourceIds[] = $vid;
                }
                $vaultSourceIds = array_values(array_unique($vaultSourceIds, SORT_NUMERIC));
            } else {
                $candidates = ChatVaultScope::vaultIdsForRetrieval($canonDb, $uid, $wid, $authApi);
                $vaultSourceIds = ChatVaultScope::filterVaultIdsWithEmbeddedDocuments($canonDb, $candidates);
                if (\count($vaultSourceIds) > 24) {
                    $vaultSourceIds = \array_slice($vaultSourceIds, 0, 24);
                }
            }
        }

        if ($expandVaultForGrounding && $vaultSourceIds === []) {
            $vaultSourceIds = $embeddedVaultIdsForUserWorkspace($uid, $wid);
        }

        $ctx->vaultSourceRefs = $vaultSourceRefs;
        $ctx->vaultSourceIds = $vaultSourceIds;
    }
}
