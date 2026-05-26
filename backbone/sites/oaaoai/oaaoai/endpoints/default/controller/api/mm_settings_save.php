<?php

declare(strict_types=1);

use oaaoai\endpoints\MmModuleSettings;
use oaaoai\endpoints\MmPythonModuleRegister;

/**
 * POST /endpoints/api/mm_settings_save — persist {@code mm_modules.json}.
 */
return function (): void {
    if (! $this->oaao_endpoints_require_admin()) {
        return;
    }

    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $epApi = $this->api('endpoints');
    if ($epApi) {
        $epApi->ensureFeatureRegistries();
    }

    $moduleId = MmPythonModuleRegister::resolveModuleId((string) ($input['python_module'] ?? 'mm_lance'));
    $axesIn = $input['axes'] ?? [];
    if (! \is_array($axesIn)) {
        $axesIn = [];
    }

    $cfg = [
        'python_module' => $moduleId,
        'axes'          => $axesIn,
    ];

    $moduleConfigIn = $input['module_config'] ?? null;
    if (\is_array($moduleConfigIn)) {
        $cfg['module_config'] = $moduleConfigIn;
    }

    if (! MmModuleSettings::save($cfg)) {
        http_response_code(400);
        echo json_encode(
            [
                'success' => false,
                'message' => 'Invalid module config or could not write mm_modules.json — check base_url (http/https) and backbone/config/oaaoai permissions.',
            ],
            JSON_UNESCAPED_UNICODE
        );

        return;
    }

    echo json_encode(
        [
            'success' => true,
            'data'    => MmModuleSettings::load(),
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
};
