<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Persist conversation / workspace micro skills (adjunct SQLite).
 */
final class MicroSkillStorage
{
    /**
     * @param array<string, mixed> $input
     *
     * @return array<string, mixed>|null
     */
    public static function saveDraft(
        \PDO $pdo,
        int $userId,
        ?int $workspaceId,
        array $input,
    ): ?array {

        $title = trim((string) ($input['title'] ?? ''));
        if ($title === '') {
            return null;
        }
        $skillId = trim((string) ($input['skill_id'] ?? ''));
        if ($skillId === '') {
            $skillId = 'conversation:' . bin2hex(random_bytes(8));
        }
        $kind = trim((string) ($input['kind'] ?? 'conversation'));
        if ($kind === 'bound_template') {
            return null;
        }
        $summary = trim((string) ($input['summary'] ?? ''));
        $preview = trim((string) ($input['preview_markdown'] ?? ''));
        $payload = $input['payload'] ?? [];
        if (! \is_array($payload)) {
            $payload = [];
        }
        if ($summary !== '' && ! isset($payload['agent_brief'])) {
            $payload['agent_brief'] = $summary;
        }
        if ($preview === '') {
            $preview = MicroSkillCatalog::previewMarkdown($title, $kind, $summary, null, $payload);
        }
        $bindRef = isset($input['bind_ref']) ? trim((string) $input['bind_ref']) : null;
        if ($bindRef === '') {
            $bindRef = null;
        }
        $status = trim((string) ($input['status'] ?? 'draft'));
        if (! \in_array($status, ['draft', 'published'], true)) {
            $status = 'draft';
        }
        $version = isset($input['version']) ? max(1, (int) $input['version']) : 1;
        $parentSkillId = isset($input['parent_skill_id']) ? trim((string) $input['parent_skill_id']) : null;
        if ($parentSkillId === '') {
            $parentSkillId = null;
        }
        $bumpVersion = ! empty($input['bump_as_version']);
        if ($bumpVersion && $parentSkillId === null && $skillId !== '') {
            $parentSkillId = $skillId;
        }
        if ($bumpVersion) {
            $skillId = 'conversation:' . bin2hex(random_bytes(8));
            $stMax = $pdo->prepare(
                'SELECT COALESCE(MAX(version), 0) FROM oaao_micro_skill
                 WHERE user_id = ? AND (parent_skill_id = ? OR skill_id = ?)',
            );
            $root = $parentSkillId ?? $skillId;
            $stMax->execute([$userId, $root, $root]);
            $version = max(1, (int) $stMax->fetchColumn()) + 1;
        }
        $now = date('Y-m-d H:i:s');
        $st = $pdo->prepare(
            'INSERT INTO oaao_micro_skill (
                skill_id, workspace_id, user_id, kind, title, summary, bind_ref,
                payload_json, preview_markdown, status, version, parent_skill_id,
                usage_count, last_used_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
             ON CONFLICT(user_id, skill_id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                kind = excluded.kind,
                title = excluded.title,
                summary = excluded.summary,
                bind_ref = excluded.bind_ref,
                payload_json = excluded.payload_json,
                preview_markdown = excluded.preview_markdown,
                status = excluded.status,
                version = excluded.version,
                parent_skill_id = excluded.parent_skill_id,
                updated_at = excluded.updated_at',
        );
        $st->execute([
            $skillId,
            $workspaceId !== null && $workspaceId > 0 ? $workspaceId : null,
            $userId,
            $kind,
            $title,
            $summary !== '' ? $summary : null,
            $bindRef,
            json_encode($payload, JSON_UNESCAPED_UNICODE),
            $preview,
            $status,
            $version,
            $parentSkillId,
            $now,
            $now,
        ]);

        return [
            'skill_id'         => $skillId,
            'kind'             => $kind,
            'title'            => $title,
            'summary'          => $summary,
            'bind_ref'         => $bindRef,
            'payload'          => $payload,
            'preview_markdown' => $preview,
            'status'           => $status,
            'version'          => $version,
            'parent_skill_id'  => $parentSkillId,
        ];
    }

    /**
     * @param list<string> $skillIds
     *
     * @return list<array<string, mixed>>
     */
    public static function recordUsage(\PDO $pdo, int $userId, array $skillIds): array
    {

        $ids = [];
        foreach ($skillIds as $sid) {
            $s = trim((string) $sid);
            if ($s !== '') {
                $ids[] = $s;
            }
        }
        $ids = array_values(array_unique($ids));
        if ($ids === []) {
            return [];
        }

        $now = date('Y-m-d H:i:s');
        $placeholders = implode(',', array_fill(0, \count($ids), '?'));
        $st = $pdo->prepare(
            "UPDATE oaao_micro_skill
             SET usage_count = usage_count + 1, last_used_at = ?, updated_at = ?
             WHERE user_id = ? AND skill_id IN ({$placeholders})",
        );
        $st->execute(array_merge([$now, $now, $userId], $ids));

        $stSel = $pdo->prepare(
            "SELECT skill_id, title, summary, preview_markdown, usage_count, version, parent_skill_id, last_used_at
             FROM oaao_micro_skill
             WHERE user_id = ? AND skill_id IN ({$placeholders})",
        );
        $stSel->execute(array_merge([$userId], $ids));
        $rows = [];
        while ($row = $stSel->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $rows[] = [
                'skill_id'          => (string) ($row['skill_id'] ?? ''),
                'title'             => (string) ($row['title'] ?? ''),
                'summary'           => (string) ($row['summary'] ?? ''),
                'preview_markdown'  => (string) ($row['preview_markdown'] ?? ''),
                'usage_count'       => (int) ($row['usage_count'] ?? 0),
                'version'           => (int) ($row['version'] ?? 1),
                'parent_skill_id'   => isset($row['parent_skill_id']) && $row['parent_skill_id'] !== null
                    ? (string) $row['parent_skill_id']
                    : null,
                'last_used_at'      => (string) ($row['last_used_at'] ?? ''),
            ];
        }

        return $rows;
    }
}
