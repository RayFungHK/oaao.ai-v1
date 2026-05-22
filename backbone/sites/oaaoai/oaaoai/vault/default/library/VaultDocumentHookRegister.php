<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * Frozen registry of **document pipeline hooks** for Vault — ingest / enrich / index actions on tree nodes.
 *
 * Hierarchy (product): {@code Workspace | Personal} → {@code Vault} → {@code Container} → tree documents.
 *
 * Modules contribute capabilities via {@code vault_document_hook.register} (namespaced event); {@see \\Module\\oaao\\endpoints}
 * merges rows through {@see vault_document_hook_register_listener}. Embedded in the SPA shell as JSON ({@see core.main.php})
 * so panel code can render actions (ASR on audio, embedding+RAG on text/pdf, …) without hard-coding providers.
 *
 * {@code kind} (open vocabulary): {@code audio_asr}, {@code text_embed_rag}, {@code preview}, {@code export}, …
 *
 * Orchestrator-side workers should consume the same stable {@code hook_id} values when dispatching ingest jobs.
 */
final class VaultDocumentHookRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $hooks = [];

    /**
     * @param array<string, mixed> $extras sort, module_code, description, mime_prefixes (list|string), purpose_keys (list), sidecar_route (string)
     */
    public static function add(string $hook_id, string $kind, string $label = '', array $extras = []): void
    {
        $hook_id = trim($hook_id);
        if ($hook_id === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'hook_id' => $hook_id,
            'kind'    => trim($kind),
            'label'   => $label,
            'sort'    => $sort,
        ];

        foreach (['module_code', 'description', 'sidecar_route'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        if (isset($extras['mime_prefixes'])) {
            if (is_array($extras['mime_prefixes'])) {
                $row['mime_prefixes'] = array_values(array_filter(array_map('strval', $extras['mime_prefixes'])));
            } elseif (is_string($extras['mime_prefixes']) && trim($extras['mime_prefixes']) !== '') {
                $row['mime_prefixes'] = trim($extras['mime_prefixes']);
            }
        }

        if (isset($extras['purpose_keys']) && is_array($extras['purpose_keys'])) {
            $row['purpose_keys'] = array_values(array_filter(array_map('strval', $extras['purpose_keys'])));
        }

        self::$hooks[$hook_id] = $row;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$hooks);
        usort($values, static fn (array $a, array $b): int => ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500));

        return $values;
    }
}
