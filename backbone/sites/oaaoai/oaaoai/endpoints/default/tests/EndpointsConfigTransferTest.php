<?php

declare(strict_types=1);

use oaaoai\endpoints\EndpointsConfigTransfer;
use PHPUnit\Framework\TestCase;

final class EndpointsConfigTransferTest extends TestCase
{
    public function test_endpoint_roundtrip_on_sqlite(): void
    {
        $pdo = new PDO('sqlite::memory:');
        $pdo->exec('CREATE TABLE oaao_endpoint (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER DEFAULT NULL,
            name TEXT NOT NULL,
            endpoint_type TEXT NOT NULL DEFAULT "chat",
            base_url TEXT,
            model TEXT NOT NULL,
            api_key_ref TEXT,
            is_enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT,
            created_at TEXT,
            updated_at TEXT
        )');
        $pdo->exec("INSERT INTO oaao_endpoint (name, endpoint_type, model, config_json, is_enabled, created_at, updated_at)
            VALUES ('gemma-polish', 'polish', 'google/gemma-4-e4b-it', '{\"max_output_tokens\":256}', 1, '2026-01-01', '2026-01-01')");

        $transfer = new EndpointsConfigTransfer($pdo, 'oaao_', 0);
        $bundle = $transfer->export();
        self::assertSame(1, $bundle['schema_version']);
        self::assertCount(1, $bundle['endpoints']);
        self::assertSame('gemma-polish', $bundle['endpoints'][0]['name']);
        self::assertSame(256, $bundle['endpoints'][0]['config_json']['max_output_tokens'] ?? null);

        $pdo->exec('DELETE FROM oaao_endpoint');
        $result = $transfer->import($bundle);
        self::assertSame(1, $result['endpoints_created']);
        self::assertSame(0, $result['endpoints_updated']);

        $stmt = $pdo->query('SELECT name, model FROM oaao_endpoint');
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : false;
        self::assertIsArray($row);
        self::assertSame('gemma-polish', $row['name']);
        self::assertSame('google/gemma-4-e4b-it', $row['model']);
    }
}
