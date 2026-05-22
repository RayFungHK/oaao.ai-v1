<?php

declare(strict_types=1);

namespace oaaoai\slide_designer;

/**
 * Fixed slide canvas (1280×720) — align legacy slide.html on read for iframe previews.
 */
final class SlideCanvas
{
    public const DEFAULT_W = 1280;

    public const DEFAULT_H = 720;

    public static function width(): int
    {
        $raw = getenv('OAAO_SLIDE_CANVAS_W');
        if (\is_string($raw) && $raw !== '' && ctype_digit($raw)) {
            $w = (int) $raw;

            return max(640, min($w, 3840));
        }

        return self::DEFAULT_W;
    }

    public static function height(): int
    {
        $raw = getenv('OAAO_SLIDE_CANVAS_H');
        if (\is_string($raw) && $raw !== '' && ctype_digit($raw)) {
            $h = (int) $raw;

            return max(360, min($h, 2160));
        }

        return self::DEFAULT_H;
    }

    public static function normalizeHtml(string $html): string
    {
        $raw = trim($html);
        if ($raw === '' || str_contains($raw, 'oaao-slide-canvas-lock')) {
            return $raw;
        }

        $w = self::width();
        $h = self::height();
        $viewport = sprintf('<meta name="viewport" content="width=%d, height=%d">', $w, $h);
        $block = sprintf(
            '<style id="oaao-slide-canvas-lock">html,body{margin:0!important;padding:0!important;width:%1$dpx!important;height:%2$dpx!important;min-width:%1$dpx!important;min-height:%2$dpx!important;max-width:%1$dpx!important;max-height:%2$dpx!important;overflow:hidden!important;box-sizing:border-box}.oaao-slide-canvas{width:%1$dpx;height:%2$dpx;overflow:hidden;box-sizing:border-box;position:relative}</style>',
            $w,
            $h,
        );

        if (preg_match('/<meta[^>]*name=["\']viewport["\'][^>]*>/i', $raw) === 1) {
            $raw = (string) preg_replace(
                '/<meta[^>]*name=["\']viewport["\'][^>]*>/i',
                $viewport,
                $raw,
                1,
            );
        } elseif (preg_match('/<head\b/i', $raw) === 1) {
            $raw = (string) preg_replace('/<head([^>]*)>/i', '<head$1>' . $viewport, $raw, 1);
        } else {
            $raw = '<head>' . $viewport . $block . '</head>' . $raw;
        }

        if (! str_contains($raw, 'oaao-slide-canvas-lock')) {
            if (preg_match('/<\/head>/i', $raw) === 1) {
                $raw = (string) preg_replace('/<\/head>/i', $block . '</head>', $raw, 1);
            } else {
                $raw = $block . $raw;
            }
        }

        if (! str_contains($raw, 'oaao-slide-canvas') && preg_match('/<body\b/i', $raw) === 1) {
            $raw = (string) preg_replace('/<body([^>]*)>/i', '<body$1><div class="oaao-slide-canvas">', $raw, 1);
            $raw = (string) preg_replace('/<\/body>/i', '</div></body>', $raw, 1);
        }

        return $raw;
    }
}
