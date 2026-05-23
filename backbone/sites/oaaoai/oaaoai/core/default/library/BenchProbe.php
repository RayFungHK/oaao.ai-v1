<?php

declare(strict_types=1);

/**
 * Optional request timing ({@code OAAO_BENCH_PROBE=1}).
 */
final class OaaoBenchProbe
{
    private static float $t0 = 0.0;

    /** @var list<array{label: string, ms: int, delta: int}> */
    private static array $marks = [];

    private static int $lastMs = 0;

    public static function enabled(): bool
    {
        return strtolower(trim((string) getenv('OAAO_BENCH_PROBE'))) === '1';
    }

    public static function boot(): void
    {
        if (! self::enabled()) {
            return;
        }
        self::$t0 = microtime(true);
        self::$marks = [];
        self::$lastMs = 0;
        self::mark('boot');
    }

    public static function mark(string $label): void
    {
        if (! self::enabled()) {
            return;
        }
        $ms = (int) round((microtime(true) - self::$t0) * 1000);
        self::$marks[] = [
            'label' => $label,
            'ms'    => $ms,
            'delta' => $ms - self::$lastMs,
        ];
        self::$lastMs = $ms;
    }

    /** @return list<array{label: string, ms: int, delta: int}> */
    public static function marks(): array
    {
        return self::$marks;
    }
}
