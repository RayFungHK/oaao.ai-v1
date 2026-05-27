<?php

declare(strict_types=1);

namespace oaaoai\endpoints;

/**
 * Multimodal runtime config — Python module per axis, no Purpose allocation row required.
 *
 * Persisted at {@code backbone/config/oaaoai/mm_modules.json} (same pattern as {@see ToolServerStorage}).
 * v1: one {@code python_module} for all axes; per-axis tasks resolved at runtime by the orchestrator.
 */
final class MmModuleSettings
{
    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            'python_module' => 'mm_lance',
            'module_config' => [],
            'axes'          => [
                'understand' => ['default_task' => 'x2t_image'],
                'generate'   => ['default_task' => 't2i'],
                'edit'       => ['default_task' => 'image_edit'],
            ],
        ];
    }

    public static function configPath(): string
    {
        $env = getenv('OAAO_MM_MODULES_PATH');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        $backbone = dirname(__DIR__, 6);

        return $backbone . '/config/oaaoai/mm_modules.json';
    }

    /** @return array<string, mixed> */
    public static function load(): array
    {
        $out = self::defaults();
        $path = self::configPath();
        if (! is_readable($path)) {
            return $out;
        }
        $raw = file_get_contents($path);
        if ($raw === false || trim($raw) === '') {
            return $out;
        }
        $data = json_decode($raw, true);
        if (! \is_array($data)) {
            return $out;
        }

        if (isset($data['python_module']) && is_string($data['python_module']) && trim($data['python_module']) !== '') {
            $out['python_module'] = MmPythonModuleRegister::resolveModuleId(trim($data['python_module']));
        }

        if (isset($data['module_config']) && \is_array($data['module_config'])) {
            $bu = trim((string) ($data['module_config']['base_url'] ?? ''));
            if ($bu !== '') {
                $out['module_config']['base_url'] = rtrim($bu, '/');
            }
        }

        if (isset($data['axes']) && \is_array($data['axes'])) {
            foreach (['understand', 'generate', 'edit'] as $axis) {
                $row = $data['axes'][$axis] ?? null;
                if (! \is_array($row)) {
                    continue;
                }
                $task = trim((string) ($row['default_task'] ?? ''));
                if ($task !== '') {
                    $out['axes'][$axis]['default_task'] = $task;
                }
            }
        }

        if (isset($data['credit_factors']) && \is_array($data['credit_factors'])) {
            $out['credit_factors'] = CreditFactorsCatalog::normalizeMmCreditFactors($data['credit_factors']);
        } else {
            $out['credit_factors'] = CreditFactorsCatalog::defaultMmCreditFactors();
        }

        return $out;
    }

    /**
     * @param array<string, mixed> $config
     */
    public static function save(array $config): bool
    {
        $moduleId = MmPythonModuleRegister::resolveModuleId((string) ($config['python_module'] ?? 'mm_lance'));
        $axes = self::defaults()['axes'];
        $rawAxes = $config['axes'] ?? [];
        if (\is_array($rawAxes)) {
            foreach (['understand', 'generate', 'edit'] as $axis) {
                $row = $rawAxes[$axis] ?? null;
                if (! \is_array($row)) {
                    continue;
                }
                $task = trim((string) ($row['default_task'] ?? ''));
                if ($task !== '') {
                    $axes[$axis]['default_task'] = $task;
                }
            }
        }

        $moduleConfig = [];
        $rawModuleConfig = $config['module_config'] ?? null;
        if (\is_array($rawModuleConfig)) {
            $bu = trim((string) ($rawModuleConfig['base_url'] ?? ''));
            if ($bu !== '') {
                if (! preg_match('#^https?://#i', $bu)) {
                    return false;
                }
                $moduleConfig['base_url'] = rtrim($bu, '/');
            }
        }

        $creditFactors = CreditFactorsCatalog::defaultMmCreditFactors();
        $rawCredit = $config['credit_factors'] ?? null;
        if (\is_array($rawCredit)) {
            $creditFactors = CreditFactorsCatalog::normalizeMmCreditFactors($rawCredit);
        }

        $payload = json_encode(
            [
                'python_module'  => $moduleId,
                'module_config'  => $moduleConfig,
                'axes'           => $axes,
                'credit_factors' => $creditFactors,
            ],
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE
        );
        if ($payload === false) {
            return false;
        }

        $path = self::configPath();
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return false;
        }

        return file_put_contents($path, $payload . "\n", LOCK_EX) !== false;
    }

    /**
     * Orchestrator {@code mm_understand|mm_generate|mm_edit} payload — always python_module backend.
     *
     * @return array<string, mixed>
     */
    public static function orchestratorPayloadForAxis(string $axis): array
    {
        require_once __DIR__ . '/MmPurposeConfig.php';
        require_once __DIR__ . '/MmPythonModuleRegister.php';

        $axis = MmPurposeConfig::normalizeAxis($axis);
        $cfg = self::load();
        $moduleId = MmPythonModuleRegister::resolveModuleId((string) ($cfg['python_module'] ?? 'mm_lance'));
        $axisCfg = \is_array($cfg['axes'][$axis] ?? null) ? $cfg['axes'][$axis] : [];
        $defaultTask = trim((string) ($axisCfg['default_task'] ?? ''));
        if ($defaultTask === '') {
            $defaultTask = MmPurposeConfig::defaultTaskForAxis($axis);
        }

        $payload = [
            'purpose_key'   => 'mm.module.' . $axis,
            'backend'       => MmPurposeConfig::BACKEND_PYTHON_MODULE,
            'mm_axis'       => $axis,
            'protocol'      => 'openai_chat',
            'python_module' => $moduleId,
            'default_task'  => $defaultTask,
        ];

        $moduleConfig = [];
        $persisted = $cfg['module_config'] ?? null;
        if (\is_array($persisted)) {
            $bu = trim((string) ($persisted['base_url'] ?? ''));
            if ($bu !== '') {
                $moduleConfig['base_url'] = rtrim($bu, '/');
            }
        }

        foreach (MmPythonModuleRegister::allSorted() as $row) {
            if (($row['module_id'] ?? '') !== $moduleId) {
                continue;
            }
            $env = trim((string) ($row['base_url_env'] ?? ''));
            if ($env !== '') {
                $moduleConfig['base_url_env'] = $env;
            }
            break;
        }

        if ($moduleConfig !== []) {
            $payload['module_config'] = $moduleConfig;
        }

        return $payload;
    }
}
