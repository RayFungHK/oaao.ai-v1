<?php

declare(strict_types=1);

use oaaoai\endpoints\AsrLivePurposeConfig;
use oaaoai\endpoints\CanonicalEndpointsRepository;

require_once __DIR__ . '/../../library/AsrLivePurposeConfig.php';
require_once __DIR__ . '/../../library/CanonicalEndpointsRepository.php';

/**
 * POST /endpoints/api/funasr_nano_ensure — admin-only; smoke test remote FunASR Nano ({@code GET /health}).
 *
 * Body JSON optional: { base_url?: string }.
 */
return function (): void {
    $db = $this->oaao_endpoints_require_admin();
    if (! $db) {
        return;
    }

    $input = json_decode((string) file_get_contents('php://input'), true);
    if (! \is_array($input)) {
        $input = [];
    }

    $baseUrl = '';
    if (isset($input['base_url']) && \is_string($input['base_url']) && trim($input['base_url']) !== '') {
        $baseUrl = rtrim(trim($input['base_url']), '/');
    } else {
        $repo = new CanonicalEndpointsRepository($db, $this->api('core'));
        $repo->ensureAsrLivePurposeRow();
        $liveBind = $repo->resolveLiveAsrBinding();
        $meta = \is_array($liveBind['purpose_meta'] ?? null) ? $liveBind['purpose_meta'] : [];
        $baseUrl = $liveBind !== null
            ? AsrLivePurposeConfig::funasrBaseUrlFromBinding($liveBind, $meta)
            : AsrLivePurposeConfig::DEFAULT_FUNASR_NANO_BASE;
    }

    if ($baseUrl === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'funasr_base_url required'], JSON_UNESCAPED_UNICODE);

        return;
    }

    $healthUrl = $baseUrl . '/health';
    $body = null;
    $httpCode = 0;
    $errMsg = '';

    if (\function_exists('curl_init')) {
        $ch = curl_init($healthUrl);
        if ($ch !== false) {
            curl_setopt_array($ch, [
                \CURLOPT_RETURNTRANSFER => true,
                \CURLOPT_TIMEOUT        => 20,
                \CURLOPT_HTTPHEADER     => ['Accept: application/json'],
            ]);
            $raw = curl_exec($ch);
            $httpCode = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
            if ($raw === false) {
                $errMsg = (string) curl_error($ch);
            } else {
                try {
                    /** @var array<string, mixed>|null $body */
                    $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
                } catch (\JsonException) {
                    $errMsg = 'invalid_json';
                }
            }
            curl_close($ch);
        }
    } else {
        $ctx = stream_context_create(['http' => ['timeout' => 20, 'header' => "Accept: application/json\r\n"]]);
        $raw = @file_get_contents($healthUrl, false, $ctx);
        if ($raw === false) {
            $errMsg = 'fetch_failed';
        } else {
            $httpCode = 200;
            try {
                $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                $errMsg = 'invalid_json';
            }
        }
    }

    $ok = $httpCode >= 200 && $httpCode < 300 && \is_array($body) && ! empty($body['ok']);
    $model = \is_array($body) ? (string) ($body['model'] ?? '') : '';

    $transcribeSmoke = null;
    if ($ok) {
        $sr = 16000;
        $sampleCount = (int) ($sr * 0.25);
        $pcm = str_repeat("\0\0", $sampleCount);
        $dataLen = \strlen($pcm);
        $header = pack(
            'a4Va4a4VvvVVvv',
            'RIFF',
            36 + $dataLen,
            'WAVE',
            'fmt ',
            16,
            1,
            1,
            $sr,
            $sr * 2,
            2,
            16,
        ) . 'data' . pack('V', $dataLen);
        $wav = $header . $pcm;
        $payload = json_encode([
            'input'    => base64_encode($wav),
            'language' => '中文',
            'itn'      => true,
        ], JSON_THROW_ON_ERROR);
        $transcribeUrl = $baseUrl . '/transcribe';
        if (\function_exists('curl_init')) {
            $ch = curl_init($transcribeUrl);
            if ($ch !== false) {
                curl_setopt_array($ch, [
                    \CURLOPT_POST           => true,
                    \CURLOPT_RETURNTRANSFER => true,
                    \CURLOPT_TIMEOUT        => 90,
                    \CURLOPT_HTTPHEADER     => ['Accept: application/json', 'Content-Type: application/json'],
                    \CURLOPT_POSTFIELDS     => $payload,
                ]);
                $tRaw = curl_exec($ch);
                $tCode = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
                curl_close($ch);
                $tBody = null;
                if (\is_string($tRaw) && $tRaw !== '') {
                    try {
                        $tBody = json_decode($tRaw, true, 512, JSON_THROW_ON_ERROR);
                    } catch (\JsonException) {
                        $tBody = ['raw' => \substr($tRaw, 0, 300)];
                    }
                }
                $transcribeSmoke = [
                    'http_code' => $tCode,
                    'body'      => $tBody,
                    'ok'        => $tCode >= 200 && $tCode < 300,
                ];
                if (! $transcribeSmoke['ok']) {
                    $ok = false;
                }
            }
        }
    }

    echo json_encode([
        'success'  => true,
        'ready'    => $ok,
        'base_url' => $baseUrl,
        'message'  => $ok
            ? ('FunASR Nano ready' . ($model !== '' ? " ({$model})" : '') . ($transcribeSmoke !== null ? ' — /transcribe OK' : ''))
            : ($errMsg !== '' ? $errMsg : ($transcribeSmoke !== null && ($transcribeSmoke['http_code'] ?? 0) >= 400
                ? 'Transcribe smoke failed (HTTP ' . (int) ($transcribeSmoke['http_code'] ?? 0) . ')'
                : "HTTP {$httpCode}")),
        'data'     => [
            'health' => [
                'http_code' => $httpCode,
                'body'      => $body,
            ],
            'transcribe_smoke' => $transcribeSmoke,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
};
