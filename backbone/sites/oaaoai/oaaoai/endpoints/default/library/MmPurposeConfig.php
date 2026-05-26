<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Multimodal purpose {@code meta_json} → orchestrator payload ({@code mm.understand.*}, {@code mm.generate.*}, {@code mm.edit.*}).
 *
 * Settings choose {@code backend}: {@code endpoint} (OpenAI-compat chat / vision) or {@code python_module} (registered module, e.g. {@code mm_lance}).
 */
final class MmPurposeConfig
{
    public const BACKEND_ENDPOINT = 'endpoint';

    public const BACKEND_PYTHON_MODULE = 'python_module';

    /**
     * @return array<string, mixed>
     */
    public static function defaultMeta(string $mmAxis): array
    {
        $axis = self::normalizeAxis($mmAxis);

        return [
            'backend'       => self::BACKEND_ENDPOINT,
            'protocol'      => 'openai_chat',
            'python_module' => 'mm_lance',
            'mm_axis'       => $axis,
            'default_task'  => self::defaultTaskForAxis($axis),
        ];
    }

    public static function normalizeAxis(string $axis): string
    {
        $raw = strtolower(trim($axis));

        return \in_array($raw, ['understand', 'generate', 'edit'], true) ? $raw : 'understand';
    }

    /**
     * @return array<string, mixed>
     */
    public static function decodePurposeMeta(mixed $metaJson): array
    {
        if (\is_array($metaJson)) {
            $decoded = $metaJson;
        } elseif (\is_string($metaJson) && trim($metaJson) !== '') {
            $decoded = json_decode($metaJson, true);
            $decoded = \is_array($decoded) ? $decoded : [];
        } else {
            $decoded = [];
        }

        $axis = self::normalizeAxis((string) ($decoded['mm_axis'] ?? 'understand'));
        $out = self::defaultMeta($axis);
        foreach (['backend', 'protocol', 'python_module', 'mm_axis', 'default_task'] as $key) {
            if (isset($decoded[$key]) && \is_string($decoded[$key]) && trim($decoded[$key]) !== '') {
                $out[$key] = trim($decoded[$key]);
            }
        }
        require_once __DIR__ . '/MmPythonModuleRegister.php';
        $out['python_module'] = MmPythonModuleRegister::resolveModuleId((string) ($out['python_module'] ?? 'mm_lance'));
        $out['mm_axis'] = self::normalizeAxis((string) ($out['mm_axis'] ?? $axis));
        $backend = strtolower((string) ($out['backend'] ?? self::BACKEND_ENDPOINT));
        $out['backend'] = $backend === self::BACKEND_PYTHON_MODULE
            ? self::BACKEND_PYTHON_MODULE
            : self::BACKEND_ENDPOINT;

        return $out;
    }

    public static function isPythonModuleBackend(?array $meta): bool
    {
        if ($meta === null || $meta === []) {
            return false;
        }

        return strtolower((string) ($meta['backend'] ?? '')) === self::BACKEND_PYTHON_MODULE;
    }

    public static function defaultTaskForAxis(string $axis): string
    {
        return match (self::normalizeAxis($axis)) {
            'generate' => 't2i',
            'edit'     => 'image_edit',
            default    => 'x2t_image',
        };
    }

    /**
     * @param array<string, mixed>          $bind from {@see CanonicalEndpointsRepository::resolveMmUnderstandBinding()} etc.
     * @param callable(string): (string|null) $inferApiKeyEnv
     *
     * @return array<string, mixed>
     */
    public static function jobPayloadFromBinding(array $bind, callable $inferApiKeyEnv): array
    {
        $meta = \is_array($bind['purpose_meta'] ?? null) ? $bind['purpose_meta'] : [];
        $backend = strtolower((string) ($meta['backend'] ?? self::BACKEND_ENDPOINT));
        $axis = self::normalizeAxis((string) ($meta['mm_axis'] ?? 'understand'));
        $payload = [
            'purpose_key'   => (string) ($bind['purpose_key'] ?? ''),
            'backend'       => $backend === self::BACKEND_PYTHON_MODULE ? self::BACKEND_PYTHON_MODULE : self::BACKEND_ENDPOINT,
            'mm_axis'       => $axis,
            'protocol'      => (string) ($meta['protocol'] ?? 'openai_chat'),
            'python_module' => (string) ($meta['python_module'] ?? 'mm_lance'),
            'default_task'  => (string) ($meta['default_task'] ?? self::defaultTaskForAxis($axis)),
        ];

        if ($payload['backend'] === self::BACKEND_ENDPOINT) {
            $aref = trim((string) ($bind['api_key_ref'] ?? ''));
            $payload['base_url'] = (string) ($bind['base_url'] ?? '');
            $payload['model'] = (string) ($bind['model'] ?? '');
            $payload['api_key_env'] = $aref !== '' ? $inferApiKeyEnv($aref) : null;
        } else {
            require_once __DIR__ . '/MmPythonModuleRegister.php';
            $moduleId = MmPythonModuleRegister::resolveModuleId((string) $payload['python_module']);
            $payload['python_module'] = $moduleId;
            foreach (MmPythonModuleRegister::allSorted() as $row) {
                if (($row['module_id'] ?? '') === $moduleId) {
                    $env = trim((string) ($row['base_url_env'] ?? ''));
                    if ($env !== '') {
                        $payload['module_config'] = ['base_url_env' => $env];
                    }
                    break;
                }
            }
        }

        return $payload;
    }
}
