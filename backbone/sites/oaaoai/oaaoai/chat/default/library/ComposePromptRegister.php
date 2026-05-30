<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Compose (llm_stream) prompt lines — modules register via {@code api('chat')->setComposePrompt()}.
 *
 * PHP forwards {@code module_prompts.compose_assistant.{slot}.content} on orchestrator send.
 * Python injects content as-is (no template files for compose).
 */
final class ComposePromptRegister
{
    /** @var list<array{module: string, slot: string, content: string, sort: int}> */
    protected static array $entries = [];

    public static function add(string $module, string $slot, string $content, int $sort = 500): void
    {
        $module = trim($module);
        $slot = trim($slot);
        $content = trim($content);
        if ($module === '' || $slot === '' || $content === '') {
            return;
        }

        self::$entries[] = [
            'module'  => $module,
            'slot'    => $slot,
            'content' => $content,
            'sort'    => $sort,
        ];
    }

    /**
     * @return list<array{module: string, slot: string, content: string, sort: int}>
     */
    public static function allSorted(): array
    {
        $values = self::$entries;
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }

    /**
     * @param array<string, mixed> $mergedPayload
     *
     * @return array<string, array{content: string}>
     */
    public static function forOrchestrator(array $mergedPayload): array
    {
        $variables = [
            'upcoming_calendar_events' => ModulePromptPayload::formatCalendarEvents(
                $mergedPayload['upcoming_calendar_events'] ?? null,
            ),
            'open_todo_items' => ModulePromptPayload::formatOpenTodos(
                $mergedPayload['open_todo_items'] ?? null,
            ),
        ];

        $out = [];
        foreach (self::allSorted() as $row) {
            $slot = trim((string) ($row['slot'] ?? ''));
            $content = trim((string) ($row['content'] ?? ''));
            if ($slot === '' || $content === '') {
                continue;
            }
            $out[$slot] = [
                'content' => self::renderVariables($content, $variables),
            ];
        }

        return $out;
    }

    /**
     * @param array<string, string> $variables
     */
    private static function renderVariables(string $content, array $variables): string
    {
        $out = $content;
        foreach ($variables as $key => $value) {
            $out = str_replace('{{' . $key . '}}', $value, $out);
        }

        return $out;
    }

    /** Text Python injects at compose (prefix + slot contents) — for message debug meta. */
    public static function injectPreview(array $mergedPayload): string
    {
        $blocks = [];
        foreach (self::forOrchestrator($mergedPayload) as $row) {
            $content = trim((string) ($row['content'] ?? ''));
            if ($content !== '') {
                $blocks[] = $content;
            }
        }
        if ($blocks === []) {
            return '';
        }

        return "Keep the assistant reply fluent. Place each fence block right after its related section.\n\n"
            . implode("\n\n", $blocks);
    }
}
