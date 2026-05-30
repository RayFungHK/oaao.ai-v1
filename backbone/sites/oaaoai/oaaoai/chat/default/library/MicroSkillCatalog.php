<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Build orchestrator {@code skills_catalog} — bound template skills + conversation rows.
 */
final class MicroSkillCatalog
{
    public static function boundTemplateSkillId(string $templateId): string
    {
        $tid = trim($templateId);

        return $tid !== '' ? 'bound_template:' . $tid : '';
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function boundSkillsFromTemplates(
        ?object $slideDesignerApi,
        int $limit = 24,
    ): array {
        if ($slideDesignerApi === null || ! method_exists($slideDesignerApi, 'listBoundTemplateSkillsForPlanner')) {
            return [];
        }

        try {
            $rows = $slideDesignerApi->listBoundTemplateSkillsForPlanner($limit);

            return \is_array($rows) ? $rows : [];
        } catch (\Throwable $e) {
            error_log('[oaao MicroSkillCatalog] boundSkillsFromTemplates: ' . $e->getMessage());

            return [];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function conversationSkills(
        \PDO $splitPdo,
        int $userId,
        ?int $workspaceId,
        int $limit = 12,
    ): array {
        $lim = max(1, min($limit, 32));
        if ($workspaceId !== null && $workspaceId > 0) {
            $st = $splitPdo->prepare(
                'SELECT skill_id, kind, title, summary, bind_ref, payload_json, preview_markdown, status
                 FROM oaao_micro_skill
                 WHERE user_id = ? AND status = ? AND kind != ?
                   AND (workspace_id IS NULL OR workspace_id = ?)
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ' . $lim,
            );
            $st->execute([$userId, 'published', 'bound_template', $workspaceId]);
        } else {
            $st = $splitPdo->prepare(
                'SELECT skill_id, kind, title, summary, bind_ref, payload_json, preview_markdown, status
                 FROM oaao_micro_skill
                 WHERE user_id = ? AND status = ? AND kind != ? AND workspace_id IS NULL
                 ORDER BY updated_at DESC, id DESC
                 LIMIT ' . $lim,
            );
            $st->execute([$userId, 'published', 'bound_template']);
        }

        /** @var list<array<string, mixed>> $out */
        $out = [];
        while ($row = $st->fetch(\PDO::FETCH_ASSOC)) {
            if (! \is_array($row)) {
                continue;
            }
            $payload = [];
            $raw = trim((string) ($row['payload_json'] ?? ''));
            if ($raw !== '') {
                try {
                    $dec = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                    if (\is_array($dec)) {
                        $payload = $dec;
                    }
                } catch (\Throwable) {
                    $payload = [];
                }
            }
            $out[] = [
                'skill_id'         => (string) ($row['skill_id'] ?? ''),
                'kind'             => (string) ($row['kind'] ?? 'conversation'),
                'title'            => (string) ($row['title'] ?? ''),
                'summary'          => (string) ($row['summary'] ?? ''),
                'bind_ref'         => $row['bind_ref'] ?? null,
                'provider_id'      => 'chat.conversation',
                'module_code'      => 'oaaoai/chat',
                'payload'          => $payload,
                'preview_markdown' => (string) ($row['preview_markdown'] ?? ''),
                'status'           => (string) ($row['status'] ?? 'published'),
            ];
        }

        return $out;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function forPlanner(
        \PDO $splitPdo,
        object $user,
        ?object $authApi,
        int $userId,
        ?int $workspaceId,
        ?string $activeTemplateId = null,
        ?object $chatApi = null,
        ?object $slideDesignerApi = null,
    ): array {
        $seen = [];
        $out = [];
        $merge = static function (array $rows) use (&$seen, &$out): void {
            foreach ($rows as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $sid = trim((string) ($row['skill_id'] ?? ''));
                if ($sid === '' || isset($seen[$sid])) {
                    continue;
                }
                $seen[$sid] = true;
                $out[] = $row;
            }
        };

        $tid = trim((string) ($activeTemplateId ?? ''));
        if ($tid !== '' && $slideDesignerApi) {
            $skill = $slideDesignerApi->resolvePublishedTemplateSkill($tid);
            if ($skill !== null) {
                $skill['preview_markdown'] = self::previewMarkdown(
                    (string) ($skill['title'] ?? $tid),
                    'bound_template',
                    (string) ($skill['summary'] ?? ''),
                    $tid,
                    \is_array($skill['payload'] ?? null) ? $skill['payload'] : [],
                );
                $merge([$skill]);
            }
        }

        $merge(self::boundSkillsFromTemplates($slideDesignerApi, 16));
        $merge(self::conversationSkills($splitPdo, $userId, $workspaceId, 12));

        return $out;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function previewMarkdown(
        string $title,
        string $kind,
        string $summary,
        ?string $bindRef,
        array $payload,
    ): string {
        $lines = ['## ' . $title];
        if ($summary !== '') {
            $lines[] = '';
            $lines[] = $summary;
        }
        if ($bindRef !== null && $bindRef !== '') {
            $lines[] = '';
            $lines[] = '_Ref: `' . $bindRef . '`_';
        }
        if ($payload !== []) {
            $lines[] = '';
            $lines[] = '```json';
            $lines[] = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            $lines[] = '```';
        }

        return implode("\n", $lines);
    }
}
