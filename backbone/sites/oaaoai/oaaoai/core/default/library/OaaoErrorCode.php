<?php

declare(strict_types=1);

namespace OAAOai\Core;

/**
 * W4-S2 — Structured error codes for the PHP backbone.
 *
 * Mirror of python/oaao_orchestrator/errors.py. Both files MUST stay in sync.
 * See docs/error-codes.md (to be added) for the canonical cross-language table.
 *
 * Adding a new code: append a class constant + entry in HTTP_STATUS. Retiring
 * or renaming a code is a breaking change for clients.
 *
 * Usage:
 *
 *     use OAAOai\Core\OaaoErrorCode;
 *
 *     return OaaoErrorCode::respond(
 *         $response,
 *         OaaoErrorCode::AUTH_INVALID,
 *         'token failed HMAC check'
 *     );
 *
 *     // Or to build the payload:
 *     $body = OaaoErrorCode::payload(OaaoErrorCode::INPUT_INVALID, 'missing user_message');
 */
final class OaaoErrorCode
{
    // ── Auth ────────────────────────────────────────────────────────────────
    public const AUTH_MISSING = 'OAAO_E_AUTH_MISSING';
    public const AUTH_INVALID = 'OAAO_E_AUTH_INVALID';
    public const AUTH_EXPIRED = 'OAAO_E_AUTH_EXPIRED';
    public const AUTH_FORBIDDEN = 'OAAO_E_AUTH_FORBIDDEN';

    // ── Input validation ────────────────────────────────────────────────────
    public const INPUT_MISSING = 'OAAO_E_INPUT_MISSING';
    public const INPUT_INVALID = 'OAAO_E_INPUT_INVALID';
    public const INPUT_TOO_LARGE = 'OAAO_E_INPUT_TOO_LARGE';

    // ── Resource ────────────────────────────────────────────────────────────
    public const RESOURCE_NOT_FOUND = 'OAAO_E_RESOURCE_NOT_FOUND';
    public const RESOURCE_CONFLICT = 'OAAO_E_RESOURCE_CONFLICT';
    public const RESOURCE_GONE = 'OAAO_E_RESOURCE_GONE';

    // ── Config / secrets ────────────────────────────────────────────────────
    public const SECRET_MISSING = 'OAAO_E_SECRET_MISSING';
    public const SECRET_PROVIDER = 'OAAO_E_SECRET_PROVIDER';
    public const CONFIG_INVALID = 'OAAO_E_CONFIG_INVALID';

    // ── Run / pipeline ──────────────────────────────────────────────────────
    public const RUN_FAILED = 'OAAO_E_RUN_FAILED';
    public const RUN_TIMEOUT = 'OAAO_E_RUN_TIMEOUT';
    public const RUN_CANCELLED = 'OAAO_E_RUN_CANCELLED';
    public const UPSTREAM_FAILED = 'OAAO_E_UPSTREAM_FAILED';
    public const UPSTREAM_TIMEOUT = 'OAAO_E_UPSTREAM_TIMEOUT';

    // ── Generic ─────────────────────────────────────────────────────────────
    public const INTERNAL = 'OAAO_E_INTERNAL';
    public const NOT_IMPLEMENTED = 'OAAO_E_NOT_IMPLEMENTED';

    /** @var array<string, int> */
    private const HTTP_STATUS = [
        self::AUTH_MISSING => 401,
        self::AUTH_INVALID => 401,
        self::AUTH_EXPIRED => 401,
        self::AUTH_FORBIDDEN => 403,
        self::INPUT_MISSING => 400,
        self::INPUT_INVALID => 400,
        self::INPUT_TOO_LARGE => 413,
        self::RESOURCE_NOT_FOUND => 404,
        self::RESOURCE_CONFLICT => 409,
        self::RESOURCE_GONE => 410,
        self::SECRET_MISSING => 500,
        self::SECRET_PROVIDER => 500,
        self::CONFIG_INVALID => 500,
        self::RUN_FAILED => 500,
        self::RUN_TIMEOUT => 504,
        self::RUN_CANCELLED => 499,
        self::UPSTREAM_FAILED => 502,
        self::UPSTREAM_TIMEOUT => 504,
        self::INTERNAL => 500,
        self::NOT_IMPLEMENTED => 501,
    ];

    public static function httpStatus(string $code): int
    {
        return self::HTTP_STATUS[$code] ?? 500;
    }

    /**
     * Build the canonical error payload. Stable shape across all endpoints.
     *
     * @return array{ok: false, error: array{code: string, detail?: string, cause?: string}}
     */
    public static function payload(string $code, string $detail = '', string $cause = ''): array
    {
        $error = ['code' => $code];
        if ($detail !== '') {
            $error['detail'] = $detail;
        }
        if ($cause !== '') {
            $error['cause'] = $cause;
        }

        return ['ok' => false, 'error' => $error];
    }
}
