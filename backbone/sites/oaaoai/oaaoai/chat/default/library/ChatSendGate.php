<?php

declare(strict_types=1);

namespace oaaoai\chat;

/**
 * Pre-send gates — credits and workspace scope ({@code chat.send.gate}).
 */
final class ChatSendGate
{
    public static function creditBlockedReason(?\PDO $canonPdo, int $tenantId, int $uid, ?object $coreApi): ?string
    {
        if (! $canonPdo instanceof \PDO) {
            return null;
        }
        if ($tenantId < 1 && $coreApi !== null && method_exists($coreApi, 'bootstrapTenantContext')) {
            $tenantId = (int) $coreApi->bootstrapTenantContext($canonPdo);
        }
        require_once dirname(__DIR__, 3) . '/core/default/library/CreditLedgerRepository.php';

        return \Oaaoai\Core\CreditLedgerRepository::sendBlockedReason($canonPdo, $tenantId, $uid);
    }

    /**
     * @return array{httpStatus: int, payload: array<string, mixed>}|null
     */
    public static function workspaceDenial(int $uid, ?int $workspaceId, ?object $authApi): ?array
    {
        if ($workspaceId === null) {
            return null;
        }
        if ($uid < 1) {
            return [
                'httpStatus' => 401,
                'payload'    => ['success' => false, 'message' => 'Invalid session'],
            ];
        }
        if ($authApi === null) {
            return [
                'httpStatus' => 503,
                'payload'    => ['success' => false, 'message' => 'Authentication unavailable'],
            ];
        }

        try {
            $db = $authApi->getDB();
        } catch (\Throwable) {
            $db = null;
        }
        if (! $db instanceof \Razy\Database) {
            return [
                'httpStatus' => 503,
                'payload'    => ['success' => false, 'message' => 'Database unavailable'],
            ];
        }

        try {
            $authApi->ensurePgCoreTables($db);
        } catch (\Throwable) {
            /* optional when auth API unavailable */
        }

        try {
            if (! $authApi->databaseIsPgsql($db)) {
                return [
                    'httpStatus' => 503,
                    'payload'    => [
                        'success' => false,
                        'message' => 'Team workspaces require PostgreSQL as the canonical database.',
                    ],
                ];
            }
        } catch (\Throwable) {
            /* fall through — membership check below */
        }
        $pdo = $db->getDBAdapter();
        if (! $pdo instanceof \PDO) {
            return [
                'httpStatus' => 503,
                'payload'    => ['success' => false, 'message' => 'Database unavailable'],
            ];
        }
        try {
            $authApi->ensurePgWorkspaceTables($pdo);
        } catch (\Throwable) {
            /* optional when auth API unavailable */
        }
        require_once dirname(__DIR__, 2) . '/controller/api/_workspace_membership.php';
        if (! \oaao_chat_user_has_workspace_access($db, $uid, $workspaceId)) {
            return [
                'httpStatus' => 403,
                'payload'    => [
                    'success' => false,
                    'message' => 'You do not have access to this workspace.',
                ],
            ];
        }

        return null;
    }
}
