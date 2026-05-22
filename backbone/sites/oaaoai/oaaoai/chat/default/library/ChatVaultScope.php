<?php

declare(strict_types=1);

namespace oaaoai\chat;

use Razy\Database;

/**
 * Resolves vault primary keys visible to a user in the current workspace / personal shell
 * (parity with {@see \\Module\\oaao\\vault} {@code vault_tree}).
 */
final class ChatVaultScope
{
    /**
     * @return list<int>
     */
    public static function vaultIdsForUserWorkspace(Database $db, int $uid, ?int $wid): array
    {
        if ($uid < 1) {
            return [];
        }

        require_once dirname(__DIR__, 3) . '/auth/default/controller/api/_ensure_pg_core_tables.php';

        if (! \oaao_auth_database_is_pgsql($db)) {
            return [];
        }

        /** @var list<array<string, mixed>> $rows */
        if ($wid === null) {
            $rows = $db->prepare()
                ->select('id')
                ->from('vault')
                ->where('workspace_id IS NULL, owner_user_id=:uid')
                ->assign(['uid' => $uid])
                ->order('+id')
                ->query()
                ->fetchAll();
        } else {
            $rows = $db->prepare()
                ->select('v.id')
                ->from('v.vault-m.workspace_member[?v.workspace_id=m.workspace_id AND m.user_id=?]')
                ->where('v.workspace_id=?')
                ->assign([$uid, $wid])
                ->order('+id')
                ->query()
                ->fetchAll();
        }

        if (! \is_array($rows)) {
            return [];
        }

        /** @var list<int> $out */
        $out = [];
        foreach ($rows as $r) {
            if (! \is_array($r) || ! isset($r['id'])) {
                continue;
            }
            $vid = (int) $r['id'];
            if ($vid > 0) {
                $out[] = $vid;
            }
        }

        return $out;
    }

    /**
     * Keep only vaults that have at least one {@code embed_status=embedded} document (Auto Source RAG).
     *
     * @param list<int> $vaultIds
     *
     * @return list<int>
     */
    public static function filterVaultIdsWithEmbeddedDocuments(Database $db, array $vaultIds): array
    {
        /** @var list<int> $clean */
        $clean = [];
        foreach ($vaultIds as $v) {
            $n = \is_int($v) ? $v : (int) $v;
            if ($n > 0) {
                $clean[] = $n;
            }
        }
        $clean = array_values(array_unique($clean, SORT_NUMERIC));
        if ($clean === []) {
            return [];
        }

        $rows = $db->prepare()
            ->select('vault_id')
            ->from('vault_document')
            ->where('vault_id|=:vids, embed_status=:emb')
            ->assign(['vids' => $clean, 'emb' => 'embedded'])
            ->order('+vault_id')
            ->query()
            ->fetchAll();

        if (! \is_array($rows)) {
            return [];
        }

        /** @var array<int, true> $seen */
        $seen = [];
        /** @var list<int> $out */
        $out = [];
        foreach ($rows as $r) {
            if (! \is_array($r) || ! isset($r['vault_id'])) {
                continue;
            }
            $vid = (int) $r['vault_id'];
            if ($vid < 1 || isset($seen[$vid])) {
                continue;
            }
            $seen[$vid] = true;
            $out[] = $vid;
        }

        return $out;
    }

