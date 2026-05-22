<?php

declare(strict_types=1);

namespace Oaaoai\Core;

use Razy\Agent;

/**
 * Settings dialog registry — administrator-global left-nav rows + right-hand panels (legacy admin Settings parity).
 * User-facing preference rows live in {@see PreferencesRegister}.
 *
 * Administrators register panels via {@code $this->api('core')->registerSettingsSection(...)}. The Endpoints and Purposes administrator rows are also registered from {@code oaaoai/core}
 * controller bootstrap so {@code index.tpl} JSON is complete even when other modules load lazily; non-admins still receive an empty list ({@see core.main.php}).
 *
 * Whitelisted {@see $extras}:
 * - sort: int (lower appears earlier; default 500)
 * - panel_html: inline HTML string mounted into the panel host (trusted server markup)
 * - panel_url: GET path returning JSON {@code { success: true, data: { html: string } }} (lazy-loaded client-side)
 * - panel_js_module: absolute URL path to ES module exporting {@code mountSettingsPanel(host, ctx)} /
 *   optional {@code teardownSettingsPanel()}
 * - label_key / title_key / sub_key: dotted keys resolved client-side via {@code oaao-i18n.js} ({@code oaaoT})
 */
final class SettingsRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $sections = [];

    /** @param array<string, mixed> $extras */
    public static function register(Agent $agent, string $section_id, string $label, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        unset($agent);
        self::add($section_id, $label, $title, $sub, $icon, $extras);
    }

    /** @param array<string, mixed> $extras */
    public static function add(string $section_id, string $label, string $title, string $sub = '', string $icon = '', array $extras = []): void
    {
        $section_id = trim($section_id);
        if ($section_id === '') {
            return;
        }

        $sort = 500;
        if (isset($extras['sort']) && is_numeric($extras['sort'])) {
            $sort = (int) $extras['sort'];
        }

        $row = [
            'section_id' => $section_id,
            'label'      => $label,
            'title'      => $title,
            'sub'        => $sub,
            'icon'       => $icon,
            'sort'       => $sort,
        ];

        foreach (['panel_html', 'panel_url', 'panel_js_module'] as $key) {
            if (isset($extras[$key]) && is_string($extras[$key]) && $extras[$key] !== '') {
                $row[$key] = $extras[$key];
            }
        }

        foreach (['label_key', 'title_key', 'sub_key'] as $ik) {
            if (isset($extras[$ik]) && is_string($extras[$ik]) && trim($extras[$ik]) !== '') {
                $row[$ik] = trim($extras[$ik]);
            }
        }

        self::$sections[$section_id] = $row;
    }

    /**
     * Stable ordering for JSON embedding ({@code sort} asc, then {@code section_id}).
     *
     * @return list<array<string, mixed>>
     */
    public static function allSorted(): array
    {
        $values = array_values(self::$sections);
        usort(
            $values,
            static function (array $a, array $b): int {
                $cmp = ($a['sort'] ?? 500) <=> ($b['sort'] ?? 500);

                return $cmp !== 0 ? $cmp : strcmp((string) ($a['section_id'] ?? ''), (string) ($b['section_id'] ?? ''));
            }
        );

        return $values;
    }
}
