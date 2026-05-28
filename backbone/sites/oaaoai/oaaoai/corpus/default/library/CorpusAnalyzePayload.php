<?php

declare(strict_types=1);

namespace oaaoai\corpus;

use Oaaoai\Core\StorageDomain;
use Oaaoai\Core\StorageLocator;
use Oaaoai\Core\TenantBlobStorage;
use Razy\Database;

/**
 * Resolve corpus sources into orchestrator analyze payload (CS-1-S6–S8).
 */
final class CorpusAnalyzePayload
{
    public const SEGMENT_CAP = 500;

    public function __construct(
        private readonly Database $db,
        private readonly \PDO $pdo,
        private readonly CorpusRepository $repo,
    ) {}

    /**
     * @param array<string, mixed> $profile
     * @param array<string, mixed>|null $llmCfg orchestrator LLM config from {@see CorpusLlmBootstrap}
     *
     * @return array<string, mixed>
     */
    public function build(int $corpusId, int $tenantId, int $userId, array $profile, ?array $llmCfg = null): array
    {
        $sources = $this->repo->listSources($corpusId);
        $blob = new TenantBlobStorage($this->pdo, $tenantId, StorageDomain::CORPUS);
        $corpusRoot = StorageDomain::defaultLocalRoot(StorageDomain::CORPUS);
        $resolved = [];

        foreach ($sources as $src) {
            if (! \is_array($src)) {
                continue;
            }
            $kind = (string) ($src['kind'] ?? '');
            $sourceId = (int) ($src['source_id'] ?? 0);
            $label = (string) ($src['label'] ?? '');
            $locatorRaw = isset($src['locator_json']) ? (string) $src['locator_json'] : '';

            if ($kind === 'upload') {
                $item = $this->resolveUpload($blob, $corpusRoot, $locatorRaw, $sourceId, $label, $src);
                if ($item !== null) {
                    $resolved[] = $item;
                }
                continue;
            }

            if ($locatorRaw === '') {
                continue;
            }
            try {
                $loc = json_decode($locatorRaw, true, 64, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            if (! \is_array($loc)) {
                continue;
            }

            if ($kind === 'vault_document') {
                $item = $this->resolveVaultDocument($loc, $sourceId, $label, $tenantId);
                if ($item !== null) {
                    $resolved[] = $item;
                }
            } elseif ($kind === 'vault_container') {
                foreach ($this->resolveVaultContainerDocuments($loc, $sourceId, $tenantId) as $docItem) {
                    $resolved[] = $docItem;
                }
            }
        }

        $out = [
            'corpus_id'           => $corpusId,
            'tenant_id'           => $tenantId,
            'user_id'             => $userId,
            'profile_name'        => (string) ($profile['name'] ?? ''),
            'sources'             => $resolved,
            'corpus_storage_root' => $corpusRoot,
            'segment_cap'         => self::SEGMENT_CAP,
            'background'          => true,
        ];
        if ($llmCfg !== null) {
            $out['llm_cfg'] = $llmCfg;
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function resolveUpload(
        TenantBlobStorage $blob,
        string $corpusRoot,
        string $locatorJson,
        int $sourceId,
        string $label,
        array $src,
    ): ?array {
        if ($locatorJson === '') {
            return null;
        }
        try {
            $abs = $blob->resolveAbsolutePath($locatorJson, null, $corpusRoot);
        } catch (\Throwable) {
            return null;
        }
        if (! is_readable($abs)) {
            return null;
        }

        $loc = StorageLocator::decodeJson($locatorJson);
        $relativeKey = $loc !== null ? ltrim($loc->key, '/') : '';
        $fileName = trim($label);
        if ($fileName === '' && $relativeKey !== '') {
            $fileName = basename($relativeKey);
        }
        if ($fileName === '') {
            $fileName = 'upload';
        }

        $mime = isset($src['mime_type']) ? trim((string) $src['mime_type']) : '';
        if ($mime === '' || $mime === 'application/octet-stream') {
            $mime = self::guessMimeFromName($fileName);
        }

        $item = [
            'kind'           => 'upload',
            'source_id'      => $sourceId,
            'label'          => $label !== '' ? $label : $fileName,
            'file_name'      => $fileName,
            'absolute_path'  => $abs,
            'relative_path'  => $relativeKey,
            'mime_type'      => $mime,
            'source_text'    => null,
        ];
        if ($loc !== null) {
            $item['storage_locator'] = $loc->toArray();
        }

        return $item;
    }

    private static function guessMimeFromName(string $fileName): string
    {
        $ext = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));

        return match ($ext) {
            'pdf'  => 'application/pdf',
            'md', 'markdown' => 'text/markdown',
            'txt'  => 'text/plain',
            'csv'  => 'text/csv',
            'json' => 'application/json',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            default => 'application/octet-stream',
        };
    }

    /**
     * @param array<string, mixed> $loc
     *
     * @return array<string, mixed>|null
     */
    private function resolveVaultDocument(array $loc, int $sourceId, string $label, int $tenantId): ?array
    {
        $vaultId = (int) ($loc['vault_id'] ?? 0);
        $documentId = (int) ($loc['document_id'] ?? 0);
        if ($vaultId < 1 || $documentId < 1) {
            return null;
        }

        $row = $this->loadVaultDocumentRow($documentId, $vaultId, $tenantId);
        if ($row === null) {
            return null;
        }

        return $this->vaultDocumentPayloadItem($row, $sourceId, $label, $vaultId, $documentId);
    }

    /**
     * @param array<string, mixed> $loc
     *
     * @return list<array<string, mixed>>
     */
    private function resolveVaultContainerDocuments(array $loc, int $sourceId, int $tenantId): array
    {
        $vaultId = (int) ($loc['vault_id'] ?? 0);
        $containerId = (int) ($loc['container_id'] ?? 0);
        if ($vaultId < 1 || $containerId < 1) {
            return [];
        }

        $rows = $this->db->prepare()
            ->select('id, vault_id, file_name, mime_type, storage_path, source_text, byte_size')
            ->from('vault_document')
            ->where('vault_id=:vid, container_id=:cid')
            ->assign(['vid' => $vaultId, 'cid' => $containerId])
            ->order('+file_name')
            ->limit(200)
            ->query()
            ->fetchAll();

        if (! \is_array($rows)) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            $item = $this->vaultDocumentPayloadItem($row, $sourceId, '', $vaultId, (int) ($row['id'] ?? 0));
            if ($item !== null) {
                $out[] = $item;
            }
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function loadVaultDocumentRow(int $documentId, int $vaultId, int $tenantId): ?array
    {
        $where = 'id=:did, vault_id=:vid';
        $assign = ['did' => $documentId, 'vid' => $vaultId];
        if ($tenantId > 0) {
            $where .= ', tenant_id=:tid';
            $assign['tid'] = $tenantId;
        }

        $row = $this->db->prepare()
            ->select('id, vault_id, file_name, mime_type, storage_path, source_text, byte_size')
            ->from('vault_document')
            ->where($where)
            ->assign($assign)
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    /**
     * @param array<string, mixed> $row
     *
     * @return array<string, mixed>|null
     */
    private function vaultDocumentPayloadItem(
        array $row,
        int $sourceId,
        string $label,
        int $vaultId,
        int $documentId,
    ): ?array {
        $storageRoot = StorageDomain::defaultLocalRoot(StorageDomain::VAULT);
        $rel = isset($row['storage_path']) ? trim((string) $row['storage_path']) : '';
        $abs = null;
        if ($rel !== '' && ! str_contains($rel, '..')) {
            $candidate = rtrim($storageRoot, '/\\') . '/' . ltrim($rel, '/');
            if (is_readable($candidate)) {
                $abs = $candidate;
            }
        }

        $sourceText = isset($row['source_text']) ? trim((string) $row['source_text']) : '';
        if ($sourceText === '' && $abs === null) {
            return null;
        }

        $fileName = (string) ($row['file_name'] ?? $label ?: "Document {$documentId}");

        return [
            'kind'          => 'vault_document',
            'source_id'     => $sourceId,
            'vault_id'      => $vaultId,
            'document_id'   => $documentId,
            'label'         => $label !== '' ? $label : $fileName,
            'file_name'     => $fileName,
            'mime_type'     => (string) ($row['mime_type'] ?? ''),
            'absolute_path' => $abs,
            'source_text'   => $sourceText !== '' ? $sourceText : null,
        ];
    }
}
