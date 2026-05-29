<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * Vault-owned parsing for chat send composer scope ({@code vault_source_*} / {@code vault_auto_rag}).
 *
 * Consumed by {@code oaaoai/vault} {@code chat.send.prepare} listener — not inline in {@see send.php}.
 */
final class VaultSendScope
{
    /**
     * @param array<string, mixed> $input
     * @return array{
     *     refs: list<array{kind: string, id: int, vault_id: int, name: string}>,
     *     ids: list<int>,
     *     auto_rag: bool
     * }
     */
    public static function parseComposerInput(array $input): array
    {
        /** @var list<array{kind: string, id: int, vault_id: int, name: string}> $refs */
        $refs = [];
        $refsRaw = $input['vault_source_refs'] ?? null;
        if (\is_array($refsRaw)) {
            foreach ($refsRaw as $item) {
                if (! \is_array($item)) {
                    continue;
                }
                $kind = strtolower(trim((string) ($item['kind'] ?? '')));
                $rid = \is_int($item['id'] ?? null) ? (int) $item['id'] : (int) ($item['id'] ?? 0);
                $vaultRowId = \is_int($item['vault_id'] ?? null) ? (int) $item['vault_id'] : (int) ($item['vault_id'] ?? 0);
                if ($kind === 'vault') {
                    $vaultRowId = $rid;
                }
                if (! \in_array($kind, ['vault', 'folder', 'document'], true) || $rid < 1 || $vaultRowId < 1) {
                    continue;
                }
                $nm = substr(trim((string) ($item['name'] ?? '')), 0, 512);
                $refs[] = ['kind' => $kind, 'id' => $rid, 'vault_id' => $vaultRowId, 'name' => $nm];
                if (\count($refs) >= 24) {
                    break;
                }
            }
        }

        /** @var list<int> $ids */
        $ids = [];
        if ($refs !== []) {
            $seenVault = [];
            foreach ($refs as $ref) {
                $v = (int) ($ref['vault_id'] ?? 0);
                if ($v < 1 || isset($seenVault[$v])) {
                    continue;
                }
                $seenVault[$v] = true;
                $ids[] = $v;
            }
            sort($ids);
        } else {
            $vaultRaw = $input['vault_source_ids'] ?? null;
            if (\is_array($vaultRaw)) {
                foreach ($vaultRaw as $v) {
                    $vid = \is_int($v) ? $v : (int) $v;
                    if ($vid > 0) {
                        $ids[] = $vid;
                    }
                    if (\count($ids) >= 24) {
                        break;
                    }
                }
                $ids = array_values(array_unique($ids, SORT_NUMERIC));
            }
        }

        return [
            'refs'     => $refs,
            'ids'      => $ids,
            'auto_rag' => self::parseAutoRag($input),
        ];
    }

    /**
     * @param array<string, mixed> $input
     */
    public static function parseAutoRag(array $input): bool
    {
        $varRaw = $input['vault_auto_rag'] ?? null;
        if ($varRaw === true || $varRaw === 1 || $varRaw === '1') {
            return true;
        }

        return \is_string($varRaw) && strtolower(trim($varRaw)) === 'true';
    }
}
