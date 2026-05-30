<?php

declare(strict_types=1);

/** Best-effort extension module DDL ({@see auth} {@code ensurePgExtensionSchemas}). */
return function (\PDO $pdo): void {
    try {
        $this->ensureResearchSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureMineSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureUserInvitationSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureCorpusSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureLibrarySchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureReleasePostSchema($pdo);
        require_once dirname(__DIR__, 4) . '/core/default/library/ReleasePostFirstNewsSeed.php';
        \Oaaoai\Core\ReleasePostFirstNewsSeed::ensureOnce($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureCalendarSchema($pdo);
    } catch (\Throwable) {
    }

    try {
        $this->ensureTodoSchema($pdo);
    } catch (\Throwable) {
    }
};
