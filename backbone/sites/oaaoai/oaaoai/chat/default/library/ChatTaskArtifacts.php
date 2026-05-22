<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Aggregates {@code oaao_pipeline.artifacts} for one logical or run task id (v1 — no artifact table).
 */
final class ChatTaskArtifacts
{
    /**
     * @param list<array<string, mixed>> $messageRows rows with role + meta_json
     *
     * @return list<array<string, mixed>>
     */
    public static function collectFromMessages(array $messageRows, string $taskId): array
    {
        /** @var array<string, true> $seen */
        $seen = [];
        /** @var list<array<string, mixed>> $artifacts */
        $artifacts = [];

        foreach ($messageRows as $row) {
            if (! \is_array($row)) {
                continue;
            }
            if (strtolower((string) ($row['role'] ?? '')) !== 'assistant') {
                continue;
            }
            $mj = $row['meta_json'] ?? null;
            if (! \is_string($mj) || $mj === '') {
                continue;
            }
            try {
                /** @var mixed $decoded */
                $decoded = json_decode($mj, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                continue;
            }
            if (! \is_array($decoded)) {
                continue;
            }

            if (! self::messageMatchesTask($decoded, $taskId)) {
                continue;
            }

            $pipe = $decoded['oaao_pipeline'] ?? null;
            if (! \is_array($pipe)) {
                continue;
            }
            $arts = $pipe['artifacts'] ?? null;
            if (! \is_array($arts)) {
                continue;
            }
            foreach ($arts as $a) {
                if (! \is_array($a)) {
                    continue;
                }
                $key = self::artifactDedupeKey($a);
                if (isset($seen[$key])) {
                    continue;
                }
                $seen[$key] = true;
                $artifacts[] = $a;
            }
        }

        return $artifacts;
    }

    /**
     * @param array<string, mixed> $meta decoded message meta_json
     */
    private static function messageMatchesTask(array $meta, string $taskId): bool
    {
        $pipe = $meta['oaao_pipeline'] ?? null;
        if (\is_array($pipe)) {
            $tid = isset($pipe['task_id']) && is_string($pipe['task_id']) ? trim($pipe['task_id']) : '';
            if ($tid !== '' && $tid === $taskId) {
                return true;
            }
            $arts = $pipe['artifacts'] ?? null;
            if (\is_array($arts)) {
                foreach ($arts as $a) {
                    if (! \is_array($a)) {
                        continue;
                    }
                    $rt = isset($a['run_task_id']) && is_string($a['run_task_id']) ? trim($a['run_task_id']) : '';
                    if ($rt !== '' && $rt === $taskId) {
                        return true;
                    }
                }
            }
        }

        $tasks = $meta['tasks'] ?? null;
        if (\is_array($tasks)) {
            $items = $tasks['items'] ?? null;
            if (\is_array($items)) {
                foreach ($items as $item) {
                    if (! \is_array($item)) {
                        continue;
                    }
                    $id = isset($item['id']) && is_string($item['id']) ? trim($item['id']) : '';
                    if ($id !== '' && $id === $taskId) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $artifact
     */
    private static function artifactDedupeKey(array $artifact): string
    {
        $id = isset($artifact['id']) && is_string($artifact['id']) ? trim($artifact['id']) : '';
        if ($id !== '') {
            return 'id:' . $id;
        }
        $name = isset($artifact['name']) && is_string($artifact['name']) ? trim($artifact['name']) : '';
        $mime = isset($artifact['mime']) && is_string($artifact['mime']) ? trim($artifact['mime']) : '';
        $size = $artifact['size_bytes'] ?? '';

        return 'nm:' . $name . '|' . $mime . '|' . (string) $size;
    }
}
