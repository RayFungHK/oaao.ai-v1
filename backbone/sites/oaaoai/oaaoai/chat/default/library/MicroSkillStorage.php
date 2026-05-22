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
        require_once dirname(__DIR__, 1) . '/controller/api/_ensure_micro_skill_schema.php';
        oaao_chat_ensure_micro_skill_schema($pdo);

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
        $now = date('Y-m-d H:i:s');
        $st = $pdo->prepare(
            'INSERT INTO oaao_micro_skill (
                skill_id, workspace_id, user_id, kind, title, summary, bind_ref,
                payload_json, preview_markdown, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, skill_id) DO UPDATE SET
                workspace_id = excluded.workspace_id,
                kind = excluded.kind,
                title = excluded.title,
                summary = excluded.summary,
                bind_ref = excluded.bind_ref,
                payload_json = excluded.payload_json,
                preview_markdown = excluded.preview_markdown,
                status = excluded.status,
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
        ];
    }
}