    /**
     * Match embedded vault documents whose file names appear in the user message (e.g. Regulatory Handbook Vol.3).
     *
     * @return list<array{kind: string, id: int, vault_id: int, name: string}>
     */
    public static function composerRefsMatchingMessage(Database $db, int $uid, ?int $wid, string $message, int $max = 6): array
    {
        $needles = self::documentSearchNeedlesFromMessage($message);
        if ($needles === []) {
            return [];
        }

        $vaultIds = self::filterVaultIdsWithEmbeddedDocuments(
            $db,
            self::vaultIdsForUserWorkspace($db, $uid, $wid),
        );
        if ($vaultIds === []) {
            return [];
        }

        $docRows = $db->prepare()
            ->select('id, vault_id, file_name')
            ->from('vault_document')
            ->where('vault_id|=:vids, embed_status=:emb')
            ->assign(['vids' => $vaultIds, 'emb' => 'embedded'])
            ->order('+vault_id,+id')
            ->query()
            ->fetchAll();
        if (! \is_array($docRows)) {
            return [];
        }

        /** @var list<array{score: int, vault_id: int, id: int, name: string}> $ranked */
        $ranked = [];
        foreach ($docRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $did = (int) ($row['id'] ?? 0);
            $vid = (int) ($row['vault_id'] ?? 0);
            $fn = trim((string) ($row['file_name'] ?? ''));
            if ($did < 1 || $vid < 1 || $fn === '') {
                continue;
            }
            $hay = mb_strtolower($fn, 'UTF-8');
            $score = 0;
            foreach ($needles as $needle) {
                if ($needle !== '' && str_contains($hay, $needle)) {
                    ++$score;
                }
            }
            if ($score < 1) {
                continue;
            }
            $ranked[] = ['score' => $score, 'vault_id' => $vid, 'id' => $did, 'name' => $fn];
        }

        if ($ranked === []) {
            return [];
        }

        usort(
            $ranked,
            static fn (array $a, array $b): int => ($b['score'] <=> $a['score'])
                ?: ($a['vault_id'] <=> $b['vault_id'])
                ?: ($a['id'] <=> $b['id']),
        );

        /** @var list<array{kind: string, id: int, vault_id: int, name: string}> $out */
        $out = [];
        /** @var array<string, true> $seen */
        $seen = [];
        foreach ($ranked as $row) {
            if (\count($out) >= max(1, min(12, $max))) {
                break;
            }
            $key = $row['vault_id'] . ':' . $row['id'];
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $out[] = [
                'kind'     => 'document',
                'id'       => $row['id'],
                'vault_id' => $row['vault_id'],
                'name'     => $row['name'],
            ];
        }

        return $out;
    }

    /**
     * When the user asks about a prior record (wallet usage, audio note), prefer embedded audio documents.
     *
     * @return list<array{kind: string, id: int, vault_id: int, name: string}>
     */
    public static function embeddedAudioRefsForRecordLookup(
        Database $db,
        int $uid,
        ?int $wid,
        string $message,
        int $max = 4,
    ): array {
        if (! \oaaoai\chat\ChatTeachingIntent::impliesPersonalRecordVaultLookup($message)) {
            return [];
        }

        $vaultIds = self::filterVaultIdsWithEmbeddedDocuments(
            $db,
            self::vaultIdsForUserWorkspace($db, $uid, $wid),
        );
        if ($vaultIds === []) {
            return [];
        }

        $docRows = $db->prepare()
            ->select('id, vault_id, file_name')
            ->from('vault_document')
            ->where('vault_id|=:vids, embed_status=:emb')
            ->assign(['vids' => $vaultIds, 'emb' => 'embedded'])
            ->order('+vault_id,+id')
            ->query()
            ->fetchAll();
        if (! \is_array($docRows)) {
            return [];
        }

        $low = mb_strtolower(trim($message), 'UTF-8');
        $wantWallet = str_contains($message, '錢包') || str_contains($low, 'wallet');
        /** @var list<array{score: int, vault_id: int, id: int, name: string}> $ranked */
        $ranked = [];
        foreach ($docRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $did = (int) ($row['id'] ?? 0);
            $vid = (int) ($row['vault_id'] ?? 0);
            $fn = trim((string) ($row['file_name'] ?? ''));
            if ($did < 1 || $vid < 1 || $fn === '') {
                continue;
            }
            $hay = mb_strtolower($fn, 'UTF-8');
            if (! preg_match('/\.(mp3|wav|m4a|ogg|flac|aac|webm)\b/i', $fn)) {
                continue;
            }
            $score = 1;
            if ($wantWallet && (str_contains($hay, '錢包') || str_contains($hay, 'wallet'))) {
                $score += 4;
            }
            if (str_contains($hay, '用法') || str_contains($hay, 'usage')) {
                $score += 2;
            }
            $ranked[] = ['score' => $score, 'vault_id' => $vid, 'id' => $did, 'name' => $fn];
        }

        if ($ranked === []) {
            return [];
        }

        usort(
            $ranked,
            static fn (array $a, array $b): int => ($b['score'] <=> $a['score'])
                ?: ($a['vault_id'] <=> $b['vault_id'])
                ?: ($a['id'] <=> $b['id']),
        );

        /** @var list<array{kind: string, id: int, vault_id: int, name: string}> $out */
        $out = [];
        foreach ($ranked as $row) {
            if (\count($out) >= max(1, min(8, $max))) {
                break;
            }
            $out[] = [
                'kind'     => 'document',
                'id'       => $row['id'],
                'vault_id' => $row['vault_id'],
                'name'     => $row['name'],
            ];
        }

        return $out;
    }

