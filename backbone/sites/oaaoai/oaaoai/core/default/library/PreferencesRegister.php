<?php

declare(strict_types=1);

namespace Oaaoai\Core;

use Razy\Agent;

/**
 * Preferences dialog registry — user-facing left-nav rows + panels (personal / workspace / tenant-scoped UI).
 *
 * Modules call {@code $this->api('core')->registerPreferencesSection(...)}. Payload is embedded for every shell render ({@see core.main.php}),
 * unlike administrator-only {@see SettingsRegister}.
 *
 * Whitelisted {@see $extras}:
 * - sort: int (lower appears earlier; default 500)
 * - levels: list of {@code tenant}, {@code workspace}, {@code personal} — where this section applies (defaults to {@code personal} only)
 * - panel_html, panel_url, panel_js_module — same contract as {@see SettingsRegister}
 * - label_key / title_key / sub_key: dotted keys resolved client-side via {@code oaao-i18n.js}
 *
 * {@code panel_js_module} modules should export {@code mountPreferencesPanel(host, ctx)} / optional {@code teardownPreferencesPanel()}.
 */
final class PreferencesRegister
{
    /** @var array<string, array<string, mixed>> */
    protected static array $sections = [];

    /** @return list<string> */
    private static function canonicalLevels(): array
    {
        return [
            FeatureScopeRegister::LEVEL_TENANT,
            FeatureScopeRegister::LEVEL_WORKSPACE,
            FeatureScopeRegister::LEVEL_PERSONAL,
        ];
    }

    /**
     * @param list<mixed>|mixed $raw
     *
     * @return list<string>
     */
    private static function normalizeLevels(mixed $raw): array
    {
        if (! is_array($raw)) {
            return [FeatureScopeRegister::LEVEL_PERSONAL];
        }

        $allowed = self::canonicalLevels();
        $flip = array_flip($allowed);
        $seen = [];
        foreach ($raw as $x) {
            if (! is_string($x)) {
                continue;
            }
            $v = strtolower(trim($x));
            if (isset($flip[$v])) {
                $seen[$v] = true;
            }
        }

        $out = [];
        foreach ($allowed as $v) {
            if (isset($seen[$v])) {
                $out[] = $v;
            }
        }

        return $out !== [] ? $out : [FeatureScopeRegister::LEVEL_PERSONAL];
    }

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
            'levels'     => self::normalizeLevels($extras['levels'] ?? null),
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
