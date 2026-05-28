<?php

declare(strict_types=1);

use oaaoai\endpoints\CanonicalEndpointsRepository;
use oaaoai\endpoints\OpenAiCompatModelProbe;

require_once __DIR__ . '/../../library/CanonicalEndpointsRepository.php';
require_once __DIR__ . '/../../library/OpenAiCompatModelProbe.php';

/**
 * POST /endpoints/api/model_probe — admin-only; fetch OpenAI-compatible model limits.
 *
 * Body JSON: { base_url: string, model: string, api_key_ref?: string }
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $baseUrl = trim((string) ($input['base_url'] ?? ''));
    $model = trim((string) ($input['model'] ?? ''));
    $apiKeyRef = trim((string) ($input['api_key_ref'] ?? ''));

    if ($baseUrl === '' || $model === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'base_url and model are required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $bearer = null;
    if ($apiKeyRef !== '') {
        $chat = $this->api('chat');
        $envName = ($chat && method_exists($chat, 'inferOrchestratorApiKeyEnv'))
            ? $chat->inferOrchestratorApiKeyEnv($apiKeyRef)
            : null;
        if ($envName !== null && $envName !== '') {
            $fromEnv = getenv($envName);
            if (\is_string($fromEnv) && trim($fromEnv) !== '') {
                $bearer = trim($fromEnv);
            }
        }
    }

    $probe = OpenAiCompatModelProbe::probe($baseUrl, $model, $bearer);

    echo json_encode([
        'success' => $probe['success'],
        'message' => $probe['message'],
        'data'    => [
            'http_code'                   => $probe['http_code'],
            'model_id'                    => $probe['model_id'],
            'max_model_len'               => $probe['max_model_len'],
            'suggested_max_output_tokens' => $probe['suggested_max_output_tokens'],
            'config_json_patch'           => $probe['config_json_patch'],
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
