<?php

declare(strict_types=1);

namespace oaaoai\vault;

use Razy\Database;

/**
 * Vault + workspace glossary merge for ASR hotwords ({@code oaao_vault.glossary_json}, workspace override).
 */
final class VaultGlossary
{
    /**
     * @return array{terms: list<array<string, mixed>>}
     */
    public static function emptyDocument(): array
    {
        return ['terms' => []];
    }

    /**
     * @return array{terms: list<array<string, mixed>>}
     */
    public static function parseJson(?string $raw): array
    {
        if ($raw === null || trim($raw) === '') {
            return self::emptyDocument();
        }
        try {
            /** @var mixed $dec */
            $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return self::emptyDocument();
        }
        if (! \is_array($dec)) {
            return self::emptyDocument();
        }
        $terms = $dec['terms'] ?? [];
        if (! \is_array($terms)) {
            return self::emptyDocument();
        }
        /** @var list<array<string, mixed>> $clean */
        $clean = [];
        foreach ($terms as $t) {
            if (! \is_array($t)) {
                continue;
            }
            $term = trim((string) ($t['term'] ?? ''));
            if ($term === '') {
                continue;
            }
            $row = ['term' => $term];
            if (isset($t['aliases']) && \is_array($t['aliases'])) {
                $row['aliases'] = array_values(array_filter(array_map(
                    static fn ($a): string => trim((string) $a),
                    $t['aliases'],
                ), static fn (string $s): bool => $s !== ''));
            }
            if (isset($t['note']) && \is_string($t['note']) && trim($t['note']) !== '') {
                $row['note'] = trim($t['note']);
            }
            $clean[] = $row;
        }

        return ['terms' => $clean];
    }

    /**
     * Workspace terms override vault terms on identical {@code term} key (case-insensitive).
     *
     * @param array{terms: list<array<string, mixed>>} $vault
     * @param array{terms: list<array<string, mixed>>} $workspace
     *
     * @return array{terms: list<array<string, mixed>>}
     */
    public static function merge(array $vault, array $workspace): array
    {
        /** @var array<string, array<string, mixed>> $byKey */
        $byKey = [];
        foreach ($vault['terms'] as $t) {
            $k = strtolower(trim((string) ($t['term'] ?? '')));
            if ($k !== '') {
                $byKey[$k] = $t;
            }
        }
        foreach ($workspace['terms'] as $t) {
            $k = strtolower(trim((string) ($t['term'] ?? '')));
            if ($k !== '') {
                $byKey[$k] = $t;
            }
        }
        $merged = array_values($byKey);
        usort($merged, static fn (array $a, array $b): int => strcasecmp((string) ($a['term'] ?? ''), (string) ($b['term'] ?? '')));

        return ['terms' => $merged];
    }

    public static function encode(array $doc): string
    {
        return json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @return array{terms: list<array<string, mixed>>}|null
     */
    public static function loadVaultGlossary(Database $db, int $vaultId): ?array
    {
        if ($vaultId < 1) {
            return null;
        }
        $row = $db->prepare()
            ->select('glossary_json')
            ->from('vault')
            ->where('id=:vid')
            ->assign(['vid' => $vaultId])
            ->limit(1)
            ->query()
            ->fetch();

        return self::parseJson(\is_array($row) ? (string) ($row['glossary_json'] ?? '') : null);
    }

    /**
     * @return array{terms: list<array<string, mixed>>}
     */
    public static function loadWorkspaceGlossary(\PDO $pdo, ?int $workspaceId): array
    {
        if ($workspaceId === null || $workspaceId < 1) {
            return self::emptyDocument();
        }
        $st = $pdo->prepare('SELECT glossary_json FROM oaao_workspace WHERE workspace_id = ? LIMIT 1');
        $st->execute([$workspaceId]);
        /** @var array<string, mixed>|false $row */
        $row = $st->fetch(\PDO::FETCH_ASSOC);

        return self::parseJson(\is_array($row) ? (string) ($row['glossary_json'] ?? '') : null);
    }

    /**
     * @return array{terms: list<array<string, mixed>>}
     */
    public static function mergedForVault(Database $db, \PDO $pdo, int $vaultId, ?int $workspaceId): array
    {
        $vault = self::loadVaultGlossary($db, $vaultId) ?? self::emptyDocument();
        $ws = self::loadWorkspaceGlossary($pdo, $workspaceId);

        return self::merge($vault, $ws);
    }
}
