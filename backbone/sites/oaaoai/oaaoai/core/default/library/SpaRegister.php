<?php

declare(strict_types=1);

namespace Oaaoai\Core;

use Razy\Agent;

/**
 * SPA page registration hub.
 *
 * Feature modules register via {@code $this->api('core')->registerSpaPage(...)} from {@code __onInit} (authorized for any {@code oaaoai/*} module).
 * Core’s Controller forwards into this static registry ({@see \\Module\\oaao\\app::registerSpaPage}).
 *
 * Included from {@see core.php} when the core module controller loads.
 *
 * Optional {@see $extras} (whitelist only):
 * - shell_panel_url: GET path returning HTML fragment for {@see workspace-module-mount}
 * - shell_js_module: absolute URL path to an ES module exporting {@code mountX(root)} / {@code teardownX()}
 */
final class SpaRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $pages = [];

    /** @param array<string, mixed> $extras */
    public static function register(Agent $agent, string $page_id, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        unset($agent);
        self::add($page_id, $title, $sub, $icon, $extras);
    }

    /** @param array<string, mixed> $extras */
    public static function add(string $page_id, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        $page_id = trim($page_id);
        if ($page_id === '') {
            return;
        }

        $row = [
            'page_id' => $page_id,
            'title'   => $title,
            'sub'     => $sub,
            'icon'    => $icon,
        ];

        foreach (['shell_panel_url', 'shell_js_module'] as $key) {
            if (isset($extras[$key]) && is_string($extras[$key]) && $extras[$key] !== '') {
                $row[$key] = $extras[$key];
            }
        }

        self::$pages[$page_id] = $row;
    }

    /**
     * Stable ordering for JSON embedding + sane JS fallbacks ({@code pages[0]}).
     * Primary workspace Chat is promoted ahead of lexicographic keys (e.g. other {@code workspace/*} pages).
     *
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $pages = self::$pages;
        ksort($pages, SORT_STRING);
        $values = array_values($pages);

        foreach ($values as $i => $row) {
            if (($row['page_id'] ?? '') === 'workspace/chat') {
                unset($values[$i]);
                array_unshift($values, $row);
                break;
            }
        }

        return array_values($values);
    }
}
