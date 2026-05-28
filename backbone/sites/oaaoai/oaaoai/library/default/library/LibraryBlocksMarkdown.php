<?php

declare(strict_types=1);

namespace oaaoai\library;

/**
 * Library block JSON → markdown (mirrors python/oaao_orchestrator/library/blocks.py).
 */
final class LibraryBlocksMarkdown
{
    /**
     * @param list<array<string, mixed>> $blocks
     */
    public static function blocksToMarkdown(array $blocks, string $title = ''): string
    {
        $parts = [];
        $title = trim($title);
        if ($title !== '') {
            $parts[] = '# ' . $title . "\n";
        }

        foreach ($blocks as $block) {
            if (! \is_array($block)) {
                continue;
            }
            $btype = strtolower(trim((string) ($block['type'] ?? 'paragraph')));
            $content = trim((string) ($block['content'] ?? ''));
            if ($btype === 'divider') {
                $parts[] = "\n---\n";

                continue;
            }
            if ($content === '' && $btype !== 'divider') {
                continue;
            }
            if ($btype === 'heading') {
                $level = $block['level'] ?? 1;
                $lvl = max(1, min(3, (int) $level));
                $parts[] = str_repeat('#', $lvl) . ' ' . $content . "\n";

                continue;
            }
            if ($btype === 'bullet_list') {
                $lines = preg_split('/\R/u', $content) ?: [$content];
                foreach ($lines as $ln) {
                    $ln = trim((string) $ln);
                    if ($ln !== '') {
                        $parts[] = '- ' . $ln . "\n";
                    }
                }

                continue;
            }
            if ($btype === 'numbered_list') {
                $lines = preg_split('/\R/u', $content) ?: [$content];
                $i = 1;
                foreach ($lines as $ln) {
                    $ln = trim((string) $ln);
                    if ($ln !== '') {
                        $parts[] = $i . '. ' . $ln . "\n";
                        ++$i;
                    }
                }

                continue;
            }
            if ($btype === 'code') {
                $parts[] = "```\n{$content}\n```\n";

                continue;
            }
            $parts[] = $content . "\n\n";
        }

        return trim(implode('', $parts));
    }
}
