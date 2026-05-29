<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * UX-1-S11 — POST orchestrator feedback judge (short timeout, best-effort).
 */
final class FeedbackJudgeClient
{
    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>|null
     */
    public static function judge(array $payload): ?array
    {
        $base = OrchestratorInternalUrl::base();
        if ($base === '') {
            return null;
        }

        $url = $base . '/v1/personalization/feedback_judge';
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
        if ($body === false) {
            return null;
        }

        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
        ];
        $secret = OrchestratorInternalUrl::sharedSecret();
        if ($secret !== null) {
            $headers[] = 'X-OAAO-Internal-Token: ' . $secret;
        }

        $ctx = stream_context_create([
            'http' => [
                'method'        => 'POST',
                'header'        => implode("\r\n", $headers),
                'content'       => $body,
                'timeout'       => 8,
                'ignore_errors' => true,
            ],
        ]);

        $raw = @file_get_contents($url, false, $ctx);
        if (! \is_string($raw) || $raw === '') {
            return null;
        }

        try {
            $decoded = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        return \is_array($decoded) ? $decoded : null;
    }
}
