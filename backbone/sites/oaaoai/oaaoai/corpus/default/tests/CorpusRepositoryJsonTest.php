<?php

declare(strict_types=1);

use oaaoai\corpus\CorpusRepository;
use PHPUnit\Framework\TestCase;

final class CorpusRepositoryJsonTest extends TestCase
{
    public function test_tags_roundtrip(): void
    {
        $json = CorpusRepository::encodeTagsJson(['  Alpha ', 'beta', 'alpha', '']);
        self::assertIsString($json);
        $tags = CorpusRepository::decodeTagsJson($json);
        self::assertSame(['Alpha', 'beta', 'alpha'], $tags);
    }

    public function test_profile_for_api_shape(): void
    {
        $row = [
            'corpus_id'     => 7,
            'name'          => 'Brand voice',
            'description'   => null,
            'tags_json'     => '["x"]',
            'status'        => 'draft',
            'error_message' => null,
            'workspace_id'  => 3,
            'created_at'    => '2026-01-01',
            'updated_at'    => null,
        ];
        $api = CorpusRepository::profileForApi($row, 2);
        self::assertSame(7, $api['corpus_id']);
        self::assertSame(2, $api['source_count']);
        self::assertSame(['x'], $api['tags']);
        self::assertSame(3, $api['workspace_id']);
    }

    public function test_style_json_roundtrip(): void
    {
        $style = ['version' => 1, 'tone' => 'formal', 'meta' => ['style_confidence' => 0.9]];
        $json = CorpusRepository::encodeStyleJson($style);
        self::assertIsString($json);
        $decoded = CorpusRepository::decodeStyleJson($json);
        self::assertSame('formal', $decoded['tone'] ?? '');
    }

    public function test_source_for_api_upload_summary(): void
    {
        $api = CorpusRepository::sourceForApi([
            'source_id'    => 9,
            'corpus_id'    => 7,
            'kind'         => 'upload',
            'label'        => 'notes.pdf',
            'locator_json' => '{}',
            'sort_order'   => 0,
            'byte_size'    => 2048,
            'mime_type'    => 'application/pdf',
            'created_at'   => '2026-01-01',
        ]);
        self::assertSame('Upload', $api['kind_label']);
        self::assertSame('notes.pdf', $api['label']);
        self::assertStringContainsString('KB', $api['summary']);
    }

    public function test_source_for_api_vault_summary(): void
    {
        $api = CorpusRepository::sourceForApi([
            'source_id'    => 10,
            'corpus_id'    => 7,
            'kind'         => 'vault_document',
            'label'        => 'Brief.docx',
            'locator_json' => '{"vault_id":3,"document_id":88}',
            'sort_order'   => 1,
            'created_at'   => '2026-01-02',
        ]);
        self::assertSame('Vault file', $api['kind_label']);
        self::assertStringContainsString('Vault #3', $api['summary']);
        self::assertStringContainsString('doc 88', $api['summary']);
    }
}
