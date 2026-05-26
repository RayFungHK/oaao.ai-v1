<?php

declare(strict_types=1);

namespace oaaoai\mine;

/**
 * Read-only SQLite access for mined rows (orchestrator writes).
 */
final class MineStorage
{
    public static function absPath(string $relativePath): string
    {
        $rel = ltrim(str_replace('\\', '/', $relativePath), '/');
        if ($rel === '' || str_contains($rel, '..')) {
            return '';
        }

        return oaao_mine_data_root() . '/' . $rel;
    }

    public static function sanitizeTableName(string $name): string
    {
        $clean = preg_replace('/[^a-zA-Z0-9_]/', '_', $name) ?? 'data';

        return $clean !== '' ? $clean : 'data';
    }

    /**
     * @return list<string>
     */
    public static function listTables(string $relativePath): array
    {
        $pdo = self::openReadOnly($relativePath);
        if ($pdo === null) {
            return [];
        }
        $rows = $pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
        if ($rows === false) {
            return [];
        }
        /** @var list<string> $out */
        $out = [];
        while (($row = $rows->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $n = isset($row['name']) ? (string) $row['name'] : '';
            if ($n !== '') {
                $out[] = $n;
            }
        }

        return $out;
    }

    /**
     * @return array{rows: list<array<string, mixed>>, total: int, columns: list<string>}|null
     */
    public static function fetchRows(
        string $relativePath,
        string $table,
        int $page,
        int $pageSize,
        ?int $runId = null,
        ?string $sortColumn = null,
        string $sortDirection = 'asc',
    ): ?array {
        $pdo = self::openReadOnly($relativePath);
        if ($pdo === null) {
            return null;
        }

        $table = self::sanitizeTableName($table);
        $exists = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=" . $pdo->quote($table));
        if ($exists === false || $exists->fetchColumn() === false) {
            return ['rows' => [], 'total' => 0, 'columns' => []];
        }

        $pragma = $pdo->query('PRAGMA table_info(' . self::quoteIdent($table) . ')');
        /** @var list<string> $columns */
        $columns = [];
        if ($pragma !== false) {
            while (($col = $pragma->fetch(\PDO::FETCH_ASSOC)) !== false) {
                if (\is_array($col) && isset($col['name'])) {
                    $columns[] = (string) $col['name'];
                }
            }
        }

        $where = '';
        $params = [];
        if ($runId !== null && $runId > 0 && \in_array('_run_id', $columns, true)) {
            $where = ' WHERE _run_id = ?';
            $params[] = $runId;
        }

        $countSql = 'SELECT COUNT(*) FROM ' . self::quoteIdent($table) . $where;
        $stCount = $pdo->prepare($countSql);
        $stCount->execute($params);
        $total = (int) $stCount->fetchColumn();

        $order = '';
        if ($sortColumn !== null && $sortColumn !== '' && \in_array($sortColumn, $columns, true)) {
            $dir = strtolower($sortDirection) === 'desc' ? 'DESC' : 'ASC';
            $order = ' ORDER BY ' . self::quoteIdent($sortColumn) . ' ' . $dir;
        } else {
            $order = ' ORDER BY _mine_row_id DESC';
        }

        $page = max(1, $page);
        $pageSize = max(1, min(200, $pageSize));
        $offset = ($page - 1) * $pageSize;

        $sql = 'SELECT * FROM ' . self::quoteIdent($table) . $where . $order . ' LIMIT ? OFFSET ?';
        $params[] = $pageSize;
        $params[] = $offset;
        $st = $pdo->prepare($sql);
        $st->execute($params);
        /** @var list<array<string, mixed>> $rows */
        $rows = $st->fetchAll(\PDO::FETCH_ASSOC) ?: [];

        return ['rows' => $rows, 'total' => $total, 'columns' => $columns];
    }

    /**
     * Export rows as CSV (cap at $maxRows).
     *
     * @return array{csv: string, row_count: int, truncated: bool}|null
     */
    public static function exportCsv(
        string $relativePath,
        string $table,
        ?int $runId = null,
        int $maxRows = 50000,
    ): ?array {
        $pdo = self::openReadOnly($relativePath);
        if ($pdo === null) {
            return null;
        }

        $table = self::sanitizeTableName($table);
        $exists = $pdo->query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=" . $pdo->quote($table));
        if ($exists === false || $exists->fetchColumn() === false) {
            return ['csv' => '', 'row_count' => 0, 'truncated' => false];
        }

        $pragma = $pdo->query('PRAGMA table_info(' . self::quoteIdent($table) . ')');
        /** @var list<string> $columns */
        $columns = [];
        if ($pragma !== false) {
            while (($col = $pragma->fetch(\PDO::FETCH_ASSOC)) !== false) {
                if (\is_array($col) && isset($col['name'])) {
                    $name = (string) $col['name'];
                    if (! str_starts_with($name, '_')) {
                        $columns[] = $name;
                    }
                }
            }
        }
        if ($columns === []) {
            return ['csv' => '', 'row_count' => 0, 'truncated' => false];
        }

        $where = '';
        $params = [];
        if ($runId !== null && $runId > 0) {
            $where = ' WHERE _run_id = ?';
            $params[] = $runId;
        }

        $maxRows = max(1, min(50000, $maxRows));
        $countSql = 'SELECT COUNT(*) FROM ' . self::quoteIdent($table) . $where;
        $stCount = $pdo->prepare($countSql);
        $stCount->execute($params);
        $total = (int) $stCount->fetchColumn();

        $sql = 'SELECT ' . implode(', ', array_map([self::class, 'quoteIdent'], $columns))
            . ' FROM ' . self::quoteIdent($table) . $where
            . ' ORDER BY _mine_row_id ASC LIMIT ?';
        $params[] = $maxRows;
        $st = $pdo->prepare($sql);
        $st->execute($params);

        $fp = fopen('php://temp', 'r+');
        if ($fp === false) {
            return null;
        }
        fputcsv($fp, $columns);
        $rowCount = 0;
        while (($row = $st->fetch(\PDO::FETCH_ASSOC)) !== false) {
            if (! \is_array($row)) {
                continue;
            }
            $line = [];
            foreach ($columns as $c) {
                $line[] = isset($row[$c]) ? (string) $row[$c] : '';
            }
            fputcsv($fp, $line);
            $rowCount++;
        }
        rewind($fp);
        $csv = stream_get_contents($fp) ?: '';
        fclose($fp);

        return [
            'csv'        => $csv,
            'row_count'  => $rowCount,
            'truncated'  => $total > $rowCount,
        ];
    }

    private static function openReadOnly(string $relativePath): ?\PDO
    {
        $abs = self::absPath($relativePath);
        if ($abs === '' || ! is_file($abs)) {
            return null;
        }

        try {
            $pdo = new \PDO('sqlite:' . $abs, null, null, [
                \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
                \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            ]);
            $pdo->exec('PRAGMA query_only = ON');

            return $pdo;
        } catch (\Throwable) {
            return null;
        }
    }

    private static function quoteIdent(string $ident): string
    {
        return '"' . str_replace('"', '""', $ident) . '"';
    }
}
