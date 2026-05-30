<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Snapshot of orchestrator prompt injections for a send — stored on assistant {@code meta_json.orchestrator_prompt_debug}.
 */
final class ChatOrchestratorPromptDebug
{
    /**
     * @param array<string, mixed> $payload final orchestrator POST body
     *
     * @return array<string, mixed>
     */
    public static function fromPayload(array $payload, ?string $runId = null): array
    {
        $postTurnIds = [];
        $rawActions = $payload['post_turn_actions'] ?? null;
        if (\is_array($rawActions)) {
            foreach ($rawActions as $row) {
                if (! \is_array($row)) {
                    continue;
                }
                $id = trim((string) ($row['action_id'] ?? ''));
                if ($id !== '') {
                    $postTurnIds[] = $id;
                }
            }
        }

        $modulePrompts = $payload['module_prompts'] ?? null;
        $compose = \is_array($modulePrompts) && isset($modulePrompts['compose_assistant']) && \is_array($modulePrompts['compose_assistant'])
            ? $modulePrompts['compose_assistant']
            : [];

        $composeSlots = [];
        foreach ($compose as $slot => $row) {
            if (! \is_string($slot) || ! \is_array($row)) {
                continue;
            }
            $composeSlots[$slot] = [
                'content'       => trim((string) ($row['content'] ?? '')),
                'content_chars' => strlen(trim((string) ($row['content'] ?? ''))),
                'template_ref'  => trim((string) ($row['template_ref'] ?? '')),
            ];
        }

        $snapshot = [
            'captured_at'            => gmdate('Y-m-d\TH:i:s\Z'),
            'run_id'                 => $runId !== null && trim($runId) !== '' ? trim($runId) : null,
            'module_prompts'         => \is_array($modulePrompts) ? $modulePrompts : null,
            'planner_prompt_block'   => trim((string) ($payload['planner_prompt_block'] ?? '')),
            'post_turn_action_ids'   => $postTurnIds,
            'compose_assistant'      => $composeSlots,
            'compose_inject_preview' => ComposePromptRegister::injectPreview($payload),
            'enable_web_search'      => ! empty($payload['enable_web_search']),
            'allowed_agents'         => \is_array($payload['allowed_agents'] ?? null)
                ? array_values($payload['allowed_agents'])
                : [],
        ];

        return $snapshot;
    }
}