    /**
     * @return list<string> lowercase substrings for {@see composerRefsMatchingMessage}
     */
    private static function documentSearchNeedlesFromMessage(string $message): array
    {
        $s = trim($message);
        if ($s === '') {
            return [];
        }

        $low = mb_strtolower($s, 'UTF-8');
        /** @var list<string> $needles */
        $needles = [];
        foreach (['regulatory handbook', 'handbook', '手冊', 'manual'] as $phrase) {
            if (str_contains($low, $phrase)) {
                $needles[] = $phrase;
            }
        }
        if (preg_match('/vol\.?\s*(\d+)/i', $s, $m) === 1) {
            $needles[] = 'vol';
            $needles[] = 'vol.' . (string) ($m[1] ?? '');
            $needles[] = 'vol ' . (string) ($m[1] ?? '');
        } elseif (str_contains($low, 'vol')) {
            $needles[] = 'vol';
        }

        foreach (['錢包', 'wallet', 'mp3', '記錄', '錄音', '用法', '錢包用法'] as $phrase) {
            $p = mb_strtolower($phrase, 'UTF-8');
            if (str_contains($low, $p)) {
                $needles[] = $p;
            }
        }
        if (preg_match('/\.(mp3|wav|m4a|ogg|flac)\b/i', $s, $ext) === 1) {
            $needles[] = mb_strtolower((string) ($ext[0] ?? ''), 'UTF-8');
        }

        if (preg_match_all('/[\x{4e00}-\x{9fff}]{2,}/u', $s, $cjkRuns, PREG_SET_ORDER) !== false) {
            foreach ($cjkRuns as $run) {
                $w = mb_strtolower((string) ($run[0] ?? ''), 'UTF-8');
                if ($w === '' || \in_array($w, ['之前', '是有', '什麼', '如何', '怎麼', '可以', '應該', '會不會'], true)) {
                    continue;
                }
                $needles[] = $w;
            }
        }

        if (preg_match_all('/[\p{L}\p{N}]{4,}/u', $low, $tokens, PREG_SET_ORDER) !== false) {
            foreach ($tokens as $tok) {
                $w = (string) ($tok[0] ?? '');
                if ($w === '' || \in_array($w, ['handbook', 'manual', 'regulatory', 'volume', 'create', 'slide', 'presentation', 'using', 'template'], true)) {
                    continue;
                }
                $needles[] = $w;
            }
        }

        $needles = array_values(array_unique(array_filter($needles, static fn (string $n): bool => $n !== '')));

        return $needles;
    }

    /**
     * Resolve embedded document ids per vault from chat composer refs (document + folder subtree).
     *
     * When a vault has only a {@code vault}-kind ref (whole vault), that vault id is omitted — search all docs.
     *
     * @param list<array{kind: string, id: int, vault_id: int, name: string}> $refs
     *
     * @return array<int, list<int>> vault_id => document ids
     */
    public static function scopedDocumentIdsByVault(Database $db, array $refs): array
    {
        /** @var array<int, list<int>> $byVault */
        $byVault = [];
        /** @var array<int, true> $wholeVault */
        $wholeVault = [];

        foreach ($refs as $ref) {
            if (! \is_array($ref)) {
                continue;
            }
            $kind = strtolower(trim((string) ($ref['kind'] ?? '')));
            $rid = (int) ($ref['id'] ?? 0);
            $vid = (int) ($ref['vault_id'] ?? 0);
            if ($vid < 1 || $rid < 1) {
                continue;
            }
            if ($kind === 'vault') {
                $wholeVault[$vid] = true;

                continue;
            }
            if ($kind === 'document') {
                if (! isset($byVault[$vid])) {
                    $byVault[$vid] = [];
                }
                $byVault[$vid][] = $rid;

                continue;
            }
            if ($kind === 'folder') {
                $subIds = self::containerSubtreeIds($db, $vid, $rid);
                if ($subIds === []) {
                    continue;
                }
                $q = $db->prepare()
                    ->select('id')
                    ->from('vault_document')
                    ->where('vault_id=:vid, container_id|=:cids, embed_status=:emb')
                    ->assign(['vid' => $vid, 'cids' => $subIds, 'emb' => 'embedded'])
                    ->query();
                while (($row = $q->fetch()) !== false) {
                    if (! \is_array($row)) {
                        continue;
                    }
                    $did = (int) ($row['id'] ?? 0);
                    if ($did < 1) {
                        continue;
                    }
                    if (! isset($byVault[$vid])) {
                        $byVault[$vid] = [];
                    }
                    $byVault[$vid][] = $did;
                }
            }
        }

        /** @var array<int, list<int>> $out */
        $out = [];
        foreach ($byVault as $vid => $docIds) {
            if (isset($wholeVault[$vid])) {
                continue;
            }
            $clean = array_values(array_unique(array_filter($docIds, static fn (int $d): bool => $d > 0), SORT_NUMERIC));
            if ($clean !== []) {
                $out[$vid] = $clean;
            }
        }

        return $out;
    }

