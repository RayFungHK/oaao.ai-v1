<?php

declare(strict_types=1);

namespace oaaoai\library;

/**
 * CS-2-S9 — copy library markdown into vault via internal document_upload_text.
 */
final class LibraryVaultFinalize
{
    public static function vaultUploadTextUrl(): string
    {
        $vaultJobBase = getenv('OAAO_VAULT_JOB_POLL_BASE_URL');
        if (! \is_string($vaultJobBase) || trim($vaultJobBase) === '') {
            $vaultJobBase = (getenv('OAAO_DOCKER') === '1' || @is_readable('/.dockerenv'))
                ? 'http://web/vault/api'
                : 'http://127.0.0.1/vault/api';
        }

        return rtrim(trim((string) $vaultJobBase), '/') . '/document_upload_text';
    }

    public static function sharedSecret(): string
    {
        $env = getenv('OAAO_ORCH_SHARED_SECRET');
        if ($env !== false && trim((string) $env) !== '') {
            return trim((string) $env);
        }

        throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    }

    /**
     * @return array{success: bool, document_id?: int, job_ids?: list<array<string, mixed>>, message?: string, http?: int}
     */
    public static function uploadMarkdown(
        int $uid,
        int $vaultId,
        ?int $containerId,
        ?int $workspaceId,
        string $filename,
        string $content,
        string $source = 'library',
    ): array {
        if ($uid < 1 || $vaultId < 1 || trim($content) === '') {
            return ['success' => false, 'message' => 'Invalid upload parameters'];
        }

        $payload = [
            'user_id'   => $uid,
            'vault_id'  => $vaultId,
            'filename'  => $filename,
            'content'   => $content,
            'mime_type' => 'text/markdown',
            'source'    => $source !== '' ? $source : 'library',
        ];
        if ($containerId !== null && $containerId > 0) {
            $payload['container_id'] = $containerId;
        }
        if ($workspaceId !== null && $workspaceId > 0) {
            $payload['workspace_id'] = $workspaceId;
        }

        $ch = curl_init(self::vaultUploadTextUrl());
        if ($ch === false) {
            return ['success' => false, 'message' => 'Upload request failed'];
        }

        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-OAAO-Internal-Token: ' . self::sharedSecret(),
                'Accept: application/json',
            ],
            CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 120,
        ]);
        $raw = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (! \is_string($raw) || $raw === '' || $code >= 400) {
            return [
                'success' => false,
                'message' => 'Vault upload failed',
                'http'    => $code,
            ];
        }

        try {
            /** @var array<string, mixed> $resp */
            $resp = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return ['success' => false, 'message' => 'Invalid vault response'];
        }

        if (($resp['success'] ?? false) !== true) {
            return [
                'success' => false,
                'message' => (string) ($resp['message'] ?? 'Vault upload rejected'),
                'http'    => $code,
            ];
        }

        $docId = isset($resp['document_id']) ? (int) $resp['document_id'] : 0;
        /** @var list<array<string, mixed>> $jobIds */
        $jobIds = \is_array($resp['job_ids'] ?? null) ? $resp['job_ids'] : [];

        return [
            'success'     => true,
            'document_id' => $docId,
            'job_ids'     => $jobIds,
        ];
    }
}
