<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Signed run principal for Python orchestrator — same secret as {@see OrchestratorSidecarClient}.
 *
 * PHP issues at {@code send.php}; Python validates once per run (no PHP session cookie in sidecar).
 */
final class ChatRunPrincipal
{
    private const int VERSION = 1;

    public static function issue(
        int $userId,
        int $conversationId,
        int $assistantMessageId,
        ?int $workspaceId = null,
        ?int $tenantId = null,
        int $ttlSec = 7200,
    ): string {
        $secret = self::sharedSecret();
        $payload = [
            'v'                    => self::VERSION,
            'user_id'              => $userId,
            'conversation_id'      => $conversationId,
            'assistant_message_id' => $assistantMessageId,
            'exp'                  => time() + max(60, $ttlSec),
        ];
        if ($workspaceId !== null && $workspaceId > 0) {
            $payload['workspace_id'] = $workspaceId;
        }
        if ($tenantId !== null && $tenantId > 0) {
            $payload['tenant_id'] = $tenantId;
        }
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $body = self::b64urlEncode($json);

        return $body . '.' . hash_hmac('sha256', $body, $secret);
    }

    /**
     * @return array{user_id: int, conversation_id: int, assistant_message_id: int, workspace_id?: int, tenant_id?: int}|null
     */
    public static function verify(string $token): ?array
    {
        $raw = trim($token);
        $dot = strrpos($raw, '.');
        if ($dot === false || $dot < 1) {
            return null;
        }
        $body = substr($raw, 0, $dot);
        $sig = substr($raw, $dot + 1);
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
        $amid = (int) ($payload['assistant_message_id'] ?? 0);
        if ($uid < 1 || $cid < 1 || $amid < 1) {
            return null;
        }
        $out = [
            'user_id'              => $uid,
            'conversation_id'      => $cid,
            'assistant_message_id' => $amid,
        ];
        $wid = (int) ($payload['workspace_id'] ?? 0);
        if ($wid > 0) {
            $out['workspace_id'] = $wid;
        }
        $tid = (int) ($payload['tenant_id'] ?? 0);
        if ($tid > 0) {
            $out['tenant_id'] = $tid;
        }

        return $out;
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