    /**
     * Vault / folder path labels for RAG citation blocks — keyed {@code "{vault_id}:{document_id}"}.
     *
     * @param list<int> $vaultIds
     *
     * @return array<string, array{file_name: string, vault_name: string, path: string}>
     */
    public static function documentCitationCatalog(Database $db, array $vaultIds): array
    {
        /** @var list<int> $clean */
        $clean = [];
        foreach ($vaultIds as $v) {
            $n = \is_int($v) ? $v : (int) $v;
            if ($n > 0) {
                $clean[] = $n;
            }
        }
        $clean = array_values(array_unique($clean, SORT_NUMERIC));
        if ($clean === []) {
            return [];
        }

        /** @var array<int, array{name: string, parent: int|null}> $containers */
        $containers = [];
        $containerRows = $db->prepare()
            ->select('id, vault_id, name, parent_container_id')
            ->from('vault_container')
            ->where('vault_id|=:ids')
            ->assign(['ids' => $clean])
            ->query()
            ->fetchAll();
        if (\is_array($containerRows)) {
            foreach ($containerRows as $row) {
                if (! \is_array($row) || ! isset($row['id'])) {
                    continue;
                }
                $cid = (int) $row['id'];
                if ($cid < 1) {
                    continue;
                }
                $parent = isset($row['parent_container_id']) && $row['parent_container_id'] !== null
                    ? (int) $row['parent_container_id']
                    : null;
                $nm = trim((string) ($row['name'] ?? ''));
                $containers[$cid] = [
                    'name'   => $nm !== '' ? $nm : "Folder {$cid}",
                    'parent' => $parent,
                ];
            }
        }

        $containerPath = static function (int $containerId) use ($containers): string {
            /** @var list<string> $parts */
            $parts = [];
            $cur = $containerId;
            $guard = 0;
            while ($cur !== null && isset($containers[$cur]) && $guard++ < 64) {
                $parts[] = $containers[$cur]['name'];
                $cur = $containers[$cur]['parent'];
            }

            return $parts === [] ? '' : implode(' › ', array_reverse($parts));
        };

        $docRows = $db->prepare()
            ->select('d.id, d.vault_id, d.container_id, d.file_name, v.name AS vault_name')
            ->from('d.vault_document-v.vault[?v.id=d.vault_id]')
            ->where('d.vault_id|=:ids, d.embed_status=:emb')
            ->assign(['ids' => $clean, 'emb' => 'embedded'])
            ->query()
            ->fetchAll();
        if (! \is_array($docRows)) {
            return [];
        }

        /** @var array<string, array{file_name: string, vault_name: string, path: string}> $out */
        $out = [];
        foreach ($docRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $vid = (int) ($row['vault_id'] ?? 0);
            $did = (int) ($row['id'] ?? 0);
            if ($vid < 1 || $did < 1) {
                continue;
            }
            $fn = trim((string) ($row['file_name'] ?? ''));
            $vname = trim((string) ($row['vault_name'] ?? ''));
            if ($vname === '') {
                $vname = "Vault {$vid}";
            }
            $cid = isset($row['container_id']) && $row['container_id'] !== null
                ? (int) $row['container_id']
                : null;
            $path = ($cid !== null && $cid > 0) ? $containerPath($cid) : '';
            $out["{$vid}:{$did}"] = [
                'file_name'  => $fn !== '' ? $fn : "Document #{$did}",
                'vault_name' => $vname,
                'path'       => $path,
            ];
        }

        return $out;
    }

    /**
     * @return list<int>
     */
    private static function containerSubtreeIds(Database $db, int $vaultId, int $rootContainerId): array
    {
        if ($rootContainerId < 1 || $vaultId < 1) {
            return [];
        }

        $sql = <<<'SQL'
WITH RECURSIVE sub AS (
    SELECT id FROM oaao_vault_container WHERE id = :rid AND vault_id = :v1
    UNION ALL
    SELECT c.id FROM oaao_vault_container c
    INNER JOIN sub s ON c.parent_container_id = s.id
    WHERE c.vault_id = :v2
)
SELECT id FROM sub
SQL;

        $q = $db->prepare($sql)
            ->assign([
                'rid' => $rootContainerId,
                'v1'  => $vaultId,
                'v2'  => $vaultId,
            ])
            ->query();
        /** @var list<int> $out */
        $out = [];
        while (($row = $q->fetch()) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $id = (int) ($row['id'] ?? 0);
            if ($id > 0) {
                $out[] = $id;
            }
        }

        return $out;
    }
}
