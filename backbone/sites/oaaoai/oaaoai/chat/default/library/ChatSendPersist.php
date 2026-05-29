<?php

declare(strict_types=1);

/**
 * Adjunct SQLite TX boundary for chat send — body remains in {@see send.php} until extracted.
 *
 * {@code chat.send.persist} fires at {@code beginTransaction()} so modules can hook pre-persist work.
 */
final class ChatSendPersist
{
}
