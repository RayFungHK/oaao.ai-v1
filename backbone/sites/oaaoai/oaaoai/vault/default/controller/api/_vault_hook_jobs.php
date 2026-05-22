<?php

declare(strict_types=1);

/**
 * Known audio extensions → canonical MIME (finfo often returns {@code application/octet-stream} for mp3).
 *
 * @return array<string, string>
 */
function oaao_vault_audio_extension_map(): array
{
    return [
        'mp3'  => 'audio/mpeg',
        'm4a'  => 'audio/mp4',
        'wav'  => 'audio/wav',
        'ogg'  => 'audio/ogg',
        'webm' => 'audio/webm',
        'flac' => 'audio/flac',
        'aac'  => 'audio/aac',
        'opus' => 'audio/opus',
    ];
}

/**
 * Normalize generic MIME using filename extension (audio uploads).
 */
function oaao_vault_normalize_upload_mime(string $mimeType, ?string $originalName = null): string
{
    $mimeType = strtolower(trim($mimeType));
    if ($mimeType !== '' && str_starts_with($mimeType, 'audio/')) {
        return $mimeType;
    }

    $ext = '';
    if ($originalName !== null && $originalName !== '') {
        $ext = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
    }

    $map = oaao_vault_audio_extension_map();
    if ($ext !== '' && isset($map[$ext])) {
        return $map[$ext];
    }

    return $mimeType !== '' ? $mimeType : 'application/octet-stream';
}

function oaao_vault_is_audio_upload(string $mimeType, ?string $originalName = null): bool
{
    $mimeType = strtolower(trim($mimeType));
    if ($mimeType !== '' && str_starts_with($mimeType, 'audio/')) {
        return true;
    }

    $ext = '';
    if ($originalName !== null && $originalName !== '') {
        $ext = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
    }

    return $ext !== '' && isset(oaao_vault_audio_extension_map()[$ext]);
}

/**
 * Infer which {@code vault_document_hook} ids to enqueue after upload (parity with {@code oaaoai/rag} registry).
 *
 * @param string      $mimeType MIME from finfo (may be generic {@code application/zip} for OOXML)
 * @param string|null $originalName original uploaded filename — used to disambiguate zip / octet-stream
 *
 * @return list<string>
 */
function oaao_vault_infer_job_hook_ids(string $mimeType, ?string $originalName = null): array
{
    $mimeType = strtolower(trim($mimeType));
    $out = [];
    if (oaao_vault_is_audio_upload($mimeType, $originalName)) {
        $out[] = 'vh.rag.audio_asr';
    }

    $ext = '';
    if ($originalName !== null && $originalName !== '') {
        $ext = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
    }

    $officeOoXml = str_contains($mimeType, 'wordprocessingml.document')
        || str_contains($mimeType, 'spreadsheetml.sheet')
        || str_contains($mimeType, 'presentationml.presentation');

    $looksLikeZipPackedOffice = ($mimeType === 'application/zip')
        && \in_array($ext, ['docx', 'xlsx', 'pptx'], true);

    $plainExtDocs = ['docx', 'xlsx', 'pptx', 'pdf', 'md', 'markdown', 'txt', 'csv', 'json', 'log'];

    $embedByLooseMime = ($mimeType === 'application/octet-stream'
        || $mimeType === 'application/x-empty'
        || $mimeType === 'binary/octet-stream')
        && \in_array($ext, $plainExtDocs, true);

    $shouldEmbed = $mimeType !== ''
        && (
            str_starts_with($mimeType, 'text/')
            || $mimeType === 'application/pdf'
            || str_ends_with($mimeType, '+json')
            || $mimeType === 'application/json'
            || $officeOoXml
            || $looksLikeZipPackedOffice
            || $embedByLooseMime
        );

    if ($shouldEmbed) {
        $out[] = 'vh.rag.document_embed';
    }

    return array_values(array_unique($out));
}
