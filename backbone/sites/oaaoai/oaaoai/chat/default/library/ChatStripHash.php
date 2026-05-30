<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Signed strip action token — binds dismiss/confirm to conversation + message + action payload.
 *
 * @see docs/design/strip-chip-shell.md
 */
final class ChatStripHash
{
    private const int VERSION = 1;

    private const int DEFAULT_TTL_SEC = 604800;

    /**
     * @param array<string, mixed> $payload Opaque suggestion body (stored in meta_json)
     */
    public static function issue(
        int $userId,
        int $conversationId,
        int $messageId,
        string $actionId,
        array $payload,
        int $ttlSec = self::DEFAULT_TTL_SEC,
    ): string {
        $actionId = strtolower(trim($actionId));
        if ($userId < 1 || $conversationId < 1 || $messageId < 1 || $actionId === '') {
            throw new \InvalidArgumentException('strip_hash issue requires user, conversation, message, action_id');
        }

        $bodyPayload = [
            'v'               => self::VERSION,
            'user_id'         => $userId,
            'conversation_id' => $conversationId,
            'message_id'      => $messageId,
            'action_id'       => $actionId,
            'payload_digest'  => self::payloadDigest($payload),
            'exp'             => time() + max(300, $ttlSec),
        ];
        $json = json_encode($bodyPayload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $body = self::b64urlEncode($json);

        return 'v' . self::VERSION . '.' . $body . '.' . hash_hmac('sha256', $body, self::sharedSecret());
    }

    /**
     * @return array{
     *     user_id: int,
     *     conversation_id: int,
     *     message_id: int,
     *     action_id: string,
     *     payload_digest: string
     * }|null
     */
    public static function verify(string $token): ?array
    {
        $raw = trim($token);
        if ($raw === '' || ! str_starts_with($raw, 'v' . self::VERSION . '.')) {
            return null;
        }

        $rest = substr($raw, 3);
        $dot = strrpos($rest, '.');
        if ($dot === false || $dot < 1) {
            return null;
        }
        $body = substr($rest, 0, $dot);
        $sig = substr($rest, $dot + 1);
        $expect = hash_hmac('sha256', $body, self::sharedSecret());
        if (! hash_equals($expect, $sig)) {
            return null;
        }

        $json = self::b64urlDecode($body);
        if ($json === '') {
            return null;
        }

        try {
            /** @var mixed $payload */
            $payload = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        if (! \is_array($payload)) {
            return null;
        }

        $exp = (int) ($payload['exp'] ?? 0);
        if ($exp < time()) {
            return null;
        }

        $uid = (int) ($payload['user_id'] ?? 0);
        $cid = (int) ($payload['conversation_id'] ?? 0);
        $mid = (int) ($payload['message_id'] ?? 0);
        $actionId = strtolower(trim((string) ($payload['action_id'] ?? '')));
        $digest = trim((string) ($payload['payload_digest'] ?? ''));
        if ($uid < 1 || $cid < 1 || $mid < 1 || $actionId === '' || $digest === '') {
            return null;
        }

        return [
            'user_id'         => $uid,
            'conversation_id' => $cid,
            'message_id'      => $mid,
            'action_id'       => $actionId,
            'payload_digest'  => $digest,
        ];
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function payloadDigest(array $payload): string
    {
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        return 'sha256:' . hash('sha256', $json);
    }

    private static function sharedSecret(): string
    {
        $secret = getenv('OAAO_ORCH_SHARED_SECRET');

        return ($secret !== false && trim((string) $secret) !== '')
            ? trim((string) $secret)
            : throw new \RuntimeException('OAAO_ORCH_SHARED_SECRET is not set; refusing default secret.');
    }

    private static function b64urlEncode(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $seg): string
    {
        $pad = str_repeat('=', (4 - \strlen($seg) % 4) % 4);
        $bin = base64_decode(strtr($seg . $pad, '-_', '+/'), true);

        return \is_string($bin) ? $bin : '';
    }
}
