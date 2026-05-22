<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * Resolve Arango connection fields for vault GraphRAG ({@code oaao_vault.arango_*}) with Compose defaults.
 */
final class VaultArangoResolver
{
    /**
     * @param array<string, mixed> $vaultRow
     *
     * @return array{url: ?string, database: ?string, user_ref: ?string, password_ref: ?string}
     */
    public static function resolveEffectiveConfig(array $vaultRow): array
    {
        $url = self::trimOrNull($vaultRow['arango_url'] ?? null);
        if ($url === null) {
            $url = self::defaultArangoUrl();
        }

        $database = self::trimOrNull($vaultRow['arango_database'] ?? null);
        if ($database === null) {
            $database = self::defaultArangoDatabase();
        }

        $userRef = self::trimOrNull($vaultRow['arango_user_ref'] ?? null);
        if ($userRef === null) {
            $userRef = self::defaultArangoUserRef();
        }

        $passwordRef = self::trimOrNull($vaultRow['arango_password_ref'] ?? null);
        if ($passwordRef === null) {
            $passwordRef = self::defaultArangoPasswordRef();
        }

        return [
            'url'           => $url !== '' ? $url : null,
            'database'      => $database !== '' ? $database : null,
            'user_ref'      => $userRef !== '' ? $userRef : null,
            'password_ref'  => $passwordRef !== '' ? $passwordRef : null,
        ];
    }

    private static function trimOrNull(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim((string) $v);

        return $s !== '' ? $s : null;
    }

    private static function defaultArangoUrl(): string
    {
        $env = getenv('OAAO_ARANGO_URL');
        if (\is_string($env) && trim($env) !== '') {
            return trim($env);
        }

        $docker = getenv('OAAO_DOCKER');
        if ($docker !== false && \in_array(strtolower(trim((string) $docker)), ['1', 'true', 'yes'], true)) {
            return 'http://arangodb:8529';
        }

        return '';
    }

    private static function defaultArangoDatabase(): string
    {
        $env = getenv('OAAO_ARANGO_DATABASE');
        if (\is_string($env) && trim($env) !== '') {
            return trim($env);
        }

        return 'oaao_vault';
    }

    private static function defaultArangoUserRef(): string
    {
        return 'env:OAAO_ARANGO_USER';
    }

    private static function defaultArangoPasswordRef(): string
    {
        return 'env:OAAO_ARANGO_PASSWORD';
    }
}
