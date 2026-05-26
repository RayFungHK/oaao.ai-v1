<?php

declare(strict_types=1);

namespace oaaoai\vault;

/**
 * W6-S1 phase 1 — storage / response-streaming helpers extracted from
 * vault.php controller.
 *
 * Pure side-effecting utilities (filesystem read/delete, HTTP header + body
 * emission). No database, no controller state, no Razy framework binding —
 * which is exactly why this is a safe first extraction target.
 *
 * Phase 2 will extract the job-lifecycle cluster (insert / find / cancel
 * helpers around lines 381-492 of the original controller).
 */
final class VaultStorageUtil
{
    /**
     * Safely delete a vault-relative file under {@code $storageRoot}.
     *
     * Rejects empty paths, paths containing {@code ..} traversal, and
     * embedded NUL bytes. Missing files are silently ignored — callers may
     * invoke this best-effort during cancel / rollback flows.
     */
    public static function unlinkStorageFile(string $storageRoot, ?string $relativePath): void
    {
        if ($relativePath === null || $relativePath === '') {
            return;
        }
        $rel = str_replace(["\0"], '', $relativePath);
        $rel = ltrim($rel, '/');
        if ($rel === '' || str_contains($rel, '..')) {
            return;
        }
        $abs = rtrim($storageRoot, '/') . '/' . $rel;
        if (is_file($abs)) {
            @unlink($abs);
        }
    }

    /**
     * Stream a vault binary with optional HTTP Range support (audio seek in
     * transcript UI). Writes response headers + body directly; caller must
     * have already authorized access.
     */
    public static function streamBinaryFile(string $absPath, string $mimeType, string $downloadName, int $size): void
    {
        if ($size < 1) {
            $probe = filesize($absPath);
            $size = $probe !== false ? (int) $probe : 0;
        }

        $safeName = preg_replace('/[^\w.\-]+/u', '_', $downloadName) ?: 'audio';
        header('Content-Type: ' . ($mimeType !== '' ? $mimeType : 'application/octet-stream'));
        header('Accept-Ranges: bytes');
        header('Cache-Control: private, max-age=3600');
        header('Content-Disposition: inline; filename="' . str_replace('"', '', $safeName) . '"');

        $rangeHdr = $_SERVER['HTTP_RANGE'] ?? '';
        if (\is_string($rangeHdr) && preg_match('/bytes=(\d*)-(\d*)/', $rangeHdr, $m) === 1 && $size > 0) {
            $start = $m[1] !== '' ? (int) $m[1] : 0;
            $end = $m[2] !== '' ? (int) $m[2] : ($size - 1);
            if ($start > $end || $start >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */{$size}");

                return;
            }
            $end = min($end, $size - 1);
            $length = $end - $start + 1;

            http_response_code(206);
            header("Content-Range: bytes {$start}-{$end}/{$size}");
            header('Content-Length: ' . (string) $length);

            $fh = fopen($absPath, 'rb');
            if ($fh === false) {
                http_response_code(500);

                return;
            }
            fseek($fh, $start);
            $remaining = $length;
            while ($remaining > 0 && ! feof($fh)) {
                $chunk = fread($fh, min(8192, $remaining));
                if ($chunk === false) {
                    break;
                }
                echo $chunk;
                $remaining -= \strlen($chunk);
            }
            fclose($fh);

            return;
        }

        header('Content-Length: ' . (string) $size);
        readfile($absPath);
    }
}
