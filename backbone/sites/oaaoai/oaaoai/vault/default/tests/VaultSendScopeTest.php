<?php

declare(strict_types=1);

use oaaoai\vault\VaultSendScope;
use PHPUnit\Framework\TestCase;

final class VaultSendScopeTest extends TestCase
{
    public function test_parse_composer_refs_builds_vault_ids(): void
    {
        $parsed = VaultSendScope::parseComposerInput([
            'vault_source_refs' => [
                ['kind' => 'document', 'id' => 10, 'vault_id' => 2, 'name' => 'Doc'],
                ['kind' => 'vault', 'id' => 2, 'vault_id' => 0, 'name' => 'V'],
            ],
        ]);

        self::assertCount(2, $parsed['refs']);
        self::assertSame([2], $parsed['ids']);
        self::assertFalse($parsed['auto_rag']);
    }

    public function test_parse_composer_falls_back_to_vault_source_ids(): void
    {
        $parsed = VaultSendScope::parseComposerInput([
            'vault_source_ids' => [5, 5, 9],
            'vault_auto_rag' => 1,
        ]);

        self::assertSame([], $parsed['refs']);
        self::assertSame([5, 9], $parsed['ids']);
        self::assertTrue($parsed['auto_rag']);
    }
}
