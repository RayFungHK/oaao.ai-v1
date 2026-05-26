<?php

declare(strict_types=1);

use oaaoai\endpoints\MmModuleSettings;

/**
 * GET /endpoints/api/mm_settings — multimodal Python module config (no Purpose allocation).
 */
return function (): void {
    if (! $this->oaao_endpoints_require_admin()) {
        return;
    }

    $epApi = $this->api('endpoints');
    if ($epApi) {
        $epApi->ensureFeatureRegistries();
    }

    echo json_encode(
        [
            'success'             => true,
            'data'                => MmModuleSettings::load(),
            'mm_python_modules'   => $epApi ? $epApi->getMmPythonModuleRegistry() : [],
            'media_capabilities'  => $epApi ? $epApi->getMediaCapabilityRegistry() : [],
            'config_path'         => MmModuleSettings::configPath(),
            'env_hints'           => [
                'OAAO_LANCE_BASE_URL' => trim((string) (getenv('OAAO_LANCE_BASE_URL') ?: '')),
            ],
        ],
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
};
