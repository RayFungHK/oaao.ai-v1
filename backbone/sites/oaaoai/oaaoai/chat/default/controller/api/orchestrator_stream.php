<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/library/OrchestratorInternalUrl.php';

use oaaoai\chat\OrchestratorInternalUrl;

/**
 * GET /chat/api/orchestrator_stream — same-origin SSE proxy for HTTPS pages.
 *
 * Query: {@code run_id}, {@code token}, optional {@code since_seq} (forwards to orchestrator {@code /v1/stream}).
 */
return function (): void {
    $runId = isset($_GET['run_id']) ? trim((string) $_GET['run_id']) : '';
    $token = isset($_GET['token']) ? trim((string) $_GET['token']) : '';
    $sinceSeq = isset($_GET['since_seq']) ? max(0, (int) $_GET['since_seq']) : 0;

    if ($runId === '' || $token === '') {
        http_response_code(400);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'run_id and token required']);

        return;
    }

    $internal = OrchestratorInternalUrl::base();
    if ($internal === '') {
        http_response_code(503);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Orchestrator unavailable']);

        return;
    }

    $url = $internal . '/v1/stream?'
        . 'run_id=' . rawurlencode($runId)
        . '&token=' . rawurlencode($token)
        . '&since_seq=' . $sinceSeq;

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    header('Content-Type: text/event-stream; charset=UTF-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Connection: keep-alive');
    header('X-Accel-Buffering: no');

    if (\function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
    }
    @ini_set('zlib.output_compression', '0');
    @ini_set('output_buffering', 'off');
    @ini_set('implicit_flush', '1');

    if (\function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            http_response_code(502);

            return;
        }
        curl_setopt_array($ch, [
            \CURLOPT_HTTPGET        => true,
            \CURLOPT_HTTPHEADER     => ['Accept: text/event-stream'],
            \CURLOPT_RETURNTRANSFER => false,
            \CURLOPT_TIMEOUT        => 0,
            \CURLOPT_CONNECTTIMEOUT => 15,
            \CURLOPT_WRITEFUNCTION  => static function ($handle, string $chunk): int {
                echo $chunk;
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();

                return \strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        $code = (int) curl_getinfo($ch, \CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($ok === false && ! headers_sent() && http_response_code() === 200) {
            http_response_code($code >= 400 ? $code : 502);
        }

        return;
    }

    $ctx = stream_context_create([
        'http' => [
            'method'  => 'GET',
            'header'  => "Accept: text/event-stream\r\n",
            'timeout' => 86400,
        ],
    ]);
    $in = @fopen($url, 'r', false, $ctx);
    if ($in === false) {
        http_response_code(502);

        return;
    }
    while (! feof($in)) {
        $chunk = fread($in, 8192);
        if ($chunk === false || $chunk === '') {
            break;
        }
        echo $chunk;
        if (ob_get_level() > 0) {
            @ob_flush();
        }
        flush();
    }
    fclose($in);
};
