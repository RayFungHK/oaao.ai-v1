<?php

declare(strict_types=1);

namespace oaaoai\corpus;

use Razy\Database;

/**
 * CRUD for {@code oaao_corpus_*} tables.
 */
final class CorpusRepository
{
    public function __construct(private readonly Database $db) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function listProfilesForScope(int $tenantId, int $userId, ?int $workspaceId): array
    {
        if ($workspaceId !== null && $workspaceId > 0) {
            $rows = $this->db->prepare()
                ->select('*')
                ->from('corpus_profile')
                ->where('tenant_id=?,workspace_id=?')
                ->assign(['tenant_id' => $tenantId, 'workspace_id' => $workspaceId])
                ->order('<updated_at,<created_at')
                ->query()
                ->fetchAll();
        } else {
            $rows = $this->db->prepare()
                ->select('*')
                ->from('corpus_profile')
                ->where('tenant_id=?,workspace_id IS NULL,created_by=?')
                ->assign(['tenant_id' => $tenantId, 'created_by' => $userId])
                ->order('<updated_at,<created_at')
                ->query()
                ->fetchAll();
        }

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getProfileInScope(int $corpusId, int $tenantId, int $userId, ?int $workspaceId): ?array
    {
        if ($corpusId < 1) {
            return null;
        }

        if ($workspaceId !== null && $workspaceId > 0) {
            $where = 'corpus_id=?,tenant_id=?,workspace_id=?';
            $assign = [
                'corpus_id'    => $corpusId,
                'tenant_id'    => $tenantId,
                'workspace_id' => $workspaceId,
            ];
        } else {
            $where = 'corpus_id=?,tenant_id=?,workspace_id IS NULL,created_by=?';
            $assign = [
                'corpus_id'   => $corpusId,
                'tenant_id'   => $tenantId,
                'created_by'  => $userId,
            ];
        }

        $row = $this->db->prepare()
            ->select('*')
            ->from('corpus_profile')
            ->where($where)
            ->assign($assign)
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    public function countSources(int $corpusId): int
    {
        $row = $this->db->prepare()
            ->select('COUNT(*) AS c')
            ->from('corpus_source')
            ->where('corpus_id=?')
            ->assign(['corpus_id' => $corpusId])
            ->query()
            ->fetch();

        return \is_array($row) ? (int) ($row['c'] ?? 0) : 0;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listSources(int $corpusId): array
    {
        $rows = $this->db->prepare()
            ->select('*')
            ->from('corpus_source')
            ->where('corpus_id=?')
            ->assign(['corpus_id' => $corpusId])
            ->order('<sort_order,<source_id')
            ->query()
            ->fetchAll();

        return \is_array($rows) ? $rows : [];
    }

    /**
     * @return array{sources: list<array<string, mixed>>, total: int}
     */
    public function listSourcesPage(int $corpusId, int $limit = 50, int $offset = 0): array
    {
        $limit = max(1, min(200, $limit));
        $offset = max(0, $offset);
        $total = $this->countSources($corpusId);

        $rows = $this->db->prepare()
            ->select('*')
            ->from('corpus_source')
            ->where('corpus_id=?')
            ->assign(['corpus_id' => $corpusId])
            ->order('<sort_order,<source_id')
            ->limit($offset, $limit)
            ->query()
            ->fetchAll();

        return [
            'sources' => \is_array($rows) ? $rows : [],
            'total'   => $total,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function getSourceForCorpus(int $sourceId, int $corpusId): ?array
    {
        if ($sourceId < 1 || $corpusId < 1) {
            return null;
        }

        $row = $this->db->prepare()
            ->select('*')
            ->from('corpus_source')
            ->where('source_id=?,corpus_id=?')
            ->assign(['source_id' => $sourceId, 'corpus_id' => $corpusId])
            ->limit(1)
            ->query()
            ->fetch();

        return \is_array($row) ? $row : null;
    }

    public function deleteSource(int $sourceId, int $corpusId): void
    {
        $this->db->delete('corpus_source', [
            'source_id' => $sourceId,
            'corpus_id' => $corpusId,
        ])->query();
    }

    public function updateSourceLocator(int $sourceId, int $corpusId, string $locatorJson): void
    {
        $this->db->update('corpus_source', ['locator_json'])
            ->where('source_id=?,corpus_id=?')
            ->assign([
                'locator_json' => $locatorJson,
                'source_id'    => $sourceId,
                'corpus_id'    => $corpusId,
            ])
            ->query();
    }

    public function nextSourceSortOrder(int $corpusId): int
    {
        $row = $this->db->prepare()
            ->select('MAX(sort_order) AS m')
            ->from('corpus_source')
            ->where('corpus_id=?')
            ->assign(['corpus_id' => $corpusId])
            ->query()
            ->fetch();

        return \is_array($row) ? ((int) ($row['m'] ?? 0)) + 1 : 0;
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertProfile(array $fields): int
    {
        $this->db->insert('corpus_profile', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function updateProfile(int $corpusId, array $fields): void
    {
        $this->db->update('corpus_profile', array_keys($fields))
            ->assign(array_merge($fields, ['corpus_id' => $corpusId]))
            ->where('corpus_id=?')
            ->query();
    }

    public function deleteProfile(int $corpusId): void
    {
        $this->db->delete('corpus_profile', ['corpus_id' => $corpusId])->query();
    }

    /**
     * @param list<array{text: string, classify_json?: string|null, source_id?: int|null, ordinal: int}> $segments
     */
    public function replaceSegments(int $corpusId, array $segments): void
    {
        $this->db->delete('corpus_segment', ['corpus_id' => $corpusId])->query();

        foreach ($segments as $seg) {
            $text = trim((string) ($seg['text'] ?? ''));
            if ($text === '') {
                continue;
            }
            $this->db->insert('corpus_segment', [
                'corpus_id',
                'source_id',
                'text',
                'classify_json',
                'ordinal',
            ])
                ->assign([
                    'corpus_id'     => $corpusId,
                    'source_id'     => isset($seg['source_id']) && (int) $seg['source_id'] > 0
                        ? (int) $seg['source_id']
                        : null,
                    'text'          => $text,
                    'classify_json' => $seg['classify_json'] ?? null,
                    'ordinal'       => (int) ($seg['ordinal'] ?? 0),
                ])
                ->query();
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function listSegments(int $corpusId, int $limit = 50): array
    {
        $rows = $this->db->prepare()
            ->select('segment_id, source_id, text, classify_json, ordinal')
            ->from('corpus_segment')
            ->where('corpus_id=?')
            ->assign(['corpus_id' => $corpusId])
            ->order('<ordinal,<segment_id')
            ->limit(max(1, min(500, $limit)))
            ->query()
            ->fetchAll();

        return \is_array($rows) ? $rows : [];
    }

    public function countSegments(int $corpusId): int
    {
        $row = $this->db->prepare()
            ->select('COUNT(*) AS c')
            ->from('corpus_segment')
            ->where('corpus_id=?')
            ->assign(['corpus_id' => $corpusId])
            ->query()
            ->fetch();

        return \is_array($row) ? (int) ($row['c'] ?? 0) : 0;
    }

    /**
     * @return array{document_segment: int, template_block: int, structured_data: int}
     */
    public function summarizeSegmentKinds(int $corpusId, int $limit = 500): array
    {
        $summary = [
            'document_segment' => 0,
            'template_block'   => 0,
            'structured_data'  => 0,
        ];
        foreach ($this->listSegments($corpusId, $limit) as $seg) {
            if (! \is_array($seg)) {
                continue;
            }
            $raw = $seg['classify_json'] ?? null;
            $kind = '';
            if (\is_string($raw) && $raw !== '') {
                try {
                    $cj = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
                    if (\is_array($cj)) {
                        $kind = (string) ($cj['segment_kind'] ?? '');
                    }
                } catch (\JsonException) {
                    $kind = '';
                }
            }
            if ($kind === '' || ! isset($summary[$kind])) {
                $summary['document_segment']++;
                continue;
            }
            $summary[$kind]++;
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function patchProfileAnalyze(int $corpusId, array $fields): void
    {
        $this->updateProfile($corpusId, $fields);
    }

    /**
     * @param array<string, mixed> $fields
     */
    public function insertSource(array $fields): int
    {
        $this->db->insert('corpus_source', array_keys($fields))
            ->assign($fields)
            ->query();

        return (int) $this->db->lastID();
    }

    /**
     * @param list<string>|null $tags
     */
    /**
     * @param array<string, mixed>|null $style
     */
    public static function encodeStyleJson(?array $style): ?string
    {
        if ($style === null) {
            return null;
        }

        return json_encode($style, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function decodeStyleJson(?string $raw): ?array
    {
        if ($raw === null || trim($raw) === '') {
            return null;
        }
        try {
            $decoded = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return \is_array($decoded) ? $decoded : null;
    }

    public static function encodeTagsJson(?array $tags): ?string
    {
        if ($tags === null) {
            return null;
        }
        $clean = [];
        foreach ($tags as $t) {
            if (! \is_string($t)) {
                continue;
            }
            $s = trim($t);
            if ($s !== '') {
                $clean[] = $s;
            }
        }

        return json_encode(array_values(array_unique($clean)), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * @return list<string>
     */
    public static function decodeTagsJson(?string $raw): array
    {
        if ($raw === null || trim($raw) === '') {
            return [];
        }
        try {
            $decoded = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }
        if (! \is_array($decoded)) {
            return [];
        }
        $out = [];
        foreach ($decoded as $t) {
            if (\is_string($t) && trim($t) !== '') {
                $out[] = trim($t);
            }
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $profile
     *
     * @return array<string, mixed>
     */
    public static function profileForApi(array $profile, int $sourceCount, ?int $segmentCount = null): array
    {
        $jobId = isset($profile['analyze_job_id']) ? trim((string) $profile['analyze_job_id']) : '';

        return [
            'corpus_id'      => (int) ($profile['corpus_id'] ?? 0),
            'name'           => (string) ($profile['name'] ?? ''),
            'description'    => isset($profile['description']) ? (string) $profile['description'] : null,
            'tags'           => self::decodeTagsJson(isset($profile['tags_json']) ? (string) $profile['tags_json'] : null),
            'status'         => (string) ($profile['status'] ?? 'draft'),
            'error_message'  => isset($profile['error_message']) ? (string) $profile['error_message'] : null,
            'analyze_job_id' => $jobId !== '' ? $jobId : null,
            'workspace_id'   => isset($profile['workspace_id']) && $profile['workspace_id'] !== null
                ? (int) $profile['workspace_id']
                : null,
            'source_count'   => $sourceCount,
            'segment_count'  => $segmentCount,
            'created_at'     => (string) ($profile['created_at'] ?? ''),
            'updated_at'     => isset($profile['updated_at']) ? (string) $profile['updated_at'] : null,
        ];
    }

    /**
     * @param array<string, mixed> $source
     *
     * @return array<string, mixed>
     */
    public static function sourceForApi(array $source): array
    {
        $locator = null;
        if (isset($source['locator_json']) && \is_string($source['locator_json']) && $source['locator_json'] !== '') {
            try {
                $locator = json_decode($source['locator_json'], true, 64, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $locator = null;
            }
        }

        $kind = (string) ($source['kind'] ?? '');
        $label = isset($source['label']) ? trim((string) $source['label']) : '';

        $structSim = null;
        $structOutlier = false;
        $structWarning = null;
        if (\is_array($locator) && isset($locator['structure_analysis']) && \is_array($locator['structure_analysis'])) {
            $sa = $locator['structure_analysis'];
            if (isset($sa['similarity']) && is_numeric($sa['similarity'])) {
                $structSim = (float) $sa['similarity'];
            }
            $structOutlier = ! empty($sa['outlier']);
            $reason = isset($sa['reason']) ? trim((string) $sa['reason']) : '';
            if ($structOutlier && $reason !== '') {
                $structWarning = $reason;
            }
        }

        return [
            'source_id'             => (int) ($source['source_id'] ?? 0),
            'corpus_id'             => (int) ($source['corpus_id'] ?? 0),
            'kind'                  => $kind,
            'kind_label'            => self::sourceKindLabel($kind),
            'label'                 => $label !== '' ? $label : null,
            'summary'               => self::sourceSummary($kind, $source, $locator),
            'sort_order'            => (int) ($source['sort_order'] ?? 0),
            'byte_size'             => isset($source['byte_size']) && $source['byte_size'] !== null
                ? (int) $source['byte_size']
                : null,
            'mime_type'             => isset($source['mime_type']) ? (string) $source['mime_type'] : null,
            'locator'               => $locator,
            'structure_similarity'  => $structSim,
            'structure_outlier'     => $structOutlier,
            'structure_warning'     => $structWarning,
            'created_at'            => (string) ($source['created_at'] ?? ''),
        ];
    }

    public static function sourceKindLabel(string $kind): string
    {
        return match ($kind) {
            'upload'           => 'Upload',
            'vault_document'   => 'Vault file',
            'vault_container'  => 'Vault folder',
            default            => $kind !== '' ? $kind : 'Source',
        };
    }

    /**
     * @param array<string, mixed> $source
     * @param array<string, mixed>|null $locator
     */
    public static function sourceSummary(string $kind, array $source, ?array $locator): string
    {
        if ($kind === 'upload') {
            $parts = [];
            $bytes = isset($source['byte_size']) ? (int) $source['byte_size'] : 0;
            if ($bytes > 0) {
                $parts[] = self::formatByteSize($bytes);
            }
            $mime = isset($source['mime_type']) ? trim((string) $source['mime_type']) : '';
            if ($mime !== '') {
                $parts[] = $mime;
            }

            return $parts !== [] ? implode(' · ', $parts) : 'Uploaded file';
        }

        if ($locator === null) {
            return self::sourceKindLabel($kind);
        }

        $bits = [];
        $vaultId = (int) ($locator['vault_id'] ?? 0);
        if ($vaultId > 0) {
            $bits[] = 'Vault #' . $vaultId;
        }
        if ($kind === 'vault_document') {
            $docId = (int) ($locator['document_id'] ?? 0);
            if ($docId > 0) {
                $bits[] = 'doc ' . $docId;
            }
        } elseif ($kind === 'vault_container') {
            $ctrId = (int) ($locator['container_id'] ?? 0);
            if ($ctrId > 0) {
                $bits[] = 'folder ' . $ctrId;
            }
        }

        return $bits !== [] ? implode(' · ', $bits) : 'Vault reference';
    }

    public static function formatByteSize(int $bytes): string
    {
        if ($bytes < 1024) {
            return $bytes . ' B';
        }
        if ($bytes < 1024 * 1024) {
            return round($bytes / 1024, 1) . ' KB';
        }

        return round($bytes / (1024 * 1024), 1) . ' MB';
    }
}
